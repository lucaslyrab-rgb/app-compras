import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it, describe } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Migration 0026: exclusividade legada vira vínculo com a JEB", () => {
  const testDbName = `test_db_legacy_excl_${Date.now()}`;
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

  it("cria o vínculo principal + exclusivo só onde faltava", async () => {
    const [{ id: jeb }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, active)
      VALUES ('JEB DISTRIBUIDORA LTDA', 'JEB', '48336863000160', 'CNPJ', true) RETURNING id
    `;
    const [{ id: wg }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, active) VALUES ('WG EMBALADOS LTDA', 'WG EMBALADOS', true) RETURNING id
    `;
    const [{ id: other }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, active) VALUES ('HORTI SERRA', 'SERRA', true) RETURNING id
    `;
    const products = await db<{ id: string; erp_code: number }[]>`
      INSERT INTO products (erp_code, name, unit, purchase_format, markup, active, exclusive_supplier) VALUES
        (101, 'ALHO JEB', 'KG', 'CX', 25, true, true),
        (102, 'GENGIBRE JEB', 'KG', 'CX', 25, true, true),
        (103, 'VAGEM WG 300G', 'UND', 'UND', 25, true, true),
        (104, 'BANANA', 'KG', 'CX', 25, true, false)
      RETURNING id, erp_code
    `;
    const id = (erp: number) => products.find((p) => p.erp_code === erp)!.id;
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active) VALUES
        (${id(102)}, ${other}, true, false, true),
        (${id(103)}, ${wg}, true, true, true),
        (${id(104)}, ${other}, true, false, true)
    `;

    const sqlText = await readFile("migrations/0026_legacy_exclusive_to_supplier_links.sql", "utf8");
    await db.unsafe(sqlText);
    await db.unsafe(sqlText); // idempotente

    const links = await db<{ erp_code: number; supplier_id: string; is_primary: boolean; is_exclusive: boolean; active: boolean }[]>`
      SELECT p.erp_code, ps.supplier_id, ps.is_primary, ps.is_exclusive, ps.active
      FROM product_suppliers ps JOIN products p ON p.id = ps.product_id
      ORDER BY p.erp_code, ps.is_primary DESC
    `;
    expect(links).toEqual([
      { erp_code: 101, supplier_id: jeb, is_primary: true, is_exclusive: true, active: true },
      { erp_code: 102, supplier_id: jeb, is_primary: true, is_exclusive: true, active: true },
      { erp_code: 102, supplier_id: other, is_primary: false, is_exclusive: false, active: true },
      { erp_code: 103, supplier_id: wg, is_primary: true, is_exclusive: true, active: true },
      { erp_code: 104, supplier_id: other, is_primary: true, is_exclusive: false, active: true },
    ]);
  });
});
