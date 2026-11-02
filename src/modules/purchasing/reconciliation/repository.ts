import { database } from "@/db/client";
import { LOSS_WINDOW_DAYS, shiftIsoDate } from "./domain";
import type {
  ReconciliationSources,
  SourceAllocation,
  SourceConference,
  SourceConferenceItem,
  SourceLoss,
  SourceNotPurchased,
  SourceOrderItem,
  SourceProduct,
  SourceReferenceOrder,
  SourceStore,
} from "./domain";

/**
 * Leitura do Fechamento integrado (Fase 6).
 *
 * SOMENTE LEITURA: este arquivo executa apenas SELECT. Um teste arquitetural
 * falha se aparecer qualquer comando de escrita aqui. O confronto é calculado
 * a partir dos registros originais e nunca grava cópias.
 */

export type ReconciliationQuery = {
  startDate: string;
  endDate: string;
  storeId?: string;
};

type Sql = ReturnType<typeof database>["sql"];

function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

async function loadStores(sql: Sql): Promise<SourceStore[]> {
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM stores ORDER BY name
  `;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/**
 * Revisão de referência por ciclo × loja: a revisão do fechamento vigente da loja
 * (status CLOSED) ou, sem fechamento, a maior revisão não cancelada.
 */
async function loadReferenceOrders(sql: Sql, q: ReconciliationQuery): Promise<SourceReferenceOrder[]> {
  const storeCondition = q.storeId ? sql`AND o.store_id = ${q.storeId}::uuid` : sql``;
  const rows = await sql<{
    cycle_date: string;
    store_id: string;
    order_id: string;
    revision: number;
    source: "CLOSURE" | "LATEST";
  }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (o.purchase_cycle_date, o.store_id)
        o.purchase_cycle_date, o.store_id, o.id, o.revision
      FROM orders o
      WHERE o.cancelled_at IS NULL
        AND o.purchase_cycle_date BETWEEN ${q.startDate}::date AND ${q.endDate}::date
        ${storeCondition}
      ORDER BY o.purchase_cycle_date, o.store_id, o.revision DESC
    ),
    closure AS (
      SELECT c.purchase_cycle_date, c.store_id, o.id, o.revision
      FROM purchase_cycle_store_closures c
      INNER JOIN orders o ON o.id = c.order_id
      WHERE c.is_current = true
        AND c.status = 'CLOSED'
        AND c.purchase_cycle_date BETWEEN ${q.startDate}::date AND ${q.endDate}::date
        ${storeCondition}
    )
    SELECT
      COALESCE(cl.purchase_cycle_date, l.purchase_cycle_date)::text AS cycle_date,
      COALESCE(cl.store_id, l.store_id) AS store_id,
      COALESCE(cl.id, l.id) AS order_id,
      COALESCE(cl.revision, l.revision) AS revision,
      CASE WHEN cl.id IS NOT NULL THEN 'CLOSURE' ELSE 'LATEST' END AS source
    FROM closure cl
    FULL OUTER JOIN latest l
      ON l.purchase_cycle_date = cl.purchase_cycle_date AND l.store_id = cl.store_id
  `;
  return rows.map((r) => ({
    cycleDate: r.cycle_date,
    storeId: r.store_id,
    orderId: r.order_id,
    revision: Number(r.revision),
    source: r.source,
  }));
}

async function loadOrderItems(sql: Sql, refs: SourceReferenceOrder[]): Promise<SourceOrderItem[]> {
  if (refs.length === 0) return [];
  const orderIds = refs.map((r) => r.orderId);
  const byOrder = new Map(refs.map((r) => [r.orderId, r]));
  const rows = await sql<{ order_id: string; product_id: string; quantity: string }[]>`
    SELECT oi.order_id, oi.product_id, oi.quantity::text AS quantity
    FROM order_items oi
    WHERE oi.order_id = ANY(${orderIds}::uuid[])
      AND oi.quantity > 0
  `;
  return rows.map((r) => {
    const ref = byOrder.get(r.order_id)!;
    return { cycleDate: ref.cycleDate, storeId: ref.storeId, productId: r.product_id, quantity: num(r.quantity) };
  });
}

