import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  listRecentlyReceivedProductIds,
  readStoreHomeSummary,
} from "../../src/modules/store-home/repository";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Início da loja e atalho de produtos recebidos", () => {
  const stamp = Date.now();
  const testDbName = `test_db_store_home_${stamp}`;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;
  let storeId: string;
  const userId = "70000000-0000-0000-0000-000000000001";
  const productA = "70000000-0000-0000-0000-000000000011";
  const productB = "70000000-0000-0000-0000-000000000012";
  const productC = "70000000-0000-0000-0000-000000000013";
  const orderId = "70000000-0000-0000-0000-000000000021";

  beforeAll(async () => {
    const baseDatabaseUrl = process.env.DATABASE_URL!;
    adminClient = postgres(baseDatabaseUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);
    const url = new URL(baseDatabaseUrl);
    url.pathname = `/${testDbName}`;
    const testDatabaseUrl = url.toString();
    await runMigrations({ databaseUrl: testDatabaseUrl, migrationsDirectory: path.resolve("migrations") });
    db = postgres(testDatabaseUrl, { max: 5 });
    process.env.DATABASE_URL = testDatabaseUrl;

    const [store] = await db<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'balneario'`;
    storeId = store.id;

    await db`
      INSERT INTO products (id, erp_code, name, unit, purchase_format, markup, active)
      VALUES (${productA}, 98101, 'Tomate Início', 'KG', 'CX', 30.00, true),
             (${productB}, 98102, 'Banana Início', 'KG', 'CX', 30.00, true),
             (${productC}, 98103, 'Alho Início', 'KG', 'CX', 30.00, true)
    `;
    await db`
      INSERT INTO users (id, name, email, password_hash, role, store_id, permissions, active)
      VALUES (${userId}, 'Loja Início', 'loja.inicio@multishow.local', '$scrypt$N=16384,r=8,p=1$placeholder',
              'LOJA', ${storeId}, ARRAY['pedidos:criar', 'loja:conferencia', 'loja:perdas']::text[], true)
    `;

    // Rascunho de hoje com 2 produtos pedidos (e 1 só com estoque).
    const [draft] = await db<{ id: string }[]>`
      INSERT INTO order_drafts (store_id, order_date, updated_by)
      VALUES (${storeId}, '2026-11-02', ${userId})
      RETURNING id
    `;
    await db`
      INSERT INTO order_draft_items (draft_id, product_id, stock, quantity)
      VALUES (${draft.id}, ${productA}, 1, 3), (${draft.id}, ${productB}, 0, 2), (${draft.id}, ${productC}, 4, 0)
    `;

    // Conferências: a mais recente (31/10) é a usada.
    await db`
      INSERT INTO orders (id, store_id, order_date, purchase_cycle_date, cutoff_at, revision, submitted_at, submitted_by)
      VALUES (${orderId}, ${storeId}, '2026-10-30', '2026-10-31', now(), 1, now(), ${userId})
    `;
    const [older] = await db<{ id: string }[]>`
      INSERT INTO store_delivery_conferences (purchase_cycle_date, store_id, status, total_items, verified_items)
      VALUES ('2026-10-29', ${storeId}, 'IN_PROGRESS', 1, 0)
      RETURNING id
    `;
    await db`
      INSERT INTO store_delivery_conference_items (conference_id, product_id, ordered_quantity, ordered_unit)
      VALUES (${older.id}, ${productC}, 1, 'CX')
    `;
    const [latest] = await db<{ id: string }[]>`
      INSERT INTO store_delivery_conferences (purchase_cycle_date, store_id, order_id, order_revision, status, total_items, verified_items)
      VALUES ('2026-10-31', ${storeId}, ${orderId}, 1, 'IN_PROGRESS', 2, 1)
      RETURNING id
    `;
    await db`
      INSERT INTO store_delivery_conference_items (conference_id, product_id, ordered_quantity, ordered_unit, received_weight_kg, is_unreceived)
      VALUES (${latest.id}, ${productA}, 3, 'CX', 60, false),
             (${latest.id}, ${productB}, 2, 'CX', 0, true)
    `;

    await db`
      INSERT INTO store_loss_records (store_id, product_id, quantity, unit, reason, recorded_by)
      VALUES (${storeId}, ${productA}, 2.5, 'KG', 'Maduro / Passado', ${userId}),
             (${storeId}, ${productB}, 3, 'UND', 'Outro', ${userId})
    `;
  });

  afterAll(async () => {
    try {
      await database().sql.end({ timeout: 5 });
    } catch {}
    if (db) await db.end({ timeout: 5 });
    if (adminClient) {
      await adminClient.unsafe(`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = '${testDbName}' AND pid <> pg_backend_pid()
      `);
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${testDbName}"`);
      await adminClient.end({ timeout: 5 });
    }
  });

  it("resume rascunho, conferência mais recente e perdas do dia", async () => {
    const summary = await readStoreHomeSummary({
      storeId,
      orderDate: "2026-11-02",
      cycleDate: "2026-11-03",
      cutoffAt: new Date("2026-11-02T23:00:00.000Z"),
    });
    expect(summary.order).toMatchObject({ submittedAt: null, draftItems: 2, cycleDate: "2026-11-03" });
    expect(summary.conference).toEqual({ cycleDate: "2026-10-31", status: "IN_PROGRESS", totalItems: 2, verifiedItems: 1 });
    expect(summary.losses).toEqual({ count: 2, kg: 2.5, und: 3 });
  });

  it("lista só o que chegou na conferência mais recente", async () => {
    expect(await listRecentlyReceivedProductIds(storeId)).toEqual([productA]);
  });
});
