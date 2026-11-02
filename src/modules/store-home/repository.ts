import { database } from "@/db/client";
import type { StoreHomeConference, StoreHomeLosses, StoreHomeOrder, StoreHomeSummary } from "./domain";

/** Situação do dia da loja para o Início. Somente leitura. */
export async function readStoreHomeSummary(input: {
  storeId: string;
  orderDate: string;
  cycleDate: string;
  cutoffAt: Date;
}): Promise<StoreHomeSummary> {
  const { sql } = database();

  const [submitted] = await sql<{ submitted_at: string; items: number }[]>`
    SELECT o.submitted_at::text AS submitted_at,
           (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id AND oi.quantity > 0) AS items
    FROM orders o
    WHERE o.store_id = ${input.storeId}::uuid
      AND o.purchase_cycle_date = ${input.cycleDate}::date
      AND o.cancelled_at IS NULL
    ORDER BY o.revision DESC
    LIMIT 1
  `;

  const [draft] = await sql<{ items: number }[]>`
    SELECT count(di.product_id)::int AS items
    FROM order_drafts d
    LEFT JOIN order_draft_items di ON di.draft_id = d.id AND di.quantity > 0
    WHERE d.store_id = ${input.storeId}::uuid
      AND d.order_date = ${input.orderDate}::date
  `;

  const order: StoreHomeOrder = {
    submittedAt: submitted?.submitted_at ?? null,
    submittedItems: submitted?.items ?? 0,
    draftItems: draft?.items ?? 0,
    cutoffAt: input.cutoffAt.toISOString(),
    cycleDate: input.cycleDate,
  };

  const [conferenceRow] = await sql<{
    cycle_date: string;
    status: "IN_PROGRESS" | "FINALIZED";
    total_items: number;
    verified_items: number;
  }[]>`
    SELECT c.purchase_cycle_date::text AS cycle_date, c.status, c.total_items, c.verified_items
    FROM store_delivery_conferences c
    WHERE c.store_id = ${input.storeId}::uuid
    ORDER BY c.purchase_cycle_date DESC
    LIMIT 1
  `;

  const conference: StoreHomeConference = conferenceRow
    ? {
        cycleDate: conferenceRow.cycle_date,
        status: conferenceRow.status,
        totalItems: conferenceRow.total_items,
        verifiedItems: conferenceRow.verified_items,
      }
    : null;

  const [lossRow] = await sql<{ count: number; kg: string | null; und: string | null }[]>`
    SELECT count(*)::int AS count,
           COALESCE(sum(quantity) FILTER (WHERE upper(unit) NOT IN ('UND', 'UN', 'UNIDADE')), 0)::text AS kg,
           COALESCE(sum(quantity) FILTER (WHERE upper(unit) IN ('UND', 'UN', 'UNIDADE')), 0)::text AS und
    FROM store_loss_records
    WHERE store_id = ${input.storeId}::uuid
      AND cancelled_at IS NULL
      AND recorded_at >= current_date
  `;

  const losses: StoreHomeLosses = {
    count: lossRow?.count ?? 0,
    kg: Number(lossRow?.kg ?? 0),
    und: Number(lossRow?.und ?? 0),
  };

  return { order, conference, losses };
}

/**
 * Produtos que chegaram na conferência mais recente da loja (recebidos, não os
 * marcados como "não recebido"). Usado como atalho na escolha do produto da perda.
 */
export async function listRecentlyReceivedProductIds(storeId: string, limit = 12): Promise<string[]> {
  const { sql } = database();
  const rows = await sql<{ product_id: string }[]>`
    WITH latest AS (
      SELECT id
      FROM store_delivery_conferences
      WHERE store_id = ${storeId}::uuid
      ORDER BY purchase_cycle_date DESC
      LIMIT 1
    )
    SELECT ci.product_id
    FROM store_delivery_conference_items ci
    INNER JOIN latest ON latest.id = ci.conference_id
    INNER JOIN products p ON p.id = ci.product_id
    WHERE ci.is_unreceived = false
      AND p.active = true
    ORDER BY ci.received_weight_kg DESC NULLS LAST, p.name
    LIMIT ${limit}
  `;
  return rows.map((row) => row.product_id);
}