async function loadAllocations(sql: Sql, q: ReconciliationQuery): Promise<SourceAllocation[]> {
  const storeCondition = q.storeId ? sql`AND a.store_id = ${q.storeId}::uuid` : sql``;
  const rows = await sql<{
    cycle_date: string;
    store_id: string;
    product_id: string;
    supplier_id: string;
    supplier_name: string;
    destined_quantity: string;
    purchase_format: string;
    is_additional_purchase: boolean;
    conversion_factor_kg: string | null;
    destined_by: string | null;
  }[]>`
    SELECT
      a.purchase_cycle_date::text AS cycle_date,
      a.store_id,
      a.product_id,
      a.supplier_id,
      COALESCE(NULLIF(trim(s.trade_name), ''), s.corporate_name) AS supplier_name,
      a.destined_quantity::text AS destined_quantity,
      a.purchase_format,
      a.is_additional_purchase,
      a.conversion_factor_kg::text AS conversion_factor_kg,
      u.name AS destined_by
    FROM purchase_cycle_product_allocations a
    INNER JOIN suppliers s ON s.id = a.supplier_id
    LEFT JOIN users u ON u.id = COALESCE(a.updated_by, a.created_by)
    WHERE a.purchase_cycle_date BETWEEN ${q.startDate}::date AND ${q.endDate}::date
      ${storeCondition}
  `;
  return rows.map((r) => ({
    cycleDate: r.cycle_date,
    storeId: r.store_id,
    productId: r.product_id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    destinedQuantity: num(r.destined_quantity),
    purchaseFormat: r.purchase_format,
    isAdditionalPurchase: r.is_additional_purchase,
    conversionFactorKg: numOrNull(r.conversion_factor_kg),
    destinedBy: r.destined_by,
  }));
}

async function loadNotPurchased(sql: Sql, q: ReconciliationQuery): Promise<SourceNotPurchased[]> {
  const storeCondition = q.storeId ? sql`AND d.store_id = ${q.storeId}::uuid` : sql``;
  const rows = await sql<{ cycle_date: string; store_id: string; product_id: string }[]>`
    SELECT DISTINCT d.purchase_cycle_date::text AS cycle_date, d.store_id, d.product_id
    FROM purchase_cycle_product_supplier_decisions d
    WHERE d.decision = 'NOT_PURCHASED'
      AND d.purchase_cycle_date BETWEEN ${q.startDate}::date AND ${q.endDate}::date
      ${storeCondition}
  `;
  return rows.map((r) => ({ cycleDate: r.cycle_date, storeId: r.store_id, productId: r.product_id }));
}

async function loadConferences(
  sql: Sql,
  q: ReconciliationQuery,
): Promise<{ conferences: SourceConference[]; items: SourceConferenceItem[] }> {
  const storeCondition = q.storeId ? sql`AND c.store_id = ${q.storeId}::uuid` : sql``;
  const headers = await sql<{
    id: string;
    cycle_date: string;
    store_id: string;
    status: SourceConference["status"];
    order_revision: number | null;
  }[]>`
    SELECT c.id, c.purchase_cycle_date::text AS cycle_date, c.store_id, c.status, c.order_revision
    FROM store_delivery_conferences c
    WHERE c.purchase_cycle_date BETWEEN ${q.startDate}::date AND ${q.endDate}::date
      ${storeCondition}
  `;
  if (headers.length === 0) return { conferences: [], items: [] };

  const byId = new Map(headers.map((h) => [h.id, h]));
  const rows = await sql<{
    conference_id: string;
    product_id: string;
    received_weight_kg: string | null;
    is_unreceived: boolean;
    removed_from_order: boolean;
    added_outside_order: boolean;
    added_by_name: string | null;
  }[]>`
    SELECT ci.conference_id, ci.product_id, ci.received_weight_kg::text AS received_weight_kg,
           ci.is_unreceived, ci.removed_from_order, ci.added_outside_order, ua.name AS added_by_name
    FROM store_delivery_conference_items ci
    LEFT JOIN users ua ON ua.id = ci.added_by
    WHERE ci.conference_id = ANY(${headers.map((h) => h.id)}::uuid[])
  `;

  return {
    conferences: headers.map((h) => ({
      cycleDate: h.cycle_date,
      storeId: h.store_id,
      status: h.status,
      orderRevision: h.order_revision === null ? null : Number(h.order_revision),
    })),
    items: rows.map((r) => {
      const header = byId.get(r.conference_id)!;
      return {
        cycleDate: header.cycle_date,
        storeId: header.store_id,
        productId: r.product_id,
        receivedWeightKg: numOrNull(r.received_weight_kg),
        isUnreceived: r.is_unreceived,
        removedFromOrder: r.removed_from_order,
        addedOutsideOrder: r.added_outside_order,
        addedByName: r.added_by_name,
      };
    }),
  };
}

