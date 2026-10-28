import { database } from "@/db/client";
import {
  LossValidationError,
  formatUnitTotals,
  type StoreLossRecord,
} from "./domain";

export async function listTodayLossesForStore(
  storeId: string
): Promise<StoreLossRecord[]> {
  const { sql } = database();

  const rows = await sql`
    SELECT
      sl.id,
      sl.store_id,
      s.name AS store_name,
      sl.product_id,
      p.erp_code,
      p.name AS product_name,
      p.photo_key,
      p.photo_updated_at::text AS photo_updated_at,
      sl.quantity::float AS quantity,
      sl.unit,
      sl.reason,
      sl.notes,
      sl.recorded_at::text AS recorded_at,
      sl.recorded_by,
      u.name AS recorded_by_name
    FROM store_loss_records sl
    INNER JOIN stores s ON s.id = sl.store_id
    INNER JOIN products p ON p.id = sl.product_id
    LEFT JOIN users u ON u.id = sl.recorded_by
    WHERE sl.store_id = ${storeId}::uuid
      AND sl.cancelled_at IS NULL
      AND sl.recorded_at >= current_date
    ORDER BY sl.recorded_at DESC
  `;

  return rows.map((r) => ({
    id: r.id,
    storeId: r.store_id,
    storeName: r.store_name,
    productId: r.product_id,
    erpCode: r.erp_code,
    productName: r.product_name,
    photoKey: r.photo_key,
    photoUpdatedAt: r.photo_updated_at,
    quantity: r.quantity,
    unit: r.unit,
    reason: r.reason,
    notes: r.notes,
    recordedAt: r.recorded_at,
    recordedBy: r.recorded_by,
    recordedByName: r.recorded_by_name,
  }));
}

export async function recordStoreLoss(input: {
  storeId: string;
  productId: string;
  quantity: number;
  unit: string;
  reason: string;
  notes?: string | null;
  userId: string;
}): Promise<StoreLossRecord> {
  const { sql } = database();

  return await sql.begin(async (tx) => {
    // 1. Verifica produto
    const [product] = await tx`
      SELECT id, erp_code, name, photo_key, photo_updated_at::text AS photo_updated_at
      FROM products
      WHERE id = ${input.productId}::uuid
    `;

    if (!product) {
      throw new LossValidationError("Produto selecionado não encontrado no catálogo.");
    }

    // 2. Insere registro de perda
    const [inserted] = await tx`
      INSERT INTO store_loss_records (
        store_id,
        product_id,
        quantity,
        unit,
        reason,
        notes,
        recorded_by
      ) VALUES (
        ${input.storeId}::uuid,
        ${input.productId}::uuid,
        ${input.quantity},
        ${input.unit},
        ${input.reason},
        ${input.notes || null},
        ${input.userId}::uuid
      )
      RETURNING 
        id,
        store_id,
        product_id,
        quantity::float AS quantity,
        unit,
        reason,
        notes,
        recorded_at::text AS recorded_at,
        recorded_by
    `;

    // 3. Auditoria atômica obrigatória
    await tx`
      INSERT INTO audit_events (
        id, actor_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        ${input.userId}::uuid,
        'store_loss.create',
        'store_loss_records',
        ${inserted.id},
        ${JSON.stringify({
          storeId: input.storeId,
          productId: input.productId,
          erpCode: product.erp_code,
          productName: product.name,
          quantity: input.quantity,
          unit: input.unit,
          reason: input.reason,
        })}::jsonb,
        now()
      )
    `;

    return {
      id: inserted.id,
      storeId: inserted.store_id,
      productId: inserted.product_id,
      erpCode: product.erp_code,
      productName: product.name,
      photoKey: product.photo_key,
      photoUpdatedAt: product.photo_updated_at,
      quantity: inserted.quantity,
      unit: inserted.unit,
      reason: inserted.reason,
      notes: inserted.notes,
      recordedAt: inserted.recorded_at,
      recordedBy: inserted.recorded_by,
    };
  });
}

export async function cancelStoreLoss(input: {
  lossId: string;
  storeId: string;
  userId: string;
  reason?: string;
}): Promise<void> {
  const { sql } = database();

  await sql.begin(async (tx) => {
    const [loss] = await tx`
      SELECT id, store_id, product_id, quantity::float AS quantity, unit, cancelled_at
      FROM store_loss_records
      WHERE id = ${input.lossId}::uuid
        AND store_id = ${input.storeId}::uuid
      FOR UPDATE
    `;

    if (!loss) {
      throw new LossValidationError("Lançamento de perda não encontrado para esta loja.");
    }

    if (loss.cancelled_at) {
      throw new LossValidationError("Este lançamento de perda já foi excluído.");
    }

    await tx`
      UPDATE store_loss_records
      SET 
        cancelled_at = now(),
        cancelled_by = ${input.userId}::uuid,
        cancellation_reason = ${input.reason || "Exclusão solicitada pelo operador da loja"}
      WHERE id = ${input.lossId}::uuid
    `;

    await tx`
      INSERT INTO audit_events (
        id, actor_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        ${input.userId}::uuid,
        'store_loss.cancel',
        'store_loss_records',
        ${input.lossId},
        ${JSON.stringify({
          storeId: input.storeId,
          quantity: loss.quantity,
          unit: loss.unit,
        })}::jsonb,
        now()
      )
    `;
  });
}

