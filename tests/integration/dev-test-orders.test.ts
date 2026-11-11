import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import { createTestOrders, TEST_SUPPLIERS } from "../../scripts/dev-orders";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Ambiente local: npm run dev:pedidos", () => {
  const testDbName = `test_db_dev_orders_${Date.now()}`;
  const originalUrl = process.env.DATABASE_URL!;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;
  let testDatabaseUrl: string;

  beforeAll(async () => {
    adminClient = postgres(originalUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);
    const url = new URL(originalUrl);
    url.pathname = `/${testDbName}`;
    testDatabaseUrl = url.toString();
    await runMigrations({ databaseUrl: testDatabaseUrl, migrationsDirectory: path.resolve("migrations") });
    db = postgres(testDatabaseUrl, { max: 2 });
    process.env.DATABASE_URL = testDatabaseUrl;

    for (let i = 0; i < 40; i++) {
      await db`
        INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
        VALUES (${9500 + i}, ${`PRODUTO DEV ${i}`}, 'CX', 'KG', 25, true)
      `;
    }
    const stores = await db<{ id: string; slug: string }[]>`SELECT id, slug FROM stores WHERE active`;
    for (const store of stores) {
      await db`
        INSERT INTO users (name, email, password_hash, role, store_id, permissions, active)
        VALUES (${`Loja ${store.slug}`}, ${`loja-${store.slug}@local.test`}, '$scrypt$x', 'LOJA', ${store.id},
          ARRAY['pedidos:criar','pedidos:historico','loja:conferencia','loja:perdas']::text[], true)
      `;
    }
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

  it("cria um pedido por loja no ciclo atual e os fornecedores de teste", async () => {
    const result = await createTestOrders(testDatabaseUrl, new Date(), () => {});
    expect(result.stores).toHaveLength(3);
    expect(result.stores.every((store) => store.status === "created" && store.items >= 15 && store.items <= 25)).toBe(true);

    const orders = await db<{ store_id: string; items: number; cycle: string }[]>`
      SELECT o.store_id, count(oi.*)::int AS items, o.purchase_cycle_date::text AS cycle
      FROM orders o JOIN order_items oi ON oi.order_id = o.id
      GROUP BY o.id
    `;
    expect(orders).toHaveLength(3);
    expect(new Set(orders.map((order) => order.cycle))).toEqual(new Set([result.cycleDate]));
    const [{ count }] = await db<{ count: number }[]>`
      SELECT count(*)::int AS count FROM suppliers WHERE corporate_name = ANY(${TEST_SUPPLIERS})
    `;
    expect(count).toBe(TEST_SUPPLIERS.length);
  });

  it("rodar de novo não duplica pedidos nem fornecedores", async () => {
    const result = await createTestOrders(testDatabaseUrl, new Date(), () => {});
    expect(result.stores.map((store) => store.status)).toEqual(["skipped-existing", "skipped-existing", "skipped-existing"]);
    const [{ orders }] = await db<{ orders: number }[]>`SELECT count(*)::int AS orders FROM orders`;
    expect(orders).toBe(3);
    const [{ suppliers }] = await db<{ suppliers: number }[]>`SELECT count(*)::int AS suppliers FROM suppliers`;
    expect(suppliers).toBe(TEST_SUPPLIERS.length);
  });
});
