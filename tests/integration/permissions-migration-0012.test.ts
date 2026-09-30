import { createHash } from "node:crypto";
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
const MIGRATIONS_LOCK_ID = 8943729184719284n;

integration("Migration 0012: permissões, backfill, retomada e segurança transacional", () => {
  const stamp = Date.now();
  const schemaA = `test_perm_a_${stamp}`;
  const schemaB = `test_perm_b_${stamp}`;
  const schemaC = `test_perm_c_${stamp}`;
  const schemaD = `test_perm_d_${stamp}`;
  const schemaD2 = `test_perm_d2_${stamp}`;

  afterAll(async () => {
    if (process.env.DATABASE_URL) {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaA}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaB}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaC}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaD}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaD2}" CASCADE`);
      await sql.end();
    }
  });

  it("Cenário A: aplica 0001 -> 0012 em banco limpo com sucesso via runMigrations", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaA}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaA},public`);

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
        WHERE table_schema = ${schemaA} AND table_name = 'users' AND column_name = 'permissions'
      `;
      expect(col).toBeDefined();
      expect(col.column_name).toBe("permissions");
      expect(col.data_type).toBe("ARRAY");

      const constraints = await checkSql<{ constraint_name: string }[]>`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = ${schemaA} AND table_name = 'users'
      `;
      const constraintNames = constraints.map((c) => c.constraint_name);
      expect(constraintNames).toContain("users_permissions_valid_check");
      expect(constraintNames).toContain("users_store_permission_check");
      expect(constraintNames).not.toContain("users_store_role_check");
    } finally {
      await checkSql.end();
    }
  });

  it("Cenário B: aplica 0001–0011, insere usuários e sessões reais, e aplica 0012 via runMigrations com backfill", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaB}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaB},public`);

    const client = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // 1. Aplica migrations 0001 até 0011 manualmente e registra em schema_migrations
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
        const checksum = createHash("sha256").update(sqlContent).digest("hex");
        await client`
          INSERT INTO schema_migrations (filename, checksum)
          VALUES (${file}, ${checksum})
        `;
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

      // 4. Executa a migration 0012 através do migration runner real
      const newlyApplied: string[] = [];
      const applied = await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
        onApplied: (f) => newlyApplied.push(f),
      });
      expect(applied).toHaveLength(12);
      expect(newlyApplied).toEqual(["0012_user_permissions_and_management.sql"]);

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

  it("Cenário C: materializada mas não registrada — retoma com sucesso se 0012 já foi aplicada no schema mas ausente de schema_migrations", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaC}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaC},public`);

    const client = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // 1. Aplica todas as 12 migrations normalmente
      const initialApplied = await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
      });
      expect(initialApplied).toHaveLength(12);

      // Insere uma loja e um usuário com permissões já no formato 0012
      const [s] = await client<{ id: string }[]>`
        INSERT INTO stores (slug, name) VALUES ('loja-c', 'Loja C') RETURNING id
      `;
      await client`
        INSERT INTO users (email, name, password_hash, role, store_id, permissions)
        VALUES ('usuario-c@example.com', 'Usuário C', 'hash', 'LOJA', ${s.id}, ARRAY['pedidos:criar', 'pedidos:historico']::text[])
      `;

      // 2. Simula falha do processo logo após COMMIT da 0012, antes do INSERT em schema_migrations:
      // Removemos o registro da 0012 de schema_migrations
      await client`DELETE FROM schema_migrations WHERE filename = '0012_user_permissions_and_management.sql'`;

      // Confirma que 0012 não consta em schema_migrations, mas seu schema está 100% materializado
      const [unrecorded] = await client<{ filename: string }[]>`
        SELECT filename FROM schema_migrations WHERE filename = '0012_user_permissions_and_management.sql'
      `;
      expect(unrecorded).toBeUndefined();

      // 3. Executa runMigrations novamente: o runner detecta 0012 pendente e deve executá-la com sucesso
      const freshlyApplied: string[] = [];
      const resumedApplied = await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
        onApplied: (f) => freshlyApplied.push(f),
      });
      expect(resumedApplied).toHaveLength(12);
      expect(freshlyApplied).toEqual(["0012_user_permissions_and_management.sql"]);

      // 4. Confirma que 0012 foi devidamente registrada
      const [nowRecorded] = await client<{ filename: string }[]>`
        SELECT filename FROM schema_migrations WHERE filename = '0012_user_permissions_and_management.sql'
      `;
      expect(nowRecorded).toBeDefined();
      expect(nowRecorded.filename).toBe("0012_user_permissions_and_management.sql");

      // 5. Confirma que os dados do usuário não foram corrompidos ou alterados
      const [savedUser] = await client<{ email: string; store_id: string; permissions: string[] }[]>`
        SELECT email, store_id, permissions FROM users WHERE email = 'usuario-c@example.com'
      `;
      expect(savedUser.store_id).toBe(s.id);
      expect(savedUser.permissions).toEqual(["pedidos:criar", "pedidos:historico"]);

      // 6. Confirma que as constraints continuam ativas e válidas
      const constraints = await client<{ constraint_name: string }[]>`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = ${schemaC} AND table_name = 'users'
      `;
      const constraintNames = constraints.map((c) => c.constraint_name);
      expect(constraintNames).toContain("users_permissions_valid_check");
      expect(constraintNames).toContain("users_store_permission_check");

      // 7. Próxima execução do runner não tem nada pendente
      const subsequentApplied: string[] = [];
      const subsequentRun = await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
        onApplied: (f) => subsequentApplied.push(f),
      });
      expect(subsequentRun).toHaveLength(12);
      expect(subsequentApplied).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("Cenário D: falha transacional pelo runner — constraint divergente gera rollback, preserva erro original, libera lock, e permite retomada após resolução", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaD}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaD},public`);

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
        const checksum = createHash("sha256").update(sqlContent).digest("hex");
        await client`
          INSERT INTO schema_migrations (filename, checksum)
          VALUES (${file}, ${checksum})
        `;
      }

      // 2. Cria intencionalmente uma constraint com o mesmo nome users_permissions_valid_check mas com definição DIVERGENTE
      await client.unsafe(`
        ALTER TABLE users ADD CONSTRAINT users_permissions_valid_check CHECK (false);
      `);

      // 3. Executa o migration runner real: DEVE falhar
      let migrationError: Error | undefined;
      try {
        await runMigrations({
          databaseUrl: isolatedUrl.toString(),
          migrationsDirectory: path.resolve("migrations"),
        });
      } catch (err) {
        migrationError = err as Error;
      }

      // 4. Validações de tratamento de erro no runner:
      // a) O erro original foi preservado e contém a mensagem da constraint divergente
      expect(migrationError).toBeDefined();
      expect(migrationError?.message).toContain("Falha ao aplicar migration 0012_user_permissions_and_management.sql");
      const causeMessage = (migrationError?.cause as Error | undefined)?.message ?? "";
      expect(causeMessage).toContain("Constraint users_permissions_valid_check já existe com definição divergente");

      // b) O advisory lock foi liberado pelo runner (pg_try_advisory_lock consegue obter o lock imediatamente)
      const [{ locked }] = await client<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${MIGRATIONS_LOCK_ID.toString()}::bigint) as locked
      `;
      expect(locked).toBe(true);
      await client`SELECT pg_advisory_unlock(${MIGRATIONS_LOCK_ID.toString()}::bigint)`;

      // c) A transação sofreu rollback: a coluna permissions NÃO foi criada em users
      const permissionsCols = await client<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = ${schemaD} AND table_name = 'users' AND column_name = 'permissions'
      `;
      expect(permissionsCols).toHaveLength(0);

      // d) A constraint legada users_store_role_check NÃO foi excluída (o DROP CONSTRAINT foi revertido)
      const legacyCheck = await client<{ constraint_name: string }[]>`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = ${schemaD} AND table_name = 'users' AND constraint_name = 'users_store_role_check'
      `;
      expect(legacyCheck).toHaveLength(1);

      // e) 0012 NÃO foi registrada em schema_migrations
      const [notRecorded] = await client<{ filename: string }[]>`
        SELECT filename FROM schema_migrations WHERE filename = '0012_user_permissions_and_management.sql'
      `;
      expect(notRecorded).toBeUndefined();

      // 5. Corrige o estado conflitante removendo a constraint divergente
      await client.unsafe(`ALTER TABLE users DROP CONSTRAINT users_permissions_valid_check;`);

      // 6. Uma nova execução do migration runner agora deve conseguir prosseguir normalmente
      const retryNewlyApplied: string[] = [];
      const retryApplied = await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
        onApplied: (f) => retryNewlyApplied.push(f),
      });
      expect(retryApplied).toHaveLength(12);
      expect(retryNewlyApplied).toEqual(["0012_user_permissions_and_management.sql"]);

      // 7. Confirma que a 0012 agora está registrada e válida
      const [recorded] = await client<{ filename: string }[]>`
        SELECT filename FROM schema_migrations WHERE filename = '0012_user_permissions_and_management.sql'
      `;
      expect(recorded).toBeDefined();
    } finally {
      await client.end();
    }
  });

  it("Cenário D2: detecta e rejeita users_store_permission_check divergente com rollback seguro", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaD2}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaD2},public`);

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
        const checksum = createHash("sha256").update(sqlContent).digest("hex");
        await client`
          INSERT INTO schema_migrations (filename, checksum)
          VALUES (${file}, ${checksum})
        `;
      }

      // 2. Cria intencionalmente uma constraint users_store_permission_check com definição DIVERGENTE
      await client.unsafe(`
        ALTER TABLE users ADD CONSTRAINT users_store_permission_check CHECK (store_id IS NULL);
      `);

      // 3. Executa o migration runner real: DEVE falhar
      let migrationError: Error | undefined;
      try {
        await runMigrations({
          databaseUrl: isolatedUrl.toString(),
          migrationsDirectory: path.resolve("migrations"),
        });
      } catch (err) {
        migrationError = err as Error;
      }

      expect(migrationError).toBeDefined();
      expect(migrationError?.message).toContain("Falha ao aplicar migration 0012_user_permissions_and_management.sql");
      const causeMessage = (migrationError?.cause as Error | undefined)?.message ?? "";
      expect(causeMessage).toContain("Constraint users_store_permission_check já existe com definição divergente");

      // 4. Advisory lock liberado
      const [{ locked }] = await client<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${MIGRATIONS_LOCK_ID.toString()}::bigint) as locked
      `;
      expect(locked).toBe(true);
      await client`SELECT pg_advisory_unlock(${MIGRATIONS_LOCK_ID.toString()}::bigint)`;

      // 5. Corrige o conflito
      await client.unsafe(`ALTER TABLE users DROP CONSTRAINT users_store_permission_check;`);

      // 6. Retentativa tem sucesso
      const retryNewlyApplied: string[] = [];
      const retryApplied = await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
        onApplied: (f) => retryNewlyApplied.push(f),
      });
      expect(retryApplied).toHaveLength(12);
      expect(retryNewlyApplied).toEqual(["0012_user_permissions_and_management.sql"]);
    } finally {
      await client.end();
    }
  });
});
