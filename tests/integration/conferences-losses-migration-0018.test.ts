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
  const productId1 = "50000000-0000-0000-0000-000000000001";
  const productId2 = "50000000-0000-0000-0000-000000000004";
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

    // Cria produtos e usuário de teste com esquema real
    await db`
      INSERT INTO products (id, erp_code, name, unit, purchase_format, markup, active)
      VALUES 
        (${productId1}, 9991, 'Tomate Débora Fase 5', 'KG', 'CX', 30.00, true),
        (${productId2}, 9992, 'Banana Prata Fase 5', 'KG', 'CX', 25.00, true)
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
      ON CONFLICT (lower(email)) DO NOTHING
    `;

    // Cria pedido do ciclo com campos obrigatórios reais (sem coluna status inexistente)
    await db`
      INSERT INTO orders (id, store_id, order_date, purchase_cycle_date, cutoff_at, revision, submitted_at, submitted_by)
      VALUES (${orderId}, ${storeId}, ${cycleDate}::date, ${cycleDate}::date, now(), 1, now(), ${userId})
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
      total_items: number;
      verified_items: number;
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
        2,
        0
      )
      RETURNING id, status, version, total_items, verified_items
    `;

    expect(conference).toBeDefined();
    expect(conference.status).toBe("IN_PROGRESS");
    expect(conference.version).toBe(1);
    expect(conference.total_items).toBe(2);
    expect(conference.verified_items).toBe(0);

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
    ).rejects.toThrow(/store_delivery_conferences_cycle_store_unique/);

    // Impede conferência FINALIZED com itens pendentes ou sem responsável/data
    await expect(
      db`
        INSERT INTO store_delivery_conferences (
          purchase_cycle_date,
          store_id,
          order_id,
          status,
          total_items,
          verified_items
        ) VALUES (
          '2026-10-29'::date,
          ${storeId}::uuid,
          ${orderId}::uuid,
          'FINALIZED',
          2,
          1
        )
      `
    ).rejects.toThrow(/delivery_conf_finalized_coherence_check/);

    // Impede contadores negativos ou verified > total
    await expect(
      db`
        UPDATE store_delivery_conferences
        SET verified_items = 5
        WHERE id = ${conference.id}::uuid
      `
    ).rejects.toThrow(/delivery_conf_items_count_check/);
  });

  it("permite registrar pesagem em KG e confirmação de 'Não recebido' (0 KG) com validação de coerência e rejeição de NaN/NULL", async () => {
    const [conf] = await db<{ id: string }[]>`
      SELECT id FROM store_delivery_conferences
      WHERE purchase_cycle_date = ${cycleDate}::date AND store_id = ${storeId}::uuid
    `;

    // Item 1: Recebido com pesagem positiva em KG
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
        ${productId1}::uuid,
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

    // Item 2: Confirmado como "Não recebido" (exige is_unreceived = true e received_weight_kg = 0.00)
    const [itemUnreceived] = await db<{
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
        ${productId2}::uuid,
        5.00,
        'CX',
        0.00,
        true,
        now(),
        ${userId}::uuid
      )
      RETURNING id, received_weight_kg, is_unreceived
    `;

    expect(Number(itemUnreceived.received_weight_kg)).toBe(0);
    expect(itemUnreceived.is_unreceived).toBe(true);

    // Rejeita "Não recebido" com peso positivo
    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET received_weight_kg = 15.00
        WHERE id = ${itemUnreceived.id}::uuid
      `
    ).rejects.toThrow(/conference_items_weight_coherence_check/);

    // Rejeita "Não recebido" com peso nulo (garantido por received_weight_kg IS NOT NULL)
    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET received_weight_kg = NULL
        WHERE id = ${itemUnreceived.id}::uuid
      `
    ).rejects.toThrow(/conference_items_weight_coherence_check/);

    // Rejeita "Não recebido" com valor inválido NaN
    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET received_weight_kg = 'NaN'::numeric
        WHERE id = ${itemUnreceived.id}::uuid
      `
    ).rejects.toThrow(/conference_items_weight_coherence_check/);

    // Rejeita item recebido (is_unreceived = false) com peso 0
    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET received_weight_kg = 0.00
        WHERE id = ${itemReceived.id}::uuid
      `
    ).rejects.toThrow(/conference_items_weight_coherence_check/);

    // Rejeita item recebido (is_unreceived = false) com valor inválido NaN
    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET received_weight_kg = 'NaN'::numeric
        WHERE id = ${itemReceived.id}::uuid
      `
    ).rejects.toThrow(/conference_items_weight_coherence_check/);

    // Rejeita peso negativo
    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET received_weight_kg = -5.00
        WHERE id = ${itemReceived.id}::uuid
      `
    ).rejects.toThrow(/conference_items_weight_coherence_check/);

    // Rejeita ordered_quantity com valor inválido NaN, zero ou negativo na constraint conference_items_ordered_qty_positive
    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET ordered_quantity = 'NaN'::numeric
        WHERE id = ${itemReceived.id}::uuid
      `
    ).rejects.toThrow(/conference_items_ordered_qty_positive/);

    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET ordered_quantity = 0.00
        WHERE id = ${itemReceived.id}::uuid
      `
    ).rejects.toThrow(/conference_items_ordered_qty_positive/);

    await expect(
      db`
        UPDATE store_delivery_conference_items
        SET ordered_quantity = -5.00
        WHERE id = ${itemReceived.id}::uuid
      `
    ).rejects.toThrow(/conference_items_ordered_qty_positive/);
  });

  it("finaliza a conferência de entrega de forma coerente quando todos os itens estão conferidos", async () => {
    const [conf] = await db<{ id: string }[]>`
      SELECT id FROM store_delivery_conferences
      WHERE purchase_cycle_date = ${cycleDate}::date AND store_id = ${storeId}::uuid
    `;

    // Atualiza verified_items para 2 e finaliza
    const [finalized] = await db<{
      status: string;
      verified_items: number;
      finalized_by: string;
    }[]>`
      UPDATE store_delivery_conferences
      SET
        verified_items = 2,
        status = 'FINALIZED',
        finalized_at = now(),
        finalized_by = ${userId}::uuid
      WHERE id = ${conf.id}::uuid
      RETURNING status, verified_items, finalized_by
    `;

    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.verified_items).toBe(2);
    expect(finalized.finalized_by).toBe(userId);
  });

  it("registra perdas diárias com loja, produto, quantidade, rejeição de NaN e contrato transacional com auditoria", async () => {
    // 1. Rejeita quantidade zero ou negativa na constraint store_losses_quantity_positive
    await expect(
      db`
        INSERT INTO store_loss_records (
          store_id,
          product_id,
          quantity,
          recorded_by
        ) VALUES (
          ${storeId}::uuid,
          ${productId1}::uuid,
          0.00,
          ${userId}::uuid
        )
      `
    ).rejects.toThrow(/store_losses_quantity_positive/);

    await expect(
      db`
        INSERT INTO store_loss_records (
          store_id,
          product_id,
          quantity,
          recorded_by
        ) VALUES (
          ${storeId}::uuid,
          ${productId1}::uuid,
          -2.50,
          ${userId}::uuid
        )
      `
    ).rejects.toThrow(/store_losses_quantity_positive/);

    // 2. Rejeita quantidade NaN (valor numérico inválido)
    await expect(
      db`
        INSERT INTO store_loss_records (
          store_id,
          product_id,
          quantity,
          recorded_by
        ) VALUES (
          ${storeId}::uuid,
          ${productId1}::uuid,
          'NaN'::numeric,
          ${userId}::uuid
        )
      `
    ).rejects.toThrow(/store_losses_quantity_positive/);

    // 3. Contrato transacional atômico: perda e evento de auditoria gravados na mesma transação
    const { lossRecord, auditLog } = await db.begin(async (tx) => {
      const [loss] = await tx<{
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
          ${productId1}::uuid,
          4.50,
          'KG',
          'Maduro / Passado',
          'Frutos avariados no fundo',
          ${userId}::uuid
        )
        RETURNING id, quantity, unit, reason
      `;

      const [audit] = await tx<{
        id: string;
        action: string;
        entity_type: string;
        entity_id: string;
      }[]>`
        INSERT INTO audit_events (
          actor_id,
          action,
          entity_type,
          entity_id,
          metadata
        ) VALUES (
          ${userId}::uuid,
          'store_loss.create',
          'store_loss_records',
          ${loss.id},
          ${JSON.stringify({
            storeId,
            productId: productId1,
            quantity: 4.50,
            unit: 'KG',
            reason: 'Maduro / Passado',
          })}
        )
        RETURNING id, action, entity_type, entity_id
      `;

      return { lossRecord: loss, auditLog: audit };
    });

    expect(lossRecord).toBeDefined();
    expect(Number(lossRecord.quantity)).toBe(4.50);
    expect(lossRecord.unit).toBe("KG");
    expect(lossRecord.reason).toBe("Maduro / Passado");

    expect(auditLog).toBeDefined();
    expect(auditLog.action).toBe("store_loss.create");
    expect(auditLog.entity_type).toBe("store_loss_records");
    expect(auditLog.entity_id).toBe(lossRecord.id);

    // 4. Prova de atomicidade: se o registro de auditoria falhar dentro da transação, a perda não é gravada
    const orphanLossId = "50000000-0000-0000-0000-000000000099";
    await expect(
      db.begin(async (tx) => {
        await tx`
          INSERT INTO store_loss_records (
            id,
            store_id,
            product_id,
            quantity,
            recorded_by
          ) VALUES (
            ${orphanLossId}::uuid,
            ${storeId}::uuid,
            ${productId1}::uuid,
            2.00,
            ${userId}::uuid
          )
        `;
        throw new Error("Falha simulada no registro de auditoria");
      })
    ).rejects.toThrow("Falha simulada no registro de auditoria");

    const [orphanCheck] = await db<{ id: string }[]>`
      SELECT id FROM store_loss_records WHERE id = ${orphanLossId}::uuid
    `;
    expect(orphanCheck).toBeUndefined();
  });
});
