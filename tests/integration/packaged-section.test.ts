import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Migration 0025: seção Embalados", () => {
  const testDbName = `test_db_packaged_${Date.now()}`;
  const originalUrl = process.env.DATABASE_URL!;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  beforeAll(async () => {
    adminClient = postgres(originalUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);
    const url = new URL(originalUrl);
    url.pathname = `/${testDbName}`;
    await runMigrations({ databaseUrl: url.toString(), migrationsDirectory: path.resolve("migrations") });
    db = postgres(url.toString(), { max: 1 });
  });

  afterAll(async () => {
    if (db) await db.end({ timeout: 5 });
    if (adminClient) {
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
      await adminClient.end({ timeout: 5 });
    }
  });

  it("marca como embalados só os produtos exclusivos do WG Embalados", async () => {
    const [{ id: wg }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, active) VALUES ('WG EMBALADOS LTDA', 'WG EMBALADOS', true) RETURNING id
    `;
    const [{ id: other }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, active) VALUES ('JEB DISTRIBUIDORA', 'JEB', true) RETURNING id
    `;
    const products = await db<{ id: string; erp_code: number }[]>`
      INSERT INTO products (erp_code, name, unit, purchase_format, markup, active) VALUES
        (2608, 'VAGEM VERDE WG 300G', 'UND', 'UND', 25, true),
        (2609, 'VAGEM BRANCA WG 300G', 'KG', 'UND', 25, true),
        (35, 'BANANA PRATA', 'KG', 'CX', 25, true),
        (36, 'CEBOLA', 'KG', 'SC', 25, true)
      RETURNING id, erp_code
    `;
    const id = (erp: number) => products.find((p) => p.erp_code === erp)!.id;
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active) VALUES
        (${id(2608)}, ${wg}, true, true, true),
        (${id(2609)}, ${wg}, true, false, true),
        (${id(35)}, ${other}, true, true, true)
    `;

    // Roda de novo a 0025 (é idempotente) com os vínculos já existentes.
    await db.unsafe(await readFile("migrations/0025_products_packaged_section.sql", "utf8"));

    const rows = await db<{ erp_code: number; is_packaged: boolean }[]>`SELECT erp_code, is_packaged FROM products ORDER BY erp_code`;
    expect(rows).toEqual([
      { erp_code: 35, is_packaged: false },
      { erp_code: 36, is_packaged: false },
      { erp_code: 2608, is_packaged: true },
      { erp_code: 2609, is_packaged: false },
    ]);
  });
});
