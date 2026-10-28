import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  getStoreConference,
  saveConferenceDraft,
  finalizeConference,
  reconcileConferenceWithCurrentOrder,
} from "../../src/modules/purchasing/conferences/repository";
import {
  recordStoreLoss,
  cancelStoreLoss,
  listTodayLossesForStore,
  queryLossesForManagement,
} from "../../src/modules/purchasing/losses/repository";
import { ConferenceValidationError } from "../../src/modules/purchasing/conferences/domain";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Fase 5: Ações e Serviços de Conferência de Entrega e Perdas", () => {
  const stamp = Date.now();
  const testDbName = `test_db_fase5_actions_${stamp}`;
  let baseDatabaseUrl: string;
  let testDatabaseUrl: string;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  let storeId1: string;
  let storeId2: string;
  const productId1 = "60000000-0000-0000-0000-000000000001";
  const productId2 = "60000000-0000-0000-0000-000000000002";
  const userId1 = "60000000-0000-0000-0000-000000000003";
  const userId2 = "60000000-0000-0000-0000-000000000004";
  const gestorId = "60000000-0000-0000-0000-000000000005";
  const orderId = "60000000-0000-0000-0000-000000000006";
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

    const stores = await db<{ id: string; slug: string }[]>`
      SELECT id, slug FROM stores WHERE slug IN ('ponta-da-fruta', 'balneario')
    `;
    storeId1 = stores.find((s) => s.slug === "ponta-da-fruta")!.id;
    storeId2 = stores.find((s) => s.slug === "balneario")!.id;

    // Cria produtos de teste
    await db`
      INSERT INTO products (id, erp_code, name, unit, purchase_format, markup, active)
      VALUES 
        (${productId1}, 8001, 'Tomate Débora Extra', 'KG', 'CX', 30.00, true),
        (${productId2}, 8002, 'Alface Crespa Hidropônica', 'UND', 'CX', 25.00, true)
      ON CONFLICT (erp_code) DO NOTHING
    `;

    // Cria usuários de teste
    await db`
      INSERT INTO users (id, name, email, password_hash, role, store_id, permissions, active)
      VALUES 
        (
          ${userId1},
          'Operador Loja 1',
          'operador1.fase5@multishow.local',
          '$scrypt$placeholder',
          'LOJA',
          ${storeId1},
          ARRAY['pedidos:criar', 'pedidos:historico', 'loja:conferencia', 'loja:perdas']::text[],
          true
        ),
        (
          ${userId2},
          'Operador Loja 2',
          'operador2.fase5@multishow.local',
          '$scrypt$placeholder',
          'LOJA',
          ${storeId2},
          ARRAY['pedidos:criar', 'pedidos:historico', 'loja:conferencia', 'loja:perdas']::text[],
          true
        ),
        (
          ${gestorId},
          'Gestor Geral',
          'gestor.fase5@multishow.local',
          '$scrypt$placeholder',
          'GESTOR',
          NULL,
          ARRAY['perdas:consultar', 'gestor:produtos']::text[],
          true
        )
      ON CONFLICT (lower(email)) DO NOTHING
    `;

    // Cria pedido confirmado da loja 1 para o ciclo
    await db`
      INSERT INTO orders (id, store_id, order_date, purchase_cycle_date, cutoff_at, revision, submitted_at, submitted_by)
      VALUES (${orderId}, ${storeId1}, ${cycleDate}::date, ${cycleDate}::date, now(), 1, now(), ${userId1})
    `;

    // Cria itens do pedido com quantidade > 0
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES 
        (${orderId}, ${productId1}, 5.00, 8.00, 8001, 'Tomate Débora Extra', 'CX'),
        (${orderId}, ${productId2}, 2.00, 10.00, 8002, 'Alface Crespa Hidropônica', 'CX')
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

  describe("Serviço de Conferência de Entrega", () => {
    let confId: string;
    let version: number;

    it("inicializa automaticamente a conferência a partir dos itens do pedido da loja", async () => {
      const result = await getStoreConference(storeId1, cycleDate);

      expect(result).not.toBeNull();
      expect(result!.header.storeId).toBe(storeId1);
      expect(result!.header.status).toBe("IN_PROGRESS");
      expect(result!.header.totalItems).toBe(2);
      expect(result!.header.verifiedItems).toBe(0);
      expect(result!.header.orderOutOfSync).toBe(false);
      expect(result!.items.length).toBe(2);

      confId = result!.header.id;
      version = result!.header.version;
    });

    it("rejeita gravação com versão desatualizada (concorrência entre operadores)", async () => {
      await expect(
        saveConferenceDraft({
          conferenceId: confId,
          storeId: storeId1,
          userId: userId1,
          expectedVersion: version + 999,
          items: [{ productId: productId1, receivedWeightKg: 162.4, isUnreceived: false }],
        })
      ).rejects.toThrow(ConferenceValidationError);
    });

    it("salva pesagem parcial de itens e atualiza o progresso", async () => {
      const progress = await saveConferenceDraft({
        conferenceId: confId,
        storeId: storeId1,
        userId: userId1,
        expectedVersion: version,
        items: [
          { productId: productId1, receivedWeightKg: 162.4, isUnreceived: false },
          { productId: productId2, receivedWeightKg: null, isUnreceived: false },
        ],
      });

      expect(progress.total).toBe(2);
      expect(progress.verified).toBe(1);
      expect(progress.pending).toBe(1);
      expect(progress.percent).toBe(50);
      version = progress.version;

      // Verifica no banco
      const updated = await getStoreConference(storeId1, cycleDate);
      expect(updated!.header.verifiedItems).toBe(1);
      expect(updated!.header.version).toBe(version);
      expect(updated!.items.find((i) => i.productId === productId1)?.receivedWeightKg).toBe(162.4);
    });

    it("impede finalizar conferência enquanto houver itens pendentes", async () => {
      await expect(
        finalizeConference({
          conferenceId: confId,
          storeId: storeId1,
          userId: userId1,
          expectedVersion: version,
          items: [
            { productId: productId1, receivedWeightKg: 162.4, isUnreceived: false },
            { productId: productId2, receivedWeightKg: null, isUnreceived: false },
          ],
        })
      ).rejects.toThrow(ConferenceValidationError);
    });

    it("permite finalizar conferência quando todos os itens estão pesados ou confirmados como não recebidos", async () => {
      await finalizeConference({
        conferenceId: confId,
        storeId: storeId1,
        userId: userId1,
        expectedVersion: version,
        items: [
          { productId: productId1, receivedWeightKg: 162.4, isUnreceived: false },
          { productId: productId2, receivedWeightKg: 0, isUnreceived: true },
        ],
      });

      const finalized = await getStoreConference(storeId1, cycleDate);
      expect(finalized!.header.status).toBe("FINALIZED");
      expect(finalized!.header.verifiedItems).toBe(2);
      expect(finalized!.header.finalizedBy).toBe(userId1);
      expect(finalized!.header.finalizedAt).not.toBeNull();
      version = finalized!.header.version;

      // Confirma registro do evento de auditoria
      const [auditEvent] = await db<{ action: string; entity_id: string }[]>`
        SELECT action, entity_id
        FROM audit_events
        WHERE action = 'store_delivery_conference.finalize'
          AND entity_id = ${confId}::text
      `;
      expect(auditEvent).toBeDefined();
    });

    it("rejeita alterações adicionais em uma conferência já finalizada", async () => {
      await expect(
        saveConferenceDraft({
          conferenceId: confId,
          storeId: storeId1,
          userId: userId1,
          expectedVersion: version,
          items: [{ productId: productId1, receivedWeightKg: 200, isUnreceived: false }],
        })
      ).rejects.toThrow("já está finalizada");
    });
  });

  describe("Reconciliação de conferência com revisão vigente do pedido", () => {
    const productId3 = "60000000-0000-0000-0000-000000000007";
    const reconcileOrderId1 = "60000000-0000-0000-0000-000000000008";
    const reconcileOrderId2 = "60000000-0000-0000-0000-000000000009";
    const reconcileCycleDate = "2026-10-29";
    let conferenceId: string;

    beforeAll(async () => {
      await db`
        INSERT INTO products (id, erp_code, name, unit, purchase_format, markup, active)
        VALUES (${productId3}, 8003, 'Cebola Roxa', 'KG', 'CX', 28.00, true)
        ON CONFLICT (erp_code) DO NOTHING
      `;

      // Revisão 1: pedido original com productId1 e productId2
      await db`
        INSERT INTO orders (id, store_id, order_date, purchase_cycle_date, cutoff_at, revision, submitted_at, submitted_by)
        VALUES (${reconcileOrderId1}, ${storeId2}, ${reconcileCycleDate}::date, ${reconcileCycleDate}::date, now(), 1, now(), ${userId2})
      `;
      await db`
        INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
        VALUES
          (${reconcileOrderId1}, ${productId1}, 2.00, 5.00, 8001, 'Tomate Débora Extra', 'CX'),
          (${reconcileOrderId1}, ${productId2}, 1.00, 3.00, 8002, 'Alface Crespa Hidropônica', 'CX')
      `;
    });

    it("inicializa a conferência a partir da revisão 1 e permite pesar um item", async () => {
      const initial = await getStoreConference(storeId2, reconcileCycleDate);
      expect(initial).not.toBeNull();
      expect(initial!.header.orderOutOfSync).toBe(false);
      expect(initial!.items.length).toBe(2);
      conferenceId = initial!.header.id;

      const progress = await saveConferenceDraft({
        conferenceId,
        storeId: storeId2,
        userId: userId2,
        expectedVersion: initial!.header.version,
        items: [{ productId: productId1, receivedWeightKg: 5.1, isUnreceived: false }],
      });
      expect(progress.verified).toBe(1);
    });

    it("detecta divergência quando uma revisão 2 substitui o pedido original", async () => {
      // Revisão 2: productId2 saiu, productId1 mudou de quantidade, productId3 é novo
      await db`
        INSERT INTO orders (id, store_id, order_date, purchase_cycle_date, cutoff_at, revision, submitted_at, submitted_by)
        VALUES (${reconcileOrderId2}, ${storeId2}, ${reconcileCycleDate}::date, ${reconcileCycleDate}::date, now(), 2, now(), ${userId2})
      `;
      await db`
        INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
        VALUES
          (${reconcileOrderId2}, ${productId1}, 2.00, 7.00, 8001, 'Tomate Débora Extra', 'CX'),
          (${reconcileOrderId2}, ${productId3}, 0.00, 4.00, 8003, 'Cebola Roxa', 'CX')
      `;

      const afterRevision = await getStoreConference(storeId2, reconcileCycleDate);
      expect(afterRevision!.header.orderOutOfSync).toBe(true);
      // A lista ativa ainda reflete a revisão antiga até a reconciliação explícita.
      expect(afterRevision!.items.some((it) => it.productId === productId2)).toBe(true);
    });

    it("bloqueia finalização enquanto a conferência estiver desatualizada", async () => {
      const stale = await getStoreConference(storeId2, reconcileCycleDate);
      await expect(
        finalizeConference({
          conferenceId,
          storeId: storeId2,
          userId: userId2,
          expectedVersion: stale!.header.version,
          items: stale!.items.map((it) => ({
            productId: it.productId,
            receivedWeightKg: it.productId === productId1 ? 5.1 : 0,
            isUnreceived: it.productId !== productId1,
          })),
        })
      ).rejects.toThrow("revisado ou cancelado");
    });

    it("reconcilia preservando a pesagem aproveitável e marcando o item removido sem apagar histórico", async () => {
      const reconciled = await reconcileConferenceWithCurrentOrder({
        conferenceId,
        storeId: storeId2,
        userId: userId2,
      });

      expect(reconciled).not.toBeNull();
      expect(reconciled!.header.orderOutOfSync).toBe(false);
      expect(reconciled!.header.orderRevision).toBe(2);
      expect(reconciled!.header.totalItems).toBe(2);
      expect(reconciled!.header.verifiedItems).toBe(1);

      const activeProductIds = reconciled!.items.map((it) => it.productId);
      expect(activeProductIds).toContain(productId1);
      expect(activeProductIds).toContain(productId3);
      expect(activeProductIds).not.toContain(productId2);

      // Pesagem já registrada para o item que permanece é preservada.
      const tomate = reconciled!.items.find((it) => it.productId === productId1);
      expect(tomate?.receivedWeightKg).toBe(5.1);
      expect(Number(tomate?.orderedQuantity)).toBe(7);

      // O item removido não foi apagado: continua no banco, apenas marcado.
      const [removedRow] = await db<{ removed_from_order: boolean; received_weight_kg: string | null }[]>`
        SELECT removed_from_order, received_weight_kg
        FROM store_delivery_conference_items
        WHERE conference_id = ${conferenceId}::uuid AND product_id = ${productId2}::uuid
      `;
      expect(removedRow).toBeDefined();
      expect(removedRow.removed_from_order).toBe(true);

      const [auditEvent] = await db<{ action: string }[]>`
        SELECT action FROM audit_events
        WHERE action = 'store_delivery_conference.reconcile' AND entity_id = ${conferenceId}::text
      `;
      expect(auditEvent).toBeDefined();
    });

    it("permite finalizar normalmente após a reconciliação", async () => {
      const synced = await getStoreConference(storeId2, reconcileCycleDate);
      expect(synced!.header.orderOutOfSync).toBe(false);

      await finalizeConference({
        conferenceId,
        storeId: storeId2,
        userId: userId2,
        expectedVersion: synced!.header.version,
        items: [
          { productId: productId1, receivedWeightKg: 5.1, isUnreceived: false },
          { productId: productId3, receivedWeightKg: 4, isUnreceived: false },
        ],
      });

      const finalized = await getStoreConference(storeId2, reconcileCycleDate);
      expect(finalized!.header.status).toBe("FINALIZED");
      expect(finalized!.header.verifiedItems).toBe(2);
    });
  });

  describe("Serviço de Registro e Consulta de Perdas", () => {
    let lossRecordId: string;

    it("grava descarte de perda atomicamente com evento de auditoria", async () => {
      const loss = await recordStoreLoss({
        storeId: storeId1,
        productId: productId1,
        quantity: 4.5,
        unit: "KG",
        reason: "Maduro / Passado",
        notes: "Tomates amassados",
        userId: userId1,
      });

      expect(loss.id).toBeDefined();
      expect(loss.quantity).toBe(4.5);
      expect(loss.unit).toBe("KG");
      expect(loss.reason).toBe("Maduro / Passado");
      lossRecordId = loss.id;

      // Confirma evento em audit_events
      const [audit] = await db<{ action: string; entity_id: string }[]>`
        SELECT action, entity_id
        FROM audit_events
        WHERE action = 'store_loss.create' AND entity_id = ${loss.id}::text
      `;
      expect(audit).toBeDefined();
      expect(audit.action).toBe("store_loss.create");
    });

    it("permite registrar perda com unidade UND", async () => {
      const lossUnd = await recordStoreLoss({
        storeId: storeId1,
        productId: productId2,
        quantity: 6,
        unit: "UND",
        reason: "Avaria no Transporte",
        userId: userId1,
      });

      expect(lossUnd.quantity).toBe(6);
      expect(lossUnd.unit).toBe("UND");
    });

    it("lista perdas ativas de hoje da loja com totalizadores corretos", async () => {
      const todayLosses = await listTodayLossesForStore(storeId1);
      expect(todayLosses.length).toBe(2);

      const kgLoss = todayLosses.find((l) => l.unit === "KG");
      const undLoss = todayLosses.find((l) => l.unit === "UND");
      expect(kgLoss?.quantity).toBe(4.5);
      expect(undLoss?.quantity).toBe(6);
    });

    it("permite cancelar/excluir lançamento de perda com auditoria", async () => {
      await cancelStoreLoss({
        lossId: lossRecordId,
        storeId: storeId1,
        userId: userId1,
        reason: "Lançamento em duplicidade",
      });

      // Confirma que não aparece mais nas perdas ativas da loja
      const todayLosses = await listTodayLossesForStore(storeId1);
      expect(todayLosses.some((l) => l.id === lossRecordId)).toBe(false);

      // Confirma auditoria de cancelamento
      const [cancelAudit] = await db<{ action: string; entity_id: string }[]>`
        SELECT action, entity_id
        FROM audit_events
        WHERE action = 'store_loss.cancel' AND entity_id = ${lossRecordId}::text
      `;
      expect(cancelAudit).toBeDefined();
    });

    it("permite ao Gestor consultar perdas consolidadas de todas as lojas com filtros", async () => {
      const results = await queryLossesForManagement({
        storeId: storeId1,
      });

      // Deve listar apenas o registro não cancelado (Alface)
      expect(results.length).toBe(1);
      expect(results[0].productName).toBe("Alface Crespa Hidropônica");
      expect(results[0].unit).toBe("UND");
    });
  });
});
