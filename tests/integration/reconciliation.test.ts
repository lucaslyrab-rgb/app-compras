import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import { loadReconciliationSources } from "../../src/modules/purchasing/reconciliation/repository";
import { getReconciliation } from "../../src/modules/purchasing/reconciliation/service";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

const SOURCE_TABLES = [
  "orders",
  "order_items",
  "purchase_cycle_product_allocations",
  "purchase_cycle_product_supplier_decisions",
  "purchase_cycle_store_closures",
  "store_delivery_conferences",
  "store_delivery_conference_items",
  "store_loss_records",
  "purchase_cycle_invoices",
  "product_pricing_parameters",
  "products",
] as const;

integration("Fase 6: Fechamento integrado (leitura do confronto)", () => {
  const stamp = Date.now();
  const testDbName = `test_db_fase6_reconciliation_${stamp}`;
  const originalUrl = process.env.DATABASE_URL!;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  const cycleDate = "2026-10-27";
  const ids = {
    abacate: "70000000-0000-0000-0000-000000000001",
    tomate: "70000000-0000-0000-0000-000000000002",
    gengibre: "70000000-0000-0000-0000-000000000003",
    abacaxi: "70000000-0000-0000-0000-000000000004",
    loja: "70000000-0000-0000-0000-000000000010",
    comprador: "70000000-0000-0000-0000-000000000011",
    gestor: "70000000-0000-0000-0000-000000000012",
    order1: "70000000-0000-0000-0000-000000000020",
    order2: "70000000-0000-0000-0000-000000000021",
    conference: "70000000-0000-0000-0000-000000000030",
  };
  let storeId: string;
  let supplierId: string;

  async function countSourceRows() {
    const counts: Record<string, number> = {};
    for (const table of SOURCE_TABLES) {
      const [{ total }] = await db.unsafe<{ total: number }[]>(`SELECT count(*)::int AS total FROM ${table}`);
      counts[table] = total;
    }
    return counts;
  }

  beforeAll(async () => {
    adminClient = postgres(originalUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);
    const url = new URL(originalUrl);
    url.pathname = `/${testDbName}`;
    const testDatabaseUrl = url.toString();

    db = postgres(testDatabaseUrl, { max: 5 });
    await runMigrations({ databaseUrl: testDatabaseUrl, migrationsDirectory: path.resolve("migrations") });
    process.env.DATABASE_URL = testDatabaseUrl;

    [{ id: storeId }] = await db<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'ponta-da-fruta'`;

    await db`
      INSERT INTO users (id, name, email, password_hash, role, store_id, permissions, active) VALUES
        (${ids.loja}, 'Loja F6', 'loja.f6@multishow.local', '$scrypt$x', 'LOJA', ${storeId},
          ARRAY['pedidos:criar','pedidos:historico','loja:conferencia']::text[], true),
        (${ids.comprador}, 'Comprador F6', 'comprador.f6@multishow.local', '$scrypt$x', 'COMPRADOR', NULL,
          ARRAY['compras:destinacao']::text[], true),
        (${ids.gestor}, 'Gestor F6', 'gestor.f6@multishow.local', '$scrypt$x', 'GESTOR', NULL,
          ARRAY['gestor:produtos','fechamento:consultar']::text[], true)
    `;

    await db`
      INSERT INTO products (id, erp_code, name, unit, purchase_format, markup, active) VALUES
        (${ids.abacate}, 9101, 'ABACATE KG F6', 'KG', 'CX', 25, true),
        (${ids.tomate}, 9102, 'TOMATE KG F6', 'KG', 'CX', 25, true),
        (${ids.gengibre}, 9103, 'GENGIBRE KG F6', 'KG', 'CX', 25, true),
        (${ids.abacaxi}, 9104, 'ABACAXI UN F6', 'UND', 'UND', 25, true)
    `;
    await db`
      INSERT INTO product_pricing_parameters (product_id, sale_unit, conversion_quantity, conversion_origin, beneficiation_loss_percent)
      VALUES (${ids.abacate}, 'KG', 20, 'MANUAL', 0),
             (${ids.tomate}, 'KG', 20, 'MANUAL', 0),
             (${ids.gengibre}, 'KG', 10, 'MANUAL', 0),
             (${ids.abacaxi}, 'UND', 10, 'MANUAL', 0)
      ON CONFLICT (product_id) DO UPDATE SET sale_unit = EXCLUDED.sale_unit, conversion_quantity = EXCLUDED.conversion_quantity
    `;

    [{ id: supplierId }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Ademar Kerckhoff ME', 'Ademar', '33333333000133', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // Revisão 1 (fechada pelo comprador) e revisão 2 enviada depois do fechamento.
    await db`
      INSERT INTO orders (id, store_id, order_date, purchase_cycle_date, cutoff_at, revision, submitted_at, submitted_by) VALUES
        (${ids.order1}, ${storeId}, ${cycleDate}::date, ${cycleDate}::date, now(), 1, now(), ${ids.loja}),
        (${ids.order2}, ${storeId}, ${cycleDate}::date, ${cycleDate}::date, now(), 2, now(), ${ids.loja})
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit) VALUES
        (${ids.order1}, ${ids.abacate}, 0, 3, 9101, 'ABACATE KG F6', 'KG'),
        (${ids.order1}, ${ids.tomate}, 0, 8, 9102, 'TOMATE KG F6', 'KG'),
        (${ids.order2}, ${ids.abacate}, 0, 5, 9101, 'ABACATE KG F6', 'KG')
    `;
    await db`
      INSERT INTO purchase_cycle_store_closures
        (purchase_cycle_date, store_id, order_id, order_revision, status, allocations_hash, closed_at, closed_by, is_current)
      VALUES (${cycleDate}::date, ${storeId}, ${ids.order1}, 1, 'CLOSED', 'hash-f6', now(), ${ids.comprador}, true)
    `;

    await db`
      INSERT INTO purchase_cycle_product_allocations
        (purchase_cycle_date, supplier_id, product_id, store_id, ordered_quantity, destined_quantity, purchase_format,
         is_additional_purchase, conversion_factor_kg, conversion_origin, created_by, updated_by)
      VALUES
        (${cycleDate}::date, ${supplierId}, ${ids.abacate}, ${storeId}, 3, 3, 'CX', false, 20, 'MANUAL', ${ids.comprador}, ${ids.comprador}),
        (${cycleDate}::date, ${supplierId}, ${ids.gengibre}, ${storeId}, 0, 1, 'CX', true, 10, 'MANUAL', ${ids.comprador}, ${ids.comprador})
    `;
    await db`
      INSERT INTO purchase_cycle_product_supplier_decisions
        (purchase_cycle_date, supplier_id, product_id, store_id, decision, created_by, updated_by)
      VALUES (${cycleDate}::date, ${supplierId}, ${ids.tomate}, ${storeId}, 'NOT_PURCHASED', ${ids.comprador}, ${ids.comprador})
    `;

    await db`
      INSERT INTO store_delivery_conferences
        (id, purchase_cycle_date, store_id, order_id, order_revision, status, total_items, verified_items, finalized_at, finalized_by)
      VALUES (${ids.conference}, ${cycleDate}::date, ${storeId}, ${ids.order1}, 1, 'FINALIZED', 2, 2, now(), ${ids.loja})
    `;
    await db`
      INSERT INTO store_delivery_conference_items
        (conference_id, product_id, ordered_quantity, ordered_unit, received_weight_kg, is_unreceived, checked_at, checked_by)
      VALUES
        (${ids.conference}, ${ids.abacate}, 3, 'CX', 52.30, false, now(), ${ids.loja}),
        (${ids.conference}, ${ids.tomate}, 8, 'CX', 0, true, now(), ${ids.loja})
    `;
  });

  afterAll(async () => {
    try {
      await database().sql.end({ timeout: 5 });
    } catch {}
    process.env.DATABASE_URL = originalUrl;
    if (db) await db.end({ timeout: 5 });
    if (adminClient) {
      await adminClient.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${testDbName}' AND pid <> pg_backend_pid()`,
      );
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${testDbName}"`);
      await adminClient.end({ timeout: 5 });
    }
  });

  it("migration 0021 aceita a permissão e a recusa para valores desconhecidos", async () => {
    await expect(
      db`UPDATE users SET permissions = ARRAY['fechamento:consultar']::text[] WHERE id = ${ids.comprador}`,
    ).resolves.toBeDefined();
    await expect(
      db`UPDATE users SET permissions = ARRAY['fechamento:qualquer']::text[] WHERE id = ${ids.comprador}`,
    ).rejects.toThrow();
    await db`UPDATE users SET permissions = ARRAY['compras:destinacao']::text[] WHERE id = ${ids.comprador}`;
  });

  it("usa a revisão do fechamento vigente como referência", async () => {
    const sources = await loadReconciliationSources({ startDate: cycleDate, endDate: cycleDate, storeId });
    expect(sources.referenceOrders).toEqual([
      { cycleDate, storeId, orderId: ids.order1, revision: 1, source: "CLOSURE" },
    ]);
    expect(sources.orderItems.map((i) => i.productId).sort()).toEqual([ids.abacate, ids.tomate].sort());
  });

  it("monta o confronto com situação, peso esperado e destaques sem alterar nenhuma tabela", async () => {
    const before = await countSourceRows();

    const result = await getReconciliation(
      { startDate: cycleDate, endDate: cycleDate, storeId, onlyAttention: "0" },
      "2026-10-29",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byProduct = Object.fromEntries(result.lines.map((l) => [l.productId, l]));

    const abacate = byProduct[ids.abacate];
    expect(abacate.order).toMatchObject({ quantity: 3, unit: "CX", revision: 1, source: "CLOSURE" });
    expect(abacate.cut.situation).toBe("INTEGRAL");
    expect(abacate.expected).toEqual({ kg: 60, source: "DESTINATION_FACTOR" });
    expect(abacate.weight).toEqual({ differenceKg: -7.7, differencePercent: -12.8, range: "OUT_OF_RANGE" });
    expect(abacate.highlights).toEqual(["WEIGHT_OUT_OF_RANGE"]);

    const tomate = byProduct[ids.tomate];
    expect(tomate.cut.situation).toBe("TOTAL_CUT");
    expect(tomate.notPurchased).toBe(true);
    expect(tomate.conference.item?.isUnreceived).toBe(true);
    expect(tomate.highlights).toEqual([]);

    const gengibre = byProduct[ids.gengibre];
    expect(gengibre.cut.situation).toBe("ADDITIONAL");
    expect(gengibre.highlights).toEqual(["DESTINED_OUT_OF_CONFERENCE"]);

    expect(result.kpis).toMatchObject({ weightOutOfRange: 1, outOfConference: 1, notReceived: 0, pendingConferences: 0 });
    expect(result.suppliers).toEqual([{ id: supplierId, name: "Ademar" }]);

    expect(await countSourceRows()).toEqual(before);
  });

  it("por padrão mostra somente os itens com destaque", async () => {
    const result = await getReconciliation({ startDate: cycleDate, endDate: cycleDate }, "2026-10-29");
    expect(result.ok && result.lines.map((l) => l.productId).sort()).toEqual([ids.abacate, ids.gengibre].sort());
  });

  it("recusa período acima de 31 dias sem consultar o banco", async () => {
    const result = await getReconciliation({ startDate: "2026-08-01", endDate: "2026-10-29" }, "2026-10-29");
    expect(result.ok).toBe(false);
  });
});