type LossManagementFilters = {
  storeId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  search?: string | null;
};

function buildLossManagementConditions(sql: ReturnType<typeof database>["sql"], filters: LossManagementFilters) {
  return {
    storeCondition: filters.storeId ? sql`AND sl.store_id = ${filters.storeId}::uuid` : sql``,
    startCondition: filters.startDate ? sql`AND sl.recorded_at::date >= ${filters.startDate}::date` : sql``,
    endCondition: filters.endDate ? sql`AND sl.recorded_at::date <= ${filters.endDate}::date` : sql``,
    searchCondition: filters.search
      ? sql`AND (p.name ILIKE ${`%${filters.search}%`} OR p.erp_code::text ILIKE ${`%${filters.search}%`})`
      : sql``,
  };
}

/**
 * Lista a página de lançamentos exibida na tabela (ORDER BY + LIMIT/OFFSET reais
 * no banco). Não usar o resultado desta função para calcular totais/rankings:
 * uma página nunca representa o período completo filtrado — ver
 * aggregateLossesForManagement.
 */
export async function queryLossesForManagement(
  filters: LossManagementFilters,
  pagination: { limit: number; offset?: number } = { limit: 50 }
): Promise<StoreLossRecord[]> {
  const { sql } = database();
  const { storeCondition, startCondition, endCondition, searchCondition } = buildLossManagementConditions(sql, filters);
  const offset = pagination.offset ?? 0;

  const rows = await sql`
    SELECT
      sl.id,
      sl.store_id,
      s.name AS store_name,
      sl.product_id,
      p.erp_code,
      p.name AS product_name,
      p.photo_key,
      p.photo_updated_at::text AS photo_updated_at,
      sl.quantity::float AS quantity,
      sl.unit,
      sl.reason,
      sl.notes,
      sl.recorded_at::text AS recorded_at,
      sl.recorded_by,
      u.name AS recorded_by_name
    FROM store_loss_records sl
    INNER JOIN stores s ON s.id = sl.store_id
    INNER JOIN products p ON p.id = sl.product_id
    LEFT JOIN users u ON u.id = sl.recorded_by
    WHERE sl.cancelled_at IS NULL
      ${storeCondition}
      ${startCondition}
      ${endCondition}
      ${searchCondition}
    ORDER BY sl.recorded_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${offset}
  `;

  return rows.map((r) => ({
    id: r.id,
    storeId: r.store_id,
    storeName: r.store_name,
    productId: r.product_id,
    erpCode: r.erp_code,
    productName: r.product_name,
    photoKey: r.photo_key,
    photoUpdatedAt: r.photo_updated_at,
    quantity: r.quantity,
    unit: r.unit,
    reason: r.reason,
    notes: r.notes,
    recordedAt: r.recorded_at,
    recordedBy: r.recorded_by,
    recordedByName: r.recorded_by_name,
  }));
}

/**
 * Conta o total de lançamentos que casam com o filtro, sem paginação - usado
 * para "Exibindo N de TOTAL" e para decidir se existe próxima página.
 */
