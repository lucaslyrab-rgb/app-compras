import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  addOutsideOrderItem,
  finalizeConference,
  getStoreConference,
  removeOutsideOrderItem,
} from "../../src/modules/purchasing/conferences/repository";
import { ConferenceValidationError } from "../../src/modules/purchasing/conferences/domain";
import {
  aggregateLossesForManagement,
  cancelStoreLossAsManager,
  recordStoreLoss,
} from "../../src/modules/purchasing/losses/repository";
import { DuplicateLossError, LossValidationError } from "../../src/modules/purchasing/losses/domain";
import { getReconciliation } from "../../src/modules/purchasing/reconciliation/service";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Ajustes pós-Fase 6: perdas, item fora do pedido e fechamento", () => {
  const stamp = Date.now();
  const testDbName = `test_db_pos_fase6_${stamp}`;
  const originalUrl = process.env.DATABASE_URL!;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  const cycleDate = "2026-10-31";
  const ids = {
    alho: "80000000-0000-0000-0000-000000000001",
    gala: "80000000-0000-0000-0000-000000000002",
    loja: "80000000-0000-0000-0000-000000000010",
    gestor: "80000000-0000-0000-0000-000000000011",
    order: "80000000-0000-0000-0000-000000000020",
  };
  let storeId: string;
  let conferenceId: string;
  let version: number;

  beforeAll(async () => {
    adminClient = postgres(originalUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);
    const url = new URL(originalUrl);
    url.pathname = `/${testDbName}`;
    const testDatabaseUrl = url.toString();
    await runMigrations({ databaseUrl: testDatabaseUrl, migrationsDirectory: path.resolve("migrations") });
    db = postgres(testDatabaseUrl, { max: 5 });
    process.env.DATABASE_URL = testDatabaseUrl;

    [{ id: storeId }] = await db<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'balneario'`;

    await db`
      INSERT INTO users (id, name, email, password_hash, role, store_id, permissions, active) VALUES
        (${ids.loja}, 'Loja Balneário', 'loja.posf6@multishow.local', '$scrypt$x', 'LOJA', ${storeId},
          ARRAY['pedidos:criar','loja:conferencia','loja:perdas']::text[], true),
        (${ids.gestor}, 'Gestor', 'gestor.posf6@multishow.local', '$scrypt$x', 'GESTOR', NULL,
          ARRAY['perdas:consultar','perdas:excluir','fechamento:consultar']::text[], true)
    `;
    await db`
      INSERT INTO products (id, erp_code, name, unit, purchase_format, markup, active) VALUES
        (${ids.alho}, 9201, 'ALHO IMPORTADO F6', 'KG', 'CX', 25, true),
        (${ids.gala}, 9202, 'MACA GALA F6', 'KG', 'CX', 25, true)
    `;
    await db`
      INSERT INTO orders (id, store_id, order_date, purchase_cycle_date, cutoff_at, revision, submitted_at, submitted_by)
      VALUES (${ids.order}, ${storeId}, ${cycleDate}::date, ${cycleDate}::date, now(), 1, now(), ${ids.loja})
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${ids.order}, ${ids.alho}, 0, 2, 9201, 'ALHO IMPORTADO F6', 'KG')
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

  describe("perdas", () => {
    const loss = () => ({
      storeId,
      productId: ids.alho,
      quantity: 5,
      unit: "KG",
      reason: "Maduro / Passado",
      userId: ids.loja,
    });

    it("recusa o mesmo lançamento repetido em seguida, inclusive em toques simultâneos", async () => {
      const results = await Promise.allSettled([recordStoreLoss(loss()), recordStoreLoss(loss())]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(DuplicateLossError);
      await expect(recordStoreLoss(loss())).rejects.toBeInstanceOf(DuplicateLossError);
    });

    it("grava a perda igual quando a loja confirma que é outra", async () => {
      await expect(recordStoreLoss({ ...loss(), confirmDuplicate: true })).resolves.toMatchObject({ quantity: 5 });
      const kpis = await aggregateLossesForManagement({ storeId });
      expect(kpis.totalRecords).toBe(2);
    });

    it("permite ao Gestor excluir com motivo, preservando o histórico", async () => {
      const [first] = await db<{ id: string }[]>`
        SELECT id FROM store_loss_records WHERE store_id = ${storeId} AND cancelled_at IS NULL ORDER BY recorded_at LIMIT 1
      `;
      await cancelStoreLossAsManager({ lossId: first.id, userId: ids.gestor, reason: "lançamento duplicado" });

      const [row] = await db`
        SELECT cancelled_at, cancelled_by, cancellation_reason FROM store_loss_records WHERE id = ${first.id}
      `;
      expect(row.cancelled_at).not.toBeNull();
      expect(row.cancelled_by).toBe(ids.gestor);
      expect(row.cancellation_reason).toBe("lançamento duplicado");
      const [audit] = await db`
        SELECT action FROM audit_events WHERE entity_id = ${first.id} AND action = 'store_loss.cancel_by_manager'
      `;
      expect(audit).toBeDefined();
      expect((await aggregateLossesForManagement({ storeId })).totalRecords).toBe(1);

      await expect(
        cancelStoreLossAsManager({ lossId: first.id, userId: ids.gestor, reason: "de novo" }),
      ).rejects.toBeInstanceOf(LossValidationError);
    });
  });

  describe("conferência: item recebido fora do pedido", () => {
    it("lança, impede duplicar e retira item fora do pedido", async () => {
      const conference = (await getStoreConference(storeId, cycleDate))!;
      conferenceId = conference.header.id;
      version = conference.header.version;
      expect(conference.items.map((i) => i.productId)).toEqual([ids.alho]);

      const added = await addOutsideOrderItem({
        conferenceId, storeId, userId: ids.loja, expectedVersion: version, productId: ids.gala, receivedWeightKg: 36,
      });
      version = added.version;
      expect(added.item).toMatchObject({ addedOutsideOrder: true, orderedQuantity: 0, receivedWeightKg: 36, addedByName: "Loja Balneário" });

      await expect(
        addOutsideOrderItem({ conferenceId, storeId, userId: ids.loja, expectedVersion: version, productId: ids.alho, receivedWeightKg: 1 }),
      ).rejects.toBeInstanceOf(ConferenceValidationError);
      await expect(
        removeOutsideOrderItem({ conferenceId, storeId, userId: ids.loja, expectedVersion: version, productId: ids.alho }),
      ).rejects.toBeInstanceOf(ConferenceValidationError);

      const removed = await removeOutsideOrderItem({ conferenceId, storeId, userId: ids.loja, expectedVersion: version, productId: ids.gala });
      version = removed.version;
      expect((await getStoreConference(storeId, cycleDate))!.items.map((i) => i.productId)).toEqual([ids.alho]);

      const again = await addOutsideOrderItem({
        conferenceId, storeId, userId: ids.loja, expectedVersion: version, productId: ids.gala, receivedWeightKg: 36,
      });
      version = again.version;
      const reloaded = (await getStoreConference(storeId, cycleDate))!;
      expect(reloaded.header.totalItems).toBe(2);
      expect(reloaded.header.verifiedItems).toBe(1);
    });

    it("rejeita versão antiga e finaliza com o item fora do pedido", async () => {
      await expect(
        addOutsideOrderItem({ conferenceId, storeId, userId: ids.loja, expectedVersion: version - 1, productId: ids.gala, receivedWeightKg: 1 }),
      ).rejects.toBeInstanceOf(ConferenceValidationError);

      await finalizeConference({
        conferenceId,
        storeId,
        userId: ids.loja,
        expectedVersion: version,
        items: [
          { productId: ids.alho, receivedWeightKg: 40, isUnreceived: false },
          { productId: ids.gala, receivedWeightKg: 36, isUnreceived: false },
        ],
      });
      const final = (await getStoreConference(storeId, cycleDate))!;
      expect(final.header.status).toBe("FINALIZED");
    });

    it("aparece no Fechamento como recebido fora do pedido e sem destinação, com as perdas seguintes", async () => {
      await recordStoreLoss({ storeId, productId: ids.gala, quantity: 20, unit: "KG", reason: "Maduro / Passado", userId: ids.loja });
      await db`UPDATE store_loss_records SET recorded_at = ${`${cycleDate}T15:00:00-03:00`}::timestamptz WHERE product_id = ${ids.gala}`;

      const result = await getReconciliation({ startDate: cycleDate, endDate: cycleDate, storeId, onlyAttention: "0" }, "2026-11-02");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const gala = result.lines.find((l) => l.productId === ids.gala)!;
      expect(gala.order).toBeNull();
      expect(gala.conference.item).toMatchObject({ addedOutsideOrder: true, weightKg: 36, addedByName: "Loja Balneário" });
      expect(gala.highlights).toEqual(["RECEIVED_NOT_DESTINED", "RECEIVED_OUTSIDE_ORDER"]);
      expect(gala.lossesAfter).toEqual({ kg: 20, und: 0, untilDate: "2026-11-03" });
      expect(result.kpis.receivedOutsideOrder).toBe(1);
    });
  });
});
