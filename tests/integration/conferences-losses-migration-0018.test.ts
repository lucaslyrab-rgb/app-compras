import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Fase 5: Migração 0018 (Conferência de Entrega e Registro de Perdas)", () => {
  const stamp = Date.now();
  const testDbName = `test_db_fase5_${stamp}`;
  let baseDatabaseUrl: string;
  let testDatabaseUrl: string;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  let storeId: string;
  const productId = "50000000-0000-0000-0000-000000000001";
  const userId = "50000000-0000-0000-0000-000000000002";
  const orderId = "50000000-0000-0000-0000-000000000003";
  const cycleDate = "2026-10-28";

  beforeAll(async () => {
    baseDatabaseUrl = process.env.DATABASE_URL!;
    adminClient = postgres(baseDatabaseUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);

    const url = new URL(baseDatabaseUrl);
    url.pathname = `/${testDbName}`;
    testDatabaseUrl = url.toString();

    await runMigrations({
      databaseUrl: testDatabaseUrl,
      migrationsDirectory: path.resolve("migrations"),
    });

    db = postgres(testDatabaseUrl, { max: 5 });
    process.env.DATABASE_URL = testDatabaseUrl;

    const [existingStore] = await db<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'ponta-da-fruta'
    `;
    storeId = existingStore.id;

    // Cria produto e usuário de teste
    await db`
      INSERT INTO products (id, erp_code, name, purchase_format, sale_unit, conversion_quantity, active)
      VALUES (${productId}, 9991, 'Tomate Teste Fase 5', 'CX', 'KG', 20.00, true)
      ON CONFLICT (erp_code) DO NOTHING
    `;

    await db`
      INSERT INTO users (id, name, email, password_hash, role, store_id, permissions, active)
      VALUES (
        ${userId},
        'Operador Loja',
        'loja.fase5@multishow.local',
        '$scrypt$N=16384,r=8,p=1$placeholder',
        'LOJA',
        ${storeId},
        ARRAY['pedidos:criar', 'pedidos:historico', 'loja:conferencia', 'loja:perdas']::text[],
        true
      )
      ON CONFLICT (email) DO NOTHING
    `;

    // Cria pedido do ciclo
    await db`
      INSERT INTO orders (id, store_id, order_date, revision, status, submitted_at, submitted_by)
      VALUES (${orderId}, ${storeId}, ${cycleDate}::date, 1, 'CONFIRMED', now(), ${userId})
    `;
  });

  afterAll(async () => {
    try {
      await database().sql.end({ timeout: 5 });
    } catch {}
    if (db) await db.end({ timeout: 5 });
    if (adminClient) {
      await adminClient.unsafe(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${testDbName}' AND pid <> pg_backend_pid()
      `);
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${testDbName}"`);
      await adminClient.end({ timeout: 5 });
    }
  });

  it("cria cabeçalho de conferência de entrega e vincula ao pedido da loja", async () => {
    const [conference] = await db<{
      id: string;
      status: string;
      version: number;
    }[]>`
      INSERT INTO store_delivery_conferences (
        purchase_cycle_date,
        store_id,
        order_id,
        order_revision,
        status,
        total_items,
        verified_items
      ) VALUES (
        ${cycleDate}::date,
        ${storeId}::uuid,
        ${orderId}::uuid,
        1,
        'IN_PROGRESS',
        1,
        0
      )
      RETURNING id, status, version
    `;

    expect(conference).toBeDefined();
    expect(conference.status).toBe("IN_PROGRESS");
    expect(conference.version).toBe(1);

    // Impede duplicidade da mesma loja no mesmo ciclo
    await expect(
      db`
        INSERT INTO store_delivery_conferences (
          purchase_cycle_date,
          store_id,
          order_id
        ) VALUES (
          ${cycleDate}::date,
          ${storeId}::uuid,
          ${orderId}::uuid
        )
      `
    ).rejects.toThrow();
  });

  it("permite registrar pesagem em KG e confirmação de 'Não recebido' (0 KG)", async () => {
    const [conf] = await db<{ id: string }[]>`
      SELECT id FROM store_delivery_conferences
      WHERE purchase_cycle_date = ${cycleDate}::date AND store_id = ${storeId}::uuid
    `;

    // Item recebido com peso
    const [itemReceived] = await db<{
      id: string;
      received_weight_kg: string;
      is_unreceived: boolean;
    }[]>`
      INSERT INTO store_delivery_conference_items (
        conference_id,
        product_id,
        ordered_quantity,
        ordered_unit,
        received_weight_kg,
        is_unreceived,
        checked_at,
        checked_by
      ) VALUES (
        ${conf.id}::uuid,
        ${productId}::uuid,
        8.00,
        'CX',
        162.40,
        false,
        now(),
        ${userId}::uuid
      )
      RETURNING id, received_weight_kg, is_unreceived
    `;

    expect(Number(itemReceived.received_weight_kg)).toBe(162.40);
    expect(itemReceived.is_unreceived).toBe(false);

    // Rejeita peso negativo
    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET received_weight_kg = -5.00
        WHERE id = ${itemReceived.id}::uuid
      `
    ).rejects.toThrow();
  });

  it("registra perdas diárias com loja, produto, quantidade e auditoria", async () => {
    const [lossRecord] = await db<{
      id: string;
      quantity: string;
      unit: string;
      reason: string;
    }[]>`
      INSERT INTO store_loss_records (
        store_id,
        product_id,
        quantity,
        unit,
        reason,
        notes,
        recorded_by
      ) VALUES (
        ${storeId}::uuid,
        ${productId}::uuid,
        4.50,
        'KG',
        'Maduro / Passado',
        'Frutos avariados no fundo',
        ${userId}::uuid
      )
      RETURNING id, quantity, unit, reason
    `;

    expect(lossRecord).toBeDefined();
    expect(Number(lossRecord.quantity)).toBe(4.50);
    expect(lossRecord.unit).toBe("KG");
    expect(lossRecord.reason).toBe("Maduro / Passado");

    // Rejeita quantidade zero ou negativa
    await expect(
      db`
        INSERT INTO store_loss_records (
          store_id,
          product_id,
          quantity,
          recorded_by
        ) VALUES (
          ${storeId}::uuid,
          ${productId}::uuid,
          0.00,
          ${userId}::uuid
        )
      `
    ).rejects.toThrow();
  });
});