export async function countLossesForManagement(filters: LossManagementFilters): Promise<number> {
  const { sql } = database();
  const { storeCondition, startCondition, endCondition, searchCondition } = buildLossManagementConditions(sql, filters);

  const [{ total }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total
    FROM store_loss_records sl
    INNER JOIN stores s ON s.id = sl.store_id
    INNER JOIN products p ON p.id = sl.product_id
    WHERE sl.cancelled_at IS NULL
      ${storeCondition}
      ${startCondition}
      ${endCondition}
      ${searchCondition}
  `;
  return total;
}

export type LossManagementKpis = {
  totals: { kg: number; und: number; formatted: string };
  topStoreByUnit: Record<"KG" | "UND", { storeName: string; total: number } | null>;
  topProductByUnit: Record<"KG" | "UND", { productName: string; total: number } | null>;
  totalRecords: number;
};

/**
 * Calcula contagens, totais e rankings de loja/produto líder no banco, sobre
 * TODO o período filtrado (sem limite de linhas) - nunca sobre a página exibida
 * na tabela. Os rankings por loja/produto têm cardinalidade baixa (poucas lojas
 * e produtos), então agrupar no banco e escolher o maior por unidade em memória
 * é seguro e não reintroduz o problema de truncar o período.
 */
export async function aggregateLossesForManagement(filters: LossManagementFilters): Promise<LossManagementKpis> {
  const { sql } = database();
  const { storeCondition, startCondition, endCondition, searchCondition } = buildLossManagementConditions(sql, filters);

  const [totalsRow] = await sql<{ kg_total: number; und_total: number; total_records: number }[]>`
    SELECT
      COALESCE(SUM(sl.quantity) FILTER (WHERE upper(sl.unit) NOT IN ('UND', 'UN', 'UNIDADE')), 0)::float AS kg_total,
      COALESCE(SUM(sl.quantity) FILTER (WHERE upper(sl.unit) IN ('UND', 'UN', 'UNIDADE')), 0)::float AS und_total,
      count(*)::int AS total_records
    FROM store_loss_records sl
    INNER JOIN stores s ON s.id = sl.store_id
    INNER JOIN products p ON p.id = sl.product_id
    WHERE sl.cancelled_at IS NULL
      ${storeCondition}
      ${startCondition}
      ${endCondition}
      ${searchCondition}
  `;

  // GROUP BY usa a expressão completa (não o alias "unit"): tanto store_loss_records
  // quanto products têm uma coluna chamada unit, e o SQL padrão exige resolver um
  // identificador de GROUP BY ambíguo contra TODAS as colunas de entrada em escopo
  // antes de considerar aliases de saída - referenciar "unit" pelo nome falha com
  // 42702 (ambiguous column reference).
  const storeTotals = await sql<{ store_id: string; store_name: string; unit: "KG" | "UND"; total: number }[]>`
    SELECT
      s.id AS store_id,
      s.name AS store_name,
      CASE WHEN upper(sl.unit) IN ('UND', 'UN', 'UNIDADE') THEN 'UND' ELSE 'KG' END AS unit,
      SUM(sl.quantity)::float AS total
    FROM store_loss_records sl
    INNER JOIN stores s ON s.id = sl.store_id
    INNER JOIN products p ON p.id = sl.product_id
    WHERE sl.cancelled_at IS NULL
      ${storeCondition}
      ${startCondition}
      ${endCondition}
      ${searchCondition}
    GROUP BY s.id, s.name, CASE WHEN upper(sl.unit) IN ('UND', 'UN', 'UNIDADE') THEN 'UND' ELSE 'KG' END
  `;

  const productTotals = await sql<{ product_id: string; product_name: string; unit: "KG" | "UND"; total: number }[]>`
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      CASE WHEN upper(sl.unit) IN ('UND', 'UN', 'UNIDADE') THEN 'UND' ELSE 'KG' END AS unit,
      SUM(sl.quantity)::float AS total
    FROM store_loss_records sl
    INNER JOIN stores s ON s.id = sl.store_id
    INNER JOIN products p ON p.id = sl.product_id
    WHERE sl.cancelled_at IS NULL
      ${storeCondition}
      ${startCondition}
      ${endCondition}
      ${searchCondition}
    GROUP BY p.id, p.name, CASE WHEN upper(sl.unit) IN ('UND', 'UN', 'UNIDADE') THEN 'UND' ELSE 'KG' END
  `;

  function topByUnit<TKey extends string, TRow extends { unit: "KG" | "UND"; total: number }>(
    rows: TRow[],
    nameKey: TKey,
    pick: (row: TRow) => string
  ): Record<"KG" | "UND", ({ total: number } & Record<TKey, string>) | null> {
    const result = { KG: null, UND: null } as Record<"KG" | "UND", ({ total: number } & Record<TKey, string>) | null>;
    for (const unit of ["KG", "UND"] as const) {
      let best: TRow | null = null;
      for (const row of rows) {
        if (row.unit === unit && (!best || row.total > best.total)) best = row;
      }
      result[unit] = best ? ({ [nameKey]: pick(best), total: best.total } as { total: number } & Record<TKey, string>) : null;
    }
    return result;
  }

  const kg = Math.round((totalsRow?.kg_total ?? 0) * 100) / 100;
  const und = Math.round((totalsRow?.und_total ?? 0) * 100) / 100;

  return {
    totals: { kg, und, formatted: formatUnitTotals({ kg, und }) },
    topStoreByUnit: topByUnit(storeTotals, "storeName", (r) => r.store_name),
    topProductByUnit: topByUnit(productTotals, "productName", (r) => r.product_name),
    totalRecords: totalsRow?.total_records ?? 0,
  };
}
