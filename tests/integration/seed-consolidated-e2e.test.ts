import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import { seedConsolidatedE2e } from "../../scripts/seed-consolidated-e2e";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Seed E2E Consolidado com Migration 0012", () => {
  const stamp = Date.now();
  const testSchema = `test_seed_e2e_${stamp}`;

  afterAll(async () => {
    if (process.env.DATABASE_URL) {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await sql.end();
    }
  });

  it("executa seed completo após todas as migrations (inclusive 0012) com permissões granulares", async () => {
    const rootSql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await rootSql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`);
    await rootSql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${testSchema},public`);

    // 1. Aplica todas as 12 migrations
    const applied = await runMigrations({
      databaseUrl: isolatedUrl.toString(),
      migrationsDirectory: path.resolve("migrations"),
    });
    expect(applied).toContain("0012_user_permissions_and_management.sql");

    const sql = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // 2. Prepara baseline mínimo: 3 lojas e 10 produtos
      for (let i = 1; i <= 3; i++) {
        await sql`
          INSERT INTO stores (slug, name)
          VALUES (${`loja-${i}`}, ${`Loja ${i}`})
        `;
      }

      for (let i = 1; i <= 10; i++) {
        await sql`
          INSERT INTO products (erp_code, name, unit, purchase_format, markup)
          VALUES (${1000 + i}, ${`Produto ${i}`}, 'CX', 'CX', 0)
        `;
      }

      // 3. Executa o seed
      await seedConsolidatedE2e(isolatedUrl.toString(), "senha-super-segura-e2e-1234", {
        allowCustomSchema: true,
      });

      // 4. Valida os 3 usuários e suas permissões explícitas
      const [loja] = await sql<{ email: string; store_id: string; permissions: string[] }[]>`
        SELECT email, store_id, permissions FROM users WHERE email = 'loja@consolidado.test'
      `;
      expect(loja).toBeDefined();
      expect(loja.store_id).not.toBeNull();
      expect(loja.permissions).toEqual(["pedidos:criar", "pedidos:historico"]);

      const [comprador] = await sql<{ email: string; store_id: string | null; permissions: string[] }[]>`
        SELECT email, store_id, permissions FROM users WHERE email = 'comprador@consolidado.test'
      `;
      expect(comprador).toBeDefined();
      expect(comprador.store_id).toBeNull();
      expect(comprador.permissions).toEqual(["compras:consolidado", "compras:custos"]);

      const [gestor] = await sql<{ email: string; store_id: string | null; permissions: string[] }[]>`
        SELECT email, store_id, permissions FROM users WHERE email = 'gestor@consolidado.test'
      `;
      expect(gestor).toBeDefined();
      expect(gestor.store_id).toBeNull();
      expect(gestor.permissions).toEqual([
        "compras:consolidado",
        "compras:custos",
        "gestor:produtos",
        "gestor:precificacao",
        "gestor:configuracoes",
        "gestor:usuarios",
      ]);

      // 5. Valida integridade dos pedidos e custos criados pelo seed
      const [{ orderCount }] = await sql<[{ orderCount: number }]>`
        SELECT count(*)::int AS "orderCount" FROM orders
      `;
      expect(orderCount).toBeGreaterThan(0);

      const [{ costCount }] = await sql<[{ costCount: number }]>`
        SELECT count(*)::int AS "costCount" FROM purchase_cycle_product_costs
      `;
      expect(costCount).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  });

  it("rejeita execução contra host não local mesmo com allowCustomSchema habilitado", async () => {
    await expect(
      seedConsolidatedE2e("postgres://user:pass@192.168.1.50:5432/consolidado_e2e", "pass", {
        allowCustomSchema: true,
      })
    ).rejects.toThrow("Seed permitido apenas em host local descartável (127.0.0.1 ou localhost)");

    await expect(
      seedConsolidatedE2e("postgres://user:pass@remote-db.production.internal:5432/consolidado_e2e", "pass", {
        allowCustomSchema: true,
      })
    ).rejects.toThrow("Seed permitido apenas em host local descartável (127.0.0.1 ou localhost)");
  });

  it("rejeita banco não descartável se allowCustomSchema for falso ou omitido", async () => {
    await expect(
      seedConsolidatedE2e("postgres://user:pass@127.0.0.1:5432/production_database", "pass")
    ).rejects.toThrow("Seed permitido apenas no banco local descartável consolidado_e2e");
  });
});