/** Perdas não canceladas do período (até LOSS_WINDOW_DAYS depois do último ciclo). */
async function loadLosses(sql: Sql, q: ReconciliationQuery): Promise<SourceLoss[]> {
  const storeCondition = q.storeId ? sql`AND sl.store_id = ${q.storeId}::uuid` : sql``;
  const until = shiftIsoDate(q.endDate, LOSS_WINDOW_DAYS);
  const rows = await sql<{ store_id: string; product_id: string; loss_date: string; quantity: string; unit: string }[]>`
    SELECT sl.store_id, sl.product_id,
           (sl.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS loss_date,
           sl.quantity::text AS quantity, sl.unit
    FROM store_loss_records sl
    WHERE sl.cancelled_at IS NULL
      AND (sl.recorded_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${q.startDate}::date AND ${until}::date
      ${storeCondition}
  `;
  return rows.map((r) => ({
    storeId: r.store_id,
    productId: r.product_id,
    date: r.loss_date,
    quantity: num(r.quantity),
    unit: r.unit,
  }));
}

async function loadProducts(sql: Sql, productIds: string[]): Promise<SourceProduct[]> {
  if (productIds.length === 0) return [];
  const rows = await sql<{
    id: string;
    erp_code: number;
    name: string;
    purchase_format: string | null;
    sale_unit: string | null;
    conversion_quantity: string | null;
  }[]>`
    SELECT p.id, p.erp_code, p.name, p.purchase_format,
           pp.sale_unit, pp.conversion_quantity::text AS conversion_quantity
    FROM products p
    LEFT JOIN product_pricing_parameters pp ON pp.product_id = p.id
    WHERE p.id = ANY(${productIds}::uuid[])
  `;
  return rows.map((r) => ({
    id: r.id,
    erpCode: Number(r.erp_code),
    name: r.name,
    purchaseFormat: r.purchase_format,
    saleUnit: r.sale_unit,
    conversionQuantity: numOrNull(r.conversion_quantity),
  }));
}

/** Carrega todas as fontes do confronto para o período (e loja, se informada). */
export async function loadReconciliationSources(q: ReconciliationQuery): Promise<ReconciliationSources> {
  const { sql } = database();

  const [stores, referenceOrders, allocations, notPurchased, conf, losses] = await Promise.all([
    loadStores(sql),
    loadReferenceOrders(sql, q),
    loadAllocations(sql, q),
    loadNotPurchased(sql, q),
    loadConferences(sql, q),
    loadLosses(sql, q),
  ]);
  const orderItems = await loadOrderItems(sql, referenceOrders);

  const productIds = [
    ...new Set([
      ...orderItems.map((i) => i.productId),
      ...allocations.map((a) => a.productId),
      ...conf.items.map((i) => i.productId),
    ]),
  ];
  const products = await loadProducts(sql, productIds);

  return {
    stores,
    products,
    referenceOrders,
    orderItems,
    allocations,
    notPurchased,
    conferences: conf.conferences,
    conferenceItems: conf.items,
    losses,
  };
}
