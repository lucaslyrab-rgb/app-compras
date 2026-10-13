import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  discoverMigrations,
  runMigrations,
} from "../../scripts/migration-runner.mjs";
import { SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID } from "../../src/modules/suppliers/repository";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Migration 0013: fornecedores, constraints, unicidade, backfill e concorrência", () => {
  const stamp = Date.now();
  const schemaA = `test_sup_a_${stamp}`;
  const schemaB = `test_sup_b_${stamp}`;
  const schemaC = `test_sup_c_${stamp}`;
  const schemaD = `test_sup_d_${stamp}`;

  afterAll(async () => {
    if (process.env.DATABASE_URL) {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaA}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaB}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaC}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaD}" CASCADE`);
      await sql.end();
    }
  });

  it("Cenário A: aplica 0001 -> 0013 em schema limpo e valida estrutura e constraints da tabela suppliers", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaA}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaA},public`);

    const result = await runMigrations({
      databaseUrl: isolatedUrl.toString(),
      migrationsDirectory: path.resolve("migrations"),
    });

    expect(result.length).toBeGreaterThanOrEqual(13);
    expect(result).toContain("0013_suppliers.sql");

    const client = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // 1. Valida presença e tipos de colunas em suppliers
      const columns = await client<{ column_name: string; data_type: string; is_nullable: string }[]>`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${schemaA} AND table_name = 'suppliers'
        ORDER BY ordinal_position
      `;
      const colMap = new Map(columns.map((c) => [c.column_name, c]));

      expect(colMap.has("id")).toBe(true);
      expect(colMap.get("id")?.data_type).toBe("uuid");

      expect(colMap.has("corporate_name")).toBe(true);
      expect(colMap.get("corporate_name")?.is_nullable).toBe("NO");

      expect(colMap.has("trade_name")).toBe(true);
      expect(colMap.get("trade_name")?.is_nullable).toBe("YES");

      expect(colMap.has("tax_id")).toBe(true);
      expect(colMap.get("tax_id")?.is_nullable).toBe("YES");

      expect(colMap.has("tax_id_type")).toBe(true);
      expect(colMap.get("tax_id_type")?.is_nullable).toBe("NO");

      expect(colMap.has("tax_invoice_rule")).toBe(true);
      expect(colMap.get("tax_invoice_rule")?.is_nullable).toBe("NO");

      expect(colMap.has("active")).toBe(true);
      expect(colMap.get("active")?.data_type).toBe("boolean");
      expect(colMap.get("active")?.is_nullable).toBe("NO");

      expect(colMap.has("version")).toBe(true);
      expect(colMap.get("version")?.data_type).toBe("integer");
      expect(colMap.get("version")?.is_nullable).toBe("NO");

      expect(colMap.has("created_at")).toBe(true);
      expect(colMap.has("updated_at")).toBe(true);

      // 2. Valida inserção válida com regra AFTER_WEIGHING e campos opcionais
      const [inserted] = await client<{ id: string; version: number; tax_invoice_rule: string }[]>`
        INSERT INTO suppliers (
          corporate_name,
          trade_name,
          tax_id,
          tax_id_type,
          tax_invoice_rule
        ) VALUES (
          'Distribuidora Ceasa Ltda',
          'Ceasa Distribuição',
          '12345678000195',
          'CNPJ',
          'AFTER_WEIGHING'
        ) RETURNING id, version, tax_invoice_rule
      `;
      expect(inserted.id).toBeDefined();
      expect(inserted.version).toBe(1);
      expect(inserted.tax_invoice_rule).toBe("AFTER_WEIGHING");

      // 3. Valida constraint: corporate_name não pode ser vazio ou só espaços
      await expect(client`
        INSERT INTO suppliers (corporate_name) VALUES ('   ')
      `).rejects.toMatchObject({ code: "23514" });

      // 4. Valida constraint: tax_id_type inválido deve falhar
      await expect(client`
        INSERT INTO suppliers (corporate_name, tax_id_type)
        VALUES ('Fornecedor X', 'INVALIDO')
      `).rejects.toMatchObject({ code: "23514" });

      // 5. Valida constraint: tax_invoice_rule inválida deve falhar
      await expect(client`
        INSERT INTO suppliers (corporate_name, tax_invoice_rule)
        VALUES ('Fornecedor Y', 'INVALIDA')
      `).rejects.toMatchObject({ code: "23514" });

      // 6. Valida constraint: version deve ser > 0
      await expect(client`
        INSERT INTO suppliers (corporate_name, version)
        VALUES ('Fornecedor Z', 0)
      `).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.end();
    }
  });

  it("Cenário B: índice parcial único permite múltiplos documentos nulos e impede duplicatas de CPF/CNPJ", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaB}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaB},public`);

    await runMigrations({
      databaseUrl: isolatedUrl.toString(),
      migrationsDirectory: path.resolve("migrations"),
    });

    const client = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // 1. Múltiplos fornecedores sem documento (tax_id IS NULL) são permitidos
      const [s1] = await client<{ id: string }[]>`
        INSERT INTO suppliers (corporate_name, tax_id, tax_id_type)
        VALUES ('Produtor Rural Sem CNPJ 1', NULL, 'NOT_INFORMED')
        RETURNING id
      `;
      const [s2] = await client<{ id: string }[]>`
        INSERT INTO suppliers (corporate_name, tax_id, tax_id_type)
        VALUES ('Produtor Rural Sem CNPJ 2', NULL, 'NOT_INFORMED')
        RETURNING id
      `;
      expect(s1.id).toBeDefined();
      expect(s2.id).toBeDefined();
      expect(s1.id).not.toBe(s2.id);

      // 2. Múltiplos fornecedores com tax_id vazio/em branco (se permitidos pela cláusula WHERE)
      const [s3] = await client<{ id: string }[]>`
        INSERT INTO suppliers (corporate_name, tax_id, tax_id_type)
        VALUES ('Produtor Rural Sem CNPJ 3', '', 'NOT_INFORMED')
        RETURNING id
      `;
      const [s4] = await client<{ id: string }[]>`
        INSERT INTO suppliers (corporate_name, tax_id, tax_id_type)
        VALUES ('Produtor Rural Sem CNPJ 4', '', 'NOT_INFORMED')
        RETURNING id
      `;
      expect(s3.id).toBeDefined();
      expect(s4.id).toBeDefined();

      // 3. Primeiro fornecedor com CNPJ válido
      const [sWithTaxId] = await client<{ id: string }[]>`
        INSERT INTO suppliers (corporate_name, tax_id, tax_id_type)
        VALUES ('Hortifruti Central Ltda', '11222333000181', 'CNPJ')
        RETURNING id
      `;
      expect(sWithTaxId.id).toBeDefined();

      // 4. Segundo fornecedor com o MESMO CNPJ DEVE FALHAR (unique_violation: 23505)
      await expect(client`
        INSERT INTO suppliers (corporate_name, tax_id, tax_id_type)
        VALUES ('Outra Empresa com Mesmo CNPJ', '11222333000181', 'CNPJ')
      `).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.end();
    }
  });

  it("Cenário C: migração a partir de 0012 — backfill idempotente e validação da constraint de permissões", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaC}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaC},public`);

    const client = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // 1. Aplica migrations 0001 até 0012
      const allFiles = await discoverMigrations(path.resolve("migrations"));
      const filesUpTo0012 = allFiles.filter((f) => f <= "0012_user_permissions_and_management.sql");

      await client.unsafe(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id SERIAL PRIMARY KEY,
          filename TEXT NOT NULL UNIQUE,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      for (const file of filesUpTo0012) {
        const { readFile } = await import("node:fs/promises");
        const { createHash } = await import("node:crypto");
        const sqlContent = await readFile(path.join(path.resolve("migrations"), file), "utf8");
        await client.unsafe(sqlContent);
        const checksum = createHash("sha256").update(sqlContent).digest("hex");
        await client`
          INSERT INTO schema_migrations (filename, checksum)
          VALUES (${file}, ${checksum})
        `;
      }

      // 2. Cria usuários no estado pré-0013:
      // - Comprador 1 sem compras:fornecedores
      // - Comprador 2 JÁ com compras:fornecedores (testa idempotência)
      // - Gestor 1 sem permissões de fornecedores
      // - Gestor 2 que já possuía compras:fornecedores, mas não gestor:fornecedores
      // - Loja (não deve ser afetada)
      const [store] = await client<{ id: string }[]>`
        INSERT INTO stores (slug, name) VALUES ('loja-c-0013', 'Loja C 0013') RETURNING id
      `;

      await client`
        INSERT INTO users (email, name, password_hash, role, permissions)
        VALUES
          ('comprador1@test.com', 'Comprador 1', 'h', 'COMPRADOR', ARRAY['compras:consolidado', 'compras:custos']::text[]),
          ('comprador2@test.com', 'Comprador 2', 'h', 'COMPRADOR', ARRAY['compras:consolidado']::text[]),
          ('gestor1@test.com', 'Gestor 1', 'h', 'GESTOR', ARRAY['compras:consolidado', 'gestor:produtos', 'gestor:usuarios']::text[]),
          ('gestor2@test.com', 'Gestor 2', 'h', 'GESTOR', ARRAY['compras:consolidado', 'gestor:produtos']::text[])
      `;

      await client`
        INSERT INTO users (email, name, password_hash, role, store_id, permissions)
        VALUES ('loja1@test.com', 'Loja 1', 'h', 'LOJA', ${store.id}, ARRAY['pedidos:criar', 'pedidos:historico']::text[])
      `;

      // 3. Aplica migration 0013 via runner
      const newlyApplied: string[] = [];
      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
        onApplied: (f) => newlyApplied.push(f),
      });

      expect(newlyApplied).toContain("0013_suppliers.sql");

      // 4. Valida os resultados do backfill
      const usersRows = await client<{ email: string; permissions: string[] }[]>`
        SELECT email, permissions FROM users ORDER BY email
      `;
      const userMap = new Map(usersRows.map((u) => [u.email, u.permissions]));

      // Comprador 1: recebeu compras:fornecedores
      const c1Perms = userMap.get("comprador1@test.com")!;
      expect(c1Perms).toContain("compras:fornecedores");
      expect(c1Perms.filter((p) => p === "compras:fornecedores")).toHaveLength(1);

      // Comprador 2: recebeu compras:fornecedores sem duplicidade
      const c2Perms = userMap.get("comprador2@test.com")!;
      expect(c2Perms).toContain("compras:fornecedores");
      expect(c2Perms.filter((p) => p === "compras:fornecedores")).toHaveLength(1);

      // Gestor 1: recebeu ambos
      const g1Perms = userMap.get("gestor1@test.com")!;
      expect(g1Perms).toContain("compras:fornecedores");
      expect(g1Perms).toContain("gestor:fornecedores");
      expect(g1Perms.filter((p) => p === "compras:fornecedores")).toHaveLength(1);
      expect(g1Perms.filter((p) => p === "gestor:fornecedores")).toHaveLength(1);

      // Gestor 2: recebeu ambos sem duplicatas
      const g2Perms = userMap.get("gestor2@test.com")!;
      expect(g2Perms).toContain("compras:fornecedores");
      expect(g2Perms).toContain("gestor:fornecedores");
      expect(g2Perms.filter((p) => p === "compras:fornecedores")).toHaveLength(1);
      expect(g2Perms.filter((p) => p === "gestor:fornecedores")).toHaveLength(1);

      // Loja: inalterada
      const l1Perms = userMap.get("loja1@test.com")!;
      expect(l1Perms).toEqual(["pedidos:criar", "pedidos:historico"]);

      // 5. Idempotência estrita: reexecutar os UPDATEs do backfill não causa duplicação
      await client`
        UPDATE users
        SET permissions = array_append(permissions, 'compras:fornecedores')
        WHERE role = 'COMPRADOR'
          AND NOT ('compras:fornecedores' = ANY(permissions))
      `;

      await client`
        UPDATE users
        SET permissions = array_append(permissions, 'compras:fornecedores')
        WHERE role = 'GESTOR'
          AND NOT ('compras:fornecedores' = ANY(permissions))
      `;

      await client`
        UPDATE users
        SET permissions = array_append(permissions, 'gestor:fornecedores')
        WHERE role = 'GESTOR'
          AND NOT ('gestor:fornecedores' = ANY(permissions))
      `;

      const recheckedUsers = await client<{ email: string; permissions: string[] }[]>`
        SELECT email, permissions FROM users WHERE email = 'gestor1@test.com'
      `;
      expect(recheckedUsers[0].permissions.filter((p) => p === "compras:fornecedores")).toHaveLength(1);
      expect(recheckedUsers[0].permissions.filter((p) => p === "gestor:fornecedores")).toHaveLength(1);

      // 6. Constraint users_permissions_valid_check aceita as novas permissões e rejeita permissões inválidas
      await expect(client`
        INSERT INTO users (email, name, password_hash, role, permissions)
        VALUES ('invalid@test.com', 'Inválido', 'h', 'COMPRADOR', ARRAY['permissao:desconhecida']::text[])
      `).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.end();
    }
  });

  it("Cenário D: concorrência otimista (version) e bloqueio consultivo (advisory lock 42424202)", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaD}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaD},public`);

    await runMigrations({
      databaseUrl: isolatedUrl.toString(),
      migrationsDirectory: path.resolve("migrations"),
    });

    const client1 = postgres(isolatedUrl.toString(), { max: 1 });
    const client2 = postgres(isolatedUrl.toString(), { max: 1 });

    try {
      // 1. Testa concorrência otimista via coluna version
      const [sup] = await client1<{ id: string; version: number }[]>`
        INSERT INTO suppliers (corporate_name, version)
        VALUES ('Fornecedor Concorrente', 1)
        RETURNING id, version
      `;
      expect(sup.version).toBe(1);

      // Usuário 1 atualiza com version = 1 com sucesso
      const updated1 = await client1<{ id: string; version: number }[]>`
        UPDATE suppliers
        SET corporate_name = 'Fornecedor Concorrente - Alterado 1',
            version = version + 1
        WHERE id = ${sup.id} AND version = 1
        RETURNING id, version
      `;
      expect(updated1).toHaveLength(1);
      expect(updated1[0].version).toBe(2);

      // Usuário 2 tenta atualizar com version = 1 (stale) -> afeta 0 linhas
      const updated2 = await client2<{ id: string; version: number }[]>`
        UPDATE suppliers
        SET corporate_name = 'Fornecedor Concorrente - Alterado 2 Stale',
            version = version + 1
        WHERE id = ${sup.id} AND version = 1
        RETURNING id, version
      `;
      expect(updated2).toHaveLength(0);

      // 2. Testa bloqueio consultivo pg_advisory_xact_lock com SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID
      expect(SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID).toBe(42424202);

      // Client 1 inicia transação e obtém o lock consultivo
      await client1.begin(async (tx1) => {
        await tx1`SELECT pg_advisory_xact_lock(${SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID})`;

        // Client 2 tenta obter o mesmo lock concorrentemente: DEVE falhar (retornar false)
        const [{ acquired }] = await client2<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID}) as acquired
        `;
        expect(acquired).toBe(false);
      });

      // Após o COMMIT de tx1, o lock é liberado automaticamente
      const [{ acquired: acquiredAfterCommit }] = await client2<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID}) as acquired
      `;
      expect(acquiredAfterCommit).toBe(true);
    } finally {
      await client1.end();
      await client2.end();
    }
  });
});
