import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  discoverMigrations,
  runMigrations,
} from "../../scripts/migration-runner.mjs";
import { hashToken } from "../../src/modules/identity/domain";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Migration 0012: permissões e backfill seguro", () => {
  const stamp = Date.now();
  const schemaBlank = `test_perm_blank_${stamp}`;
  const schemaBackfill = `test_perm_backfill_${stamp}`;
  const schemaAtomic = `test_perm_atomic_${stamp}`;

  afterAll(async () => {
    if (process.env.DATABASE_URL) {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaBlank}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaBackfill}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaAtomic}" CASCADE`);
      await sql.end();
    }
  });

  it("Cenário 1: aplica 0001 -> 0012 em banco limpo com sucesso", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaBlank}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaBlank},public`);

    const result = await runMigrations({ databaseUrl: isolatedUrl.toString(), migrationsDirectory: path.resolve("migrations") });
    expect(result).toHaveLength(12);
    expect(result[11]).toBe("0012_user_permissions_and_management.sql");

    const checkSql = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      const recorded = await checkSql<{ filename: string }[]>`
        SELECT filename FROM schema_migrations ORDER BY filename
      `;
      expect(recorded).toHaveLength(12);
      expect(recorded[11].filename).toBe("0012_user_permissions_and_management.sql");
      const [col] = await checkSql<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = ${schemaBlank} AND table_name = 'users' AND column_name = 'permissions'
      `;
      expect(col).toBeDefined();
      expect(col.column_name).toBe("permissions");
      expect(col.data_type).toBe("ARRAY");

      const constraints = await checkSql<{ constraint_name: string }[]>`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = ${schemaBlank} AND table_name = 'users'
      `;
      const constraintNames = constraints.map((c) => c.constraint_name);
      expect(constraintNames).toContain("users_permissions_valid_check");
      expect(constraintNames).toContain("users_store_permission_check");
      expect(constraintNames).not.toContain("users_store_role_check");
    } finally {
      await checkSql.end();
    }
  });

  it("Cenário 2: aplica 0001–0011, insere usuários reais e valida backfill + constraints na 0012", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaBackfill}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaBackfill},public`);

    const client = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // 1. Aplica migrations 0001 até 0011 manualmente
      const allFiles = await discoverMigrations(path.resolve("migrations"));
      const filesUpTo0011 = allFiles.filter((f) => !f.startsWith("0012"));
      expect(filesUpTo0011).toHaveLength(11);

      await client.unsafe(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id SERIAL PRIMARY KEY,
          filename TEXT NOT NULL UNIQUE,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      for (const file of filesUpTo0011) {
        const sqlContent = await readFile(path.join(path.resolve("migrations"), file), "utf8");
        await client.unsafe(sqlContent);
      }

      // 2. Cria 3 lojas
      const [s1, s2, s3] = await client<{ id: string }[]>`
        INSERT INTO stores (slug, name) VALUES
          ('loja-1', 'Loja 1'),
          ('loja-2', 'Loja 2'),
          ('loja-3', 'Loja 3')
        RETURNING id
      `;

      // 3. Insere 6 usuários base sem a coluna permissions (comportamento do estado 0011):
      // - 3 LOJA vinculados às 3 lojas
      // - 1 COMPRADOR sem loja
      // - 2 GESTOR sem loja
      const [, , , , uGestor1] = await client<{ id: string }[]>`
        INSERT INTO users (email, name, password_hash, role, store_id) VALUES
          ('loja1@example.com', 'Operador Loja 1', 'hash1', 'LOJA', ${s1.id}),
          ('loja2@example.com', 'Operador Loja 2', 'hash2', 'LOJA', ${s2.id}),
          ('loja3@example.com', 'Operador Loja 3', 'hash3', 'LOJA', ${s3.id}),
          ('comprador@example.com', 'Comprador Central', 'hash4', 'COMPRADOR', NULL),
          ('gestor1@example.com', 'Gestor Operacional', 'hash5', 'GESTOR', NULL),
          ('gestor2@example.com', 'Gestor Executivo', 'hash6', 'GESTOR', NULL)
        RETURNING id
      `;

      // 3.1. Insere uma sessão criada ANTES da 0012 para o gestor1
      const pre0012Token = "token-pre-0012-session";
      const pre0012TokenHash = hashToken(pre0012Token);
      await client`
        INSERT INTO sessions (user_id, token_hash, idle_expires_at, absolute_expires_at)
        VALUES (${uGestor1.id}, ${pre0012TokenHash}, now() + interval '12 hours', now() + interval '7 days')
      `;

      // 4. Executa a migration 0012
      const sql0012 = await readFile(path.join(path.resolve("migrations"), "0012_user_permissions_and_management.sql"), "utf8");
      await client.unsafe(sql0012);

      // 4.1. Valida que a sessão criada ANTES da 0012 passa a carregar as novas permissões do banco imediatamente após o backfill
      const [sessionPrincipal] = await client<{
        userId: string;
        role: string;
        store_id: string | null;
        permissions: string[];
      }[]>`
        SELECT u.id AS "userId", u.role, u.store_id, u.permissions
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ${pre0012TokenHash}
      `;
      expect(sessionPrincipal).toBeDefined();
      expect(sessionPrincipal.permissions).toEqual([
        "compras:consolidado",
        "compras:custos",
        "gestor:produtos",
        "gestor:precificacao",
        "gestor:configuracoes",
        "gestor:usuarios",
      ]);

      // 5. Valida backfill dos usuários LOJA
      const lojaUsers = await client<{ email: string; store_id: string; permissions: string[] }[]>`
        SELECT email, store_id, permissions FROM users WHERE role = 'LOJA' ORDER BY email
      `;
      expect(lojaUsers).toHaveLength(3);
      for (const user of lojaUsers) {
        expect(user.store_id).not.toBeNull();
        expect(user.permissions).toEqual(["pedidos:criar", "pedidos:historico"]);
      }

      // 6. Valida backfill do COMPRADOR
      const [compradorUser] = await client<{ email: string; store_id: string | null; permissions: string[] }[]>`
        SELECT email, store_id, permissions FROM users WHERE role = 'COMPRADOR'
      `;
      expect(compradorUser.store_id).toBeNull();
      expect(compradorUser.permissions).toEqual(["compras:consolidado", "compras:custos"]);

      // 7. Valida backfill dos 2 GESTORES
      const gestorUsers = await client<{ email: string; store_id: string | null; permissions: string[] }[]>`
        SELECT email, store_id, permissions FROM users WHERE role = 'GESTOR' ORDER BY email
      `;
      expect(gestorUsers).toHaveLength(2);
      for (const gestor of gestorUsers) {
        expect(gestor.store_id).toBeNull();
        expect(gestor.permissions).toEqual([
          "compras:consolidado",
          "compras:custos",
          "gestor:produtos",
          "gestor:precificacao",
          "gestor:configuracoes",
          "gestor:usuarios",
        ]);
        // GESTOR NÃO deve possuir permissões de loja
        expect(gestor.permissions).not.toContain("pedidos:criar");
        expect(gestor.permissions).not.toContain("pedidos:historico");
      }

      // 8. Valida constraint users_permissions_valid_check (rejeita permissões fora das 8 oficiais)
      await expect(client`
        INSERT INTO users (email, name, password_hash, role, permissions)
        VALUES ('invalido@example.com', 'Inválido', 'h', 'COMPRADOR', ARRAY['compras:consolidado', 'admin:root']::text[])
      `).rejects.toMatchObject({ code: "23514" });

      // 9. Valida constraint users_store_permission_check
      // Caso A: Permissão de loja sem store_id -> ERRO
      await expect(client`
        INSERT INTO users (email, name, password_hash, role, permissions)
        VALUES ('loja_sem_loja@example.com', 'Sem loja', 'h', 'LOJA', ARRAY['pedidos:criar']::text[])
      `).rejects.toMatchObject({ code: "23514" });

      // Caso B: Permissões de comprador/gestor COM store_id -> ERRO
      await expect(client`
        INSERT INTO users (email, name, password_hash, role, store_id, permissions)
        VALUES ('comprador_com_loja@example.com', 'Com Loja', 'h', 'COMPRADOR', ${s1.id}, ARRAY['compras:consolidado']::text[])
      `).rejects.toMatchObject({ code: "23514" });

      // Caso C: Array de permissões vazio COM store_id -> ERRO
      await expect(client`
        INSERT INTO users (email, name, password_hash, role, store_id, permissions)
        VALUES ('vazio_com_loja@example.com', 'Vazio', 'h', 'LOJA', ${s1.id}, '{}'::text[])
      `).rejects.toMatchObject({ code: "23514" });

      // Caso D: Atualizar LOJA existente para store_id = NULL -> ERRO
      await expect(client`
        UPDATE users SET store_id = NULL WHERE email = 'loja1@example.com'
      `).rejects.toMatchObject({ code: "23514" });

      // Caso E: Atualizar GESTOR existente para associar loja -> ERRO
      await expect(client`
        UPDATE users SET store_id = ${s1.id} WHERE email = 'gestor1@example.com'
      `).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.end();
    }
  });

  it("Cenário 3: falha na migration 0012 executa rollback atômico sem deixar schema parcialmente migrado", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaAtomic}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaAtomic},public`);

    const client = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // 1. Aplica migrations 0001 até 0011
      const allFiles = await discoverMigrations(path.resolve("migrations"));
      const filesUpTo0011 = allFiles.filter((f) => !f.startsWith("0012"));

      await client.unsafe(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id SERIAL PRIMARY KEY,
          filename TEXT NOT NULL UNIQUE,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      for (const file of filesUpTo0011) {
        const sqlContent = await readFile(path.join(path.resolve("migrations"), file), "utf8");
        await client.unsafe(sqlContent);
      }

      // 2. Cria uma constraint conflitante com o mesmo nome para forçar a falha da 0012
      await client.unsafe(`
        ALTER TABLE users ADD CONSTRAINT users_permissions_valid_check CHECK (false);
      `);

      // 3. Executa a migration 0012 (deve falhar por causa da constraint conflitante)
      const sql0012 = await readFile(path.join(path.resolve("migrations"), "0012_user_permissions_and_management.sql"), "utf8");
      try {
        await client.unsafe(sql0012);
        expect.fail("Deveria ter falhado ao tentar aplicar migration com constraint conflitante");
      } catch {
        await client.unsafe("ROLLBACK;");
      }

      // 4. Valida que o rollback da 0012 foi 100% limpo e atômico:
      // a) A coluna permissions NÃO existe em users (passo 1 revertido)
      const permissionsCols = await client<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = ${schemaAtomic} AND table_name = 'users' AND column_name = 'permissions'
      `;
      expect(permissionsCols).toHaveLength(0);

      // b) A constraint original users_store_role_check AINDA existe (o DROP CONSTRAINT foi revertido)
      const constraints = await client<{ constraint_name: string }[]>`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = ${schemaAtomic} AND table_name = 'users' AND constraint_name = 'users_store_role_check'
      `;
      expect(constraints).toHaveLength(1);

      // c) A nova constraint users_store_permission_check NÃO existe
      const newConstraints = await client<{ constraint_name: string }[]>`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = ${schemaAtomic} AND table_name = 'users' AND constraint_name = 'users_store_permission_check'
      `;
      expect(newConstraints).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
});
