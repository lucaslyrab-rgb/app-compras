import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import { getClosingOverview } from "../../src/modules/purchasing/reconciliation/closing-service";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Fechamento integrado v1.2: caminho dos produtos e valor por loja", () => {
  const testDbName = `test_db_closing_overview_${Date.now()}`;
  const originalUrl = process.env.DATABASE_URL!;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  const cycleDate = "2026-11-04";
  const ids = {
    laranja: "71000000-0000-0000-0000-000000000001",
    tomate: "71000000-0000-0000-0000-000000000002",
    loja: "71000000-0000-0000-0000-000000000010",
    comprador: "71000000-0000-0000-0000-000000000011",
    order: "71000000-0000-0000-0000-000000000020",
    conference: "71000000-0000-0000-0000-000000000030",
  };
  let storeId: string;
  let supplierId: string;

  beforeAll(async () => {
    adminClient = postgres(originalUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);
    const url = new URL(originalUrl);
    url.pathname = `/${testDbName}`;
    const testDatabaseUrl = url.toString();
    await runMigrations({ databaseUrl: testDatabaseUrl, migrationsDirectory: path.resolve("migrations") });
    db = postgres(testDatabaseUrl, { max: 3 });
    process.env.DATABASE_URL = testDatabaseUrl;

    [{ id: storeId }] = await db<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'ponta-da-fruta'`;
    await db`
      INSERT INTO users (id, name, email, password_hash, role, store_id, permissions, active) VALUES
        (${ids.loja}, 'Loja CL', 'loja.cl@multishow.local', '$scrypt$x', 'LOJA', ${storeId},
          ARRAY['pedidos:criar','loja:conferencia']::text[], true),
        (${ids.comprador}, 'Christian', 'comprador.cl@multishow.local', '$scrypt$x', 'COMPRADOR', NULL,
          ARRAY['compras:destinacao','compras:custos']::text[], true)
    `;
    await db`
      INSERT INTO products (id, erp_code, name, unit, purchase_format, markup, active) VALUES
        (${ids.laranja}, 9201, 'LARANJA CL', 'KG', 'CX', 25, true),
        (${ids.tomate}, 9202, 'TOMATE CL', 'KG', 'CX', 25, true)
    `;
    await db`
      INSERT INTO product_pricing_parameters (product_id, sale_unit, conversion_quantity, conversion_origin, beneficiation_loss_percent)
      VALUES (${ids.laranja}, 'KG', 20, 'MANUAL', 0), (${ids.tomate}, 'KG', 20, 'MANUAL', 0)
      ON CONFLICT (product_id) DO UPDATE SET sale_unit = EXCLUDED.sale_unit, conversion_quantity = EXCLUDED.conversion_quantity
    `;
    [{ id: supplierId }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, active) VALUES ('Frutas do Vale Ltda', 'Frutas do Vale', true) RETURNING id
    `;
    await db`
      INSERT INTO orders (id, store_id, order_date, purchase_cycle_date, cutoff_at, revision, submitted_at, submitted_by)
      VALUES (${ids.order}, ${storeId}, ${cycleDate}::date, ${cycleDate}::date, now(), 1, now(), ${ids.loja})
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit) VALUES
        (${ids.order}, ${ids.laranja}, 0, 6, 9201, 'LARANJA CL', 'KG'),
        (${ids.order}, ${ids.tomate}, 0, 4, 9202, 'TOMATE CL', 'KG')
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${ids.laranja}, 62.00, true, now(), ${ids.comprador})
    `;
    await db`
      INSERT INTO purchase_cycle_product_allocations
        (purchase_cycle_date, supplier_id, product_id, store_id, ordered_quantity, destined_quantity, purchase_format,
         is_additional_purchase, conversion_factor_kg, conversion_origin, created_by, updated_by)
      VALUES (${cycleDate}::date, ${supplierId}, ${ids.laranja}, ${storeId}, 6, 6, 'CX', false, 20, 'MANUAL', ${ids.comprador}, ${ids.comprador})
    `;
    await db`
      INSERT INTO purchase_cycle_invoices (purchase_cycle_date, store_id, supplier_id, invoice_number, image_s3_key, file_size_bytes, created_by)
      VALUES (${cycleDate}::date, ${storeId}, ${supplierId}, '4521', 'invoices/x.webp', 100, ${ids.comprador})
    `;
    await db`
      INSERT INTO store_delivery_conferences
        (id, purchase_cycle_date, store_id, order_id, order_revision, status, total_items, verified_items, finalized_at, finalized_by)
      VALUES (${ids.conference}, ${cycleDate}::date, ${storeId}, ${ids.order}, 1, 'FINALIZED', 2, 2, now(), ${ids.loja})
    `;
    await db`
      INSERT INTO store_delivery_conference_items
        (conference_id, product_id, ordered_quantity, ordered_unit, received_weight_kg, is_unreceived, checked_at, checked_by)
      VALUES (${ids.conference}, ${ids.laranja}, 6, 'CX', 118.20, false, now(), ${ids.loja})
    `;
  });

  afterAll(async () => {
    try {
      await database().sql.end({ timeout: 5 });
    } catch {}
    process.env.DATABASE_URL = originalUrl;
    if (db) await db.end({ timeout: 5 });
    if (adminClient) {
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
      await adminClient.end({ timeout: 5 });
    }
  });

  it("mostra o caminho de cada produto com custo, fornecedor, nota e pesagem", async () => {
    const overview = await getClosingOverview({}, "2026-11-10");
    expect(overview.filters.cycleDate).toBe(cycleDate);
    expect(overview.cycles).toEqual([cycleDate]);

    const byName = new Map(overview.journeys.map((j) => [j.productName, j]));
    expect(byName.get("TOMATE CL")!.issues).toEqual(["NOT_PURCHASED"]);
    const laranja = byName.get("LARANJA CL")!;
    expect(laranja.issues).toEqual([]);
    expect(laranja.purchase).toEqual({ purchased: true, cost: 62, by: "Christian" });
    expect(laranja.destination?.suppliers[0]).toMatchObject({ supplierName: "Frutas do Vale", quantity: 6, invoices: ["4521"] });
    expect(laranja.conference).toMatchObject({ expectedKg: 120, receivedKg: 118.2, percent: -1.5, storesFinalized: 1 });
    expect(overview.summary?.counts).toMatchObject({ NOT_PURCHASED: 1, OK: 1 });
  });

  it("calcula o valor comprado e recebido da loja e por fornecedor", async () => {
    const overview = await getClosingOverview({ ciclo: cycleDate, aba: "valores" }, "2026-11-10");
    expect(overview.filters.tab).toBe("valores");
    const ponta = overview.values!.stores.find((s) => s.storeId === storeId)!;
    expect(ponta).toMatchObject({
      purchasedValue: 372,
      receivedValue: 366.42,
      difference: -5.58,
      share: 100,
      conference: { state: "FINALIZED", totalItems: 2, verifiedItems: 2 },
    });
    expect(ponta.suppliers).toEqual([
      expect.objectContaining({ supplierName: "Frutas do Vale", invoices: ["4521"], purchasedValue: 372, receivedValue: 366.42 }),
    ]);
  });

  it("filtra por desfecho sem mudar o resumo do ciclo", async () => {
    const overview = await getClosingOverview({ ciclo: cycleDate, desfecho: "NOT_PURCHASED" }, "2026-11-10");
    expect(overview.journeys.map((j) => j.productName)).toEqual(["TOMATE CL"]);
    expect(overview.summary?.total).toBe(2);
  });
});
