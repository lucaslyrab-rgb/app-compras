import type postgres from "postgres";
import { database } from "@/db/client";
import { BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE } from "../allocations/domain";
import {
  CycleArchiveError,
  isCycleStillOpen,
  type ConferenceSituation,
  type OpenCycleSummary,
} from "./domain";

type Sql = postgres.Sql | postgres.TransactionSql;

/** Data de hoje no fuso operacional, calculada no banco. */
async function operationalToday(sql: Sql): Promise<string> {
  const [{ today }] = await sql<{ today: string }[]>`
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today
  `;
  return today;
}

/** Monta a situação (Destinação + conferência por loja) dos ciclos informados. */
async function summarizeCycles(sql: Sql, cycleDates: string[]): Promise<OpenCycleSummary[]> {
  if (cycleDates.length === 0) return [];

  const [stores, closures, orders, conferences] = await Promise.all([
    sql<{ id: string; name: string }[]>`SELECT id, name FROM stores WHERE active = true ORDER BY name`,
    sql<{ cycle_date: string; status: string }[]>`
      SELECT purchase_cycle_date::text AS cycle_date, status
      FROM purchase_cycle_buyer_closures
      WHERE purchase_cycle_date::text = ANY(${cycleDates}::text[])
    `,
    sql<{ cycle_date: string; store_id: string }[]>`
      SELECT DISTINCT purchase_cycle_date::text AS cycle_date, store_id
      FROM orders
      WHERE cancelled_at IS NULL AND purchase_cycle_date::text = ANY(${cycleDates}::text[])
    `,
    sql<{ cycle_date: string; store_id: string; status: ConferenceSituation; verified_items: number; total_items: number }[]>`
      SELECT purchase_cycle_date::text AS cycle_date, store_id, status, verified_items, total_items
      FROM store_delivery_conferences
      WHERE purchase_cycle_date::text = ANY(${cycleDates}::text[])
    `,
  ]);

  const closureByCycle = new Map(closures.map((c) => [c.cycle_date, c.status]));
  const ordersSet = new Set(orders.map((o) => `${o.cycle_date}|${o.store_id}`));
  const confByKey = new Map(conferences.map((c) => [`${c.cycle_date}|${c.store_id}`, c]));

  return cycleDates.map((cycleDate) => ({
    cycleDate,
    buyerStatus: closureByCycle.get(cycleDate) === "CLOSED" ? "CLOSED" : "OPEN",
    stores: stores.map((store) => {
      const key = `${cycleDate}|${store.id}`;
      const conf = confByKey.get(key);
      return {
        storeId: store.id,
        storeName: store.name,
        hasOrder: ordersSet.has(key),
        conference: conf?.status ?? "NOT_STARTED",
        verifiedItems: conf?.verified_items ?? 0,
        totalItems: conf?.total_items ?? 0,
      };
    }),
  }));
}

/**
 * Ciclos anteriores a hoje que ainda têm algo aberto (Destinação aberta ou loja
 * com pedido sem conferência encerrada) e que ainda não foram encerrados.
 */
export async function listCyclesPendingClosure(): Promise<{ today: string; cycles: OpenCycleSummary[] }> {
  const { sql } = database();
  const today = await operationalToday(sql);

  const rows = await sql<{ cycle_date: string }[]>`
    SELECT cycle_date FROM (
      SELECT DISTINCT purchase_cycle_date::text AS cycle_date FROM orders WHERE cancelled_at IS NULL
      UNION
      SELECT DISTINCT purchase_cycle_date::text FROM purchase_cycle_product_costs
      UNION
      SELECT DISTINCT purchase_cycle_date::text FROM store_delivery_conferences
    ) c
    WHERE cycle_date < ${today}
      AND cycle_date NOT IN (SELECT purchase_cycle_date::text FROM purchase_cycle_archives)
    ORDER BY cycle_date ASC
  `;

  const summaries = await summarizeCycles(sql, rows.map((r) => r.cycle_date));
  return { today, cycles: summaries.filter(isCycleStillOpen) };
}

/**
 * Encerra o ciclo inteiro: fecha a Destinação (fechamento do comprador) e cancela
 * as conferências em andamento, com motivo. As lojas que não iniciaram a
 * conferência deixam de ver o ciclo. Nada é apagado.
 */
export async function archiveCycle(input: { cycleDate: string; reason: string; userId: string }): Promise<OpenCycleSummary> {
  const { sql } = database();

  return await sql.begin(async (tx) => {
    // Mesmo lock usado pela Destinação e pelas notas: serializa com qualquer gravação do ciclo.
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${input.cycleDate}::text))`;

    const today = await operationalToday(tx);
    if (!(input.cycleDate < today)) {
      throw new CycleArchiveError("Somente ciclos anteriores a hoje podem ser encerrados por aqui.");
    }

    const [already] = await tx`SELECT 1 FROM purchase_cycle_archives WHERE purchase_cycle_date = ${input.cycleDate}::date`;
    if (already) throw new CycleArchiveError("Este ciclo já foi encerrado.");

    const [summary] = await summarizeCycles(tx, [input.cycleDate]);

    // 1. Destinação: fechamento do comprador (as travas existentes passam a valer).
    await tx`
      INSERT INTO purchase_cycle_buyer_closures (
        purchase_cycle_date, status, closed_at, closed_by, version, created_at, updated_at
      ) VALUES (
        ${input.cycleDate}::date, 'CLOSED', now(), ${input.userId}::uuid, 1, now(), now()
      )
      ON CONFLICT (purchase_cycle_date) DO UPDATE SET
        status = 'CLOSED',
        closed_at = now(),
        closed_by = ${input.userId}::uuid,
        version = purchase_cycle_buyer_closures.version + 1,
        updated_at = now()
    `;

    // 2. Conferências em andamento: encerradas como canceladas, com o motivo.
    const cancellationReason = `Ciclo encerrado pelo Gestor: ${input.reason}`;
    await tx`
      UPDATE store_delivery_conferences
      SET status = 'CANCELLED',
          cancelled_at = now(),
          cancelled_by = ${input.userId}::uuid,
          cancellation_reason = ${cancellationReason},
          version = version + 1,
          updated_at = now()
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND status = 'IN_PROGRESS'
    `;

    // 3. Registro do encerramento com o retrato do que estava aberto.
    await tx`
      INSERT INTO purchase_cycle_archives (purchase_cycle_date, reason, archived_by, summary)
      VALUES (${input.cycleDate}::date, ${input.reason}, ${input.userId}::uuid, ${JSON.stringify(summary)}::jsonb)
    `;

    await tx`
      INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, metadata, created_at)
      VALUES (
        gen_random_uuid(), ${input.userId}::uuid, 'purchase_cycle.archive', 'purchase_cycle', ${input.cycleDate},
        ${JSON.stringify({ reason: input.reason, summary })}::jsonb, now()
      )
    `;

    return summary;
  });
}
