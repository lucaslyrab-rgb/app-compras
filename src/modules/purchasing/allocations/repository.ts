import type postgres from "postgres";
import { database } from "@/db/client";
import { assertPermission, type Principal } from "@/modules/identity";
import {
  AllocationDestinationConflictError,
  AllocationValidationError,
  BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE,
  CycleClosedError,
  ExclusivityViolationError,
  calculateDifference,
  calculateStoreCutSummary,
  calculateSuggestedDestinedQuantity,
  canSupplierProvideProduct,
  computeStoreAllocationsHash,
  computeStoreCostsHash,
  isCycleDate,
  parseQuantity,
  roundToTwoDecimals,
  sumQuantities,
  validateAllocationPurchasedStatus,
  validateCycleClosureReadinessStoreFirst,
  type BuyerAllocationWorkspaceData,
  type BuyerCycleClosureSummary,
  type CatalogSearchItem,
  type CloseStoreCycleInput,
  type ConcludeSupplierStoreReviewInput,
  type ProductAllocationItem,
  type ReopenStoreCycleInput,
  type RevertProductSupplierDecisionInput,
  type SaveSupplierAllocationsInput,
  type SetProductSupplierDecisionInput,
  type StoreAllocationData,
  type StoreClosureSummary,
  type StoreCutItem,
  type StoreInfo,
  type StoreSummaryData,
  type SupplierDestinationData,
  type SupplierStoreReviewStatus,
  type SupplierStoreReviewSummary,
  type SupplierSummaryOption,
} from "./domain";

function isTransactionSql(sql: postgres.Sql | postgres.TransactionSql): sql is postgres.TransactionSql {
  return typeof (sql as unknown as Record<string, unknown>).savepoint === "function";
}

async function executeWithCycleLock<T>(
  sql: postgres.Sql | postgres.TransactionSql,
  cycleDate: string,
  callback: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if (isTransactionSql(sql)) {
    await sql`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${cycleDate}::text))`;
    return await callback(sql);
  }
  return (await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${cycleDate}::text))`;
    return await callback(tx);
  })) as T;
}

async function queryPersistedParticipatingStores(
  sql: postgres.Sql | postgres.TransactionSql,
  cycleDate: string,
): Promise<Array<{ id: string; name: string; slug: string }>> {
  return await sql<{ id: string; name: string; slug: string }[]>`
    SELECT s.id, s.name, s.slug
    FROM stores s
    JOIN purchase_cycle_participating_stores ps ON ps.store_id = s.id
    WHERE ps.purchase_cycle_date = ${cycleDate}::date
    ORDER BY CASE s.slug
      WHEN 'ponta-da-fruta' THEN 1
      WHEN 'balneario' THEN 2
      WHEN 'santa-monica' THEN 3
      ELSE 4
    END, s.name ASC
  `;
}

/**
 * Identifica e preserva as lojas participantes de um ciclo específico.
 *
 * Regras de Precedência e Evidência:
 * 1. Participação Persistida (Imutável): Se purchase_cycle_participating_stores já possui
 *    registros para este ciclo, essas lojas são a fonte de verdade. Nenhuma leitura ou consulta
 *    executa saneamento destrutivo ou remoção dessas linhas.
 * 2. Ciclo Fechado: O conjunto de participantes é estritamente congelado.
 *    Nenhuma leitura ou escrita subsequente pode alterar os participantes de um ciclo CLOSED.
 * 3. Ciclo Aberto (Reconciliação Dinâmica): Se o ciclo estiver aberto e uma loja registrar
 *    atividade posterior legítima (pedido ativo, alocação positiva, fechamento ou decisão),
 *    ela é adicionada ao conjunto sob lock transacional exclusivo do ciclo, revalidando status antes da escrita.
 * 4. Inicialização de Ciclo (Sem registros prévios): Se a tabela ainda não possui participantes,
 *    identifica candidatas com base em:
 *    a) Atividade comprovada no ciclo (pedidos ativos ou históricos, alocações positivas, fechamentos ou decisões);
 *    b) Lojas padrão da rede (Ponta da Fruta, Balneário, Santa Mônica) ativas e criadas até a data do ciclo.
 * 5. Ciclo Antigo Sem Informação Suficiente: Se um ciclo antigo não possui atividade e nenhuma loja
 *    existia na sua data, o conjunto retornado é vazio ([]). Não há fallback que invente lojas futuras.
 */
export async function resolveParticipatingStores(
  sql: postgres.Sql | postgres.TransactionSql,
  cycleDate: string,
): Promise<Array<{ id: string; name: string; slug: string }>> {
  // 1. Consulta participantes já persistidas para este ciclo (fonte de verdade preservada)
  const existingPersisted = await queryPersistedParticipatingStores(sql, cycleDate);

  // 1.1 Ciclo fechado: composição é estritamente imutável (mesmo se vazio em ciclos legados sem snapshot)
  const [existingClosure] = await sql<{ status: string }[]>`
    SELECT status FROM purchase_cycle_buyer_closures
    WHERE purchase_cycle_date = ${cycleDate}::date
  `;
  if (existingClosure?.status === "CLOSED") {
    return existingPersisted;
  }

  // Se já existem participantes gravadas:
  if (existingPersisted.length > 0) {
    // 1.2 Ciclo aberto: reconcilia novas lojas que tenham recebido atividade posterior no ciclo
    const lateActiveStores = await sql<{ id: string; name: string; slug: string }[]>`
      SELECT DISTINCT s.id, s.name, s.slug
      FROM stores s
      WHERE s.id IN (
        SELECT o.store_id FROM orders o WHERE o.purchase_cycle_date = ${cycleDate}::date AND o.cancelled_at IS NULL
        UNION
        SELECT pa.store_id FROM purchase_cycle_product_allocations pa WHERE pa.purchase_cycle_date = ${cycleDate}::date AND pa.destined_quantity > 0
        UNION
        SELECT sc.store_id FROM purchase_cycle_store_closures sc WHERE sc.purchase_cycle_date = ${cycleDate}::date
        UNION
        SELECT sd.store_id FROM purchase_cycle_product_supplier_decisions sd WHERE sd.purchase_cycle_date = ${cycleDate}::date
      )
      AND s.id NOT IN (
        SELECT ps.store_id FROM purchase_cycle_participating_stores ps WHERE ps.purchase_cycle_date = ${cycleDate}::date
      )
    `;

    if (lateActiveStores.length === 0) {
      return existingPersisted;
    }

    return await executeWithCycleLock(sql, cycleDate, async (tx) => {
      // Revalida status DENTRO do lock do ciclo
      const [lockedClosure] = await tx<{ status: string }[]>`
        SELECT status FROM purchase_cycle_buyer_closures
        WHERE purchase_cycle_date = ${cycleDate}::date
      `;
      if (lockedClosure?.status === "CLOSED") {
        return await queryPersistedParticipatingStores(tx, cycleDate);
      }

      for (const st of lateActiveStores) {
        await tx`
          INSERT INTO purchase_cycle_participating_stores (purchase_cycle_date, store_id)
          VALUES (${cycleDate}::date, ${st.id}::uuid)
          ON CONFLICT (purchase_cycle_date, store_id) DO NOTHING
        `;
      }
      return await queryPersistedParticipatingStores(tx, cycleDate);
    });
  }

  // 2. Primeira inicialização do ciclo: não existem participantes persistidas ainda
  // Identifica candidatas legítimas com base em evidências concretas
  const candidateStores = await sql<{ id: string; name: string; slug: string }[]>`
    SELECT s.id, s.name, s.slug
    FROM stores s
    WHERE (
      (
        s.slug IN ('ponta-da-fruta', 'balneario', 'santa-monica')
        AND s.active = true
        AND DATE(s.created_at AT TIME ZONE 'America/Sao_Paulo') <= ${cycleDate}::date
      )
      OR s.id IN (
        SELECT o.store_id FROM orders o WHERE o.purchase_cycle_date = ${cycleDate}::date
        UNION
        SELECT pa.store_id FROM purchase_cycle_product_allocations pa WHERE pa.purchase_cycle_date = ${cycleDate}::date AND pa.destined_quantity > 0
        UNION
        SELECT sc.store_id FROM purchase_cycle_store_closures sc WHERE sc.purchase_cycle_date = ${cycleDate}::date
        UNION
        SELECT sd.store_id FROM purchase_cycle_product_supplier_decisions sd WHERE sd.purchase_cycle_date = ${cycleDate}::date
      )
    )
    ORDER BY CASE s.slug
      WHEN 'ponta-da-fruta' THEN 1
      WHEN 'balneario' THEN 2
      WHEN 'santa-monica' THEN 3
      ELSE 4
    END, s.name ASC
  `;

  // Se não há candidatas legítimas (ex: ciclo histórico sem atividade anterior à criação de lojas),
  // NÃO inventa ou força lojas futuras. Retorna conjunto vazio.
  if (candidateStores.length === 0) {
    return [];
  }

  // Persiste as participantes identificadas para fixar o snapshot inicial do ciclo sob trava transacional
  return await executeWithCycleLock(sql, cycleDate, async (tx) => {
    // Revalida status DENTRO do lock do ciclo
    const [lockedClosure] = await tx<{ status: string }[]>`
      SELECT status FROM purchase_cycle_buyer_closures
      WHERE purchase_cycle_date = ${cycleDate}::date
    `;
    if (lockedClosure?.status === "CLOSED") {
      return await queryPersistedParticipatingStores(tx, cycleDate);
    }

    for (const st of candidateStores) {
      await tx`
        INSERT INTO purchase_cycle_participating_stores (purchase_cycle_date, store_id)
        VALUES (${cycleDate}::date, ${st.id}::uuid)
        ON CONFLICT (purchase_cycle_date, store_id) DO NOTHING
      `;
    }
    return await queryPersistedParticipatingStores(tx, cycleDate);
  });
}

/**
 * Regra centralizada e compartilhada de elegibilidade de produtos para um fornecedor e loja.
 * Respeita fornecedor correto, compras marcadas nos custos e exclusividades ativas.
 */
export async function getSupplierEligibleProductIds(
  sql: postgres.Sql | postgres.TransactionSql,
  params: {
    cycleDate: string;
    supplierId: string;
    storeId?: string;
  },
): Promise<Set<string>> {
  const { cycleDate, supplierId, storeId } = params;

  const [supplierRow] = await sql<{ id: string; tax_id: string | null; corporate_name: string }[]>`
    SELECT id, tax_id, corporate_name FROM suppliers WHERE id = ${supplierId}::uuid
  `;
  if (!supplierRow) return new Set();

  const isJeb =
    supplierRow.tax_id === "48336863000160" ||
    supplierRow.corporate_name.toUpperCase().includes("JEB DISTRIBUIDORA");

  // Busca todos os produtos com exclusividades ativas
  const exclusiveRows = await sql<{ product_id: string; exclusive_supplier_id: string }[]>`
    SELECT ps.product_id, ps.supplier_id AS exclusive_supplier_id
    FROM product_suppliers ps
    WHERE ps.is_exclusive = true AND ps.active = true
  `;
  const exclusiveMap = new Map<string, string>();
  for (const r of exclusiveRows) {
    exclusiveMap.set(r.product_id, r.exclusive_supplier_id);
  }

  // Produtos que têm vínculos ativos com este fornecedor
  const linkedRows = await sql<{ product_id: string }[]>`
    SELECT product_id FROM product_suppliers
    WHERE supplier_id = ${supplierId}::uuid AND active = true
  `;
  const linkedProductIds = new Set(linkedRows.map((r) => r.product_id));

  // Produtos comprados nos custos para este ciclo
  const costRows = await sql<{ product_id: string; purchased: boolean }[]>`
    SELECT product_id, purchased
    FROM purchase_cycle_product_costs
    WHERE purchase_cycle_date = ${cycleDate}::date
  `;
  const purchasedInCosts = new Set(costRows.filter((c) => c.purchased).map((c) => c.product_id));

  // Produtos legados
  const legacyRows = await sql<{ id: string; legacy_exclusive: boolean }[]>`
    SELECT id, exclusive_supplier AS legacy_exclusive FROM products WHERE active = true
  `;
  const legacyMap = new Map(legacyRows.map((r) => [r.id, r.legacy_exclusive]));

  // Alocações existentes para este fornecedor neste ciclo
  const allocRows = await sql<{ product_id: string; destined_quantity: string; store_id: string }[]>`
    SELECT product_id, destined_quantity::text, store_id
    FROM purchase_cycle_product_allocations
    WHERE purchase_cycle_date = ${cycleDate}::date
      AND supplier_id = ${supplierId}::uuid
      ${storeId ? sql`AND store_id = ${storeId}::uuid` : sql``}
  `;

  // Decisões existentes para este fornecedor neste ciclo
  const decisionRows = await sql<{ product_id: string; store_id: string }[]>`
    SELECT product_id, store_id
    FROM purchase_cycle_product_supplier_decisions
    WHERE purchase_cycle_date = ${cycleDate}::date
      AND supplier_id = ${supplierId}::uuid
      ${storeId ? sql`AND store_id = ${storeId}::uuid` : sql``}
  `;

  // Produtos que têm pedidos ativos das lojas para este ciclo
  const orderRows = await sql<{ product_id: string }[]>`
    SELECT DISTINCT oi.product_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.purchase_cycle_date = ${cycleDate}::date
      AND o.cancelled_at IS NULL
      AND oi.quantity > 0
  `;
  const orderedProductIds = new Set(orderRows.map((r) => r.product_id));

  const eligible = new Set<string>();

  // 1. Alocações existentes: apenas se o produto estiver comprado nos custos OU possuir destinação positiva remanescente (> 0)
  for (const a of allocRows) {
    if (purchasedInCosts.has(a.product_id) || parseQuantity(a.destined_quantity) > 0) {
      eligible.add(a.product_id);
    }
  }

  // 2. Decisões existentes: apenas inclui se o produto estiver comprado nos custos
  for (const d of decisionRows) {
    if (purchasedInCosts.has(d.product_id)) {
      eligible.add(d.product_id);
    }
  }

  // 3. Produtos comprados nos custos que este fornecedor pode fornecer (conforme regra comercial unificada)
  for (const pid of purchasedInCosts) {
    const exclSuppId = exclusiveMap.get(pid) ?? null;
    const isLegacyExcl = legacyMap.get(pid) ?? false;
    const isLinked = linkedProductIds.has(pid);

    if (
      canSupplierProvideProduct({
        supplierId,
        isJeb,
        exclusiveSupplierId: exclSuppId,
        legacyExclusive: isLegacyExcl,
        isLinkedToSupplier: isLinked,
      })
    ) {
      eligible.add(pid);
    }
  }

  // 4. Proteção estrita: produtos com pedido de loja que NÃO foram comprados nos custos (corte)
  // NUNCA podem aparecer na tela de destinação a menos que possuam destinação positiva anterior a ser zerada
  for (const pid of [...eligible]) {
    if (orderedProductIds.has(pid) && !purchasedInCosts.has(pid)) {
      const hasPositiveAlloc = allocRows.some(
        (a) => a.product_id === pid && parseQuantity(a.destined_quantity) > 0,
      );
      if (!hasPositiveAlloc) {
        eligible.delete(pid);
      }
    }
  }

  return eligible;
}

export async function readBuyerAllocationWorkspace(
  principal: Principal,
  requestedCycle?: string,
  selectedSupplierId?: string | null,
  selectedStoreId?: string | null,
): Promise<BuyerAllocationWorkspaceData> {
  assertPermission(principal, "compras:destinacao");

  if (requestedCycle && !isCycleDate(requestedCycle)) {
    throw new AllocationValidationError("Data de compra inválida.");
  }

  const sql = database().sql;

  // 1. Busca ciclos disponíveis
  const availableCycleRows = await sql<{ date: string }[]>`
    SELECT DISTINCT purchase_cycle_date::text AS date
    FROM orders
    WHERE cancelled_at IS NULL
    UNION
    SELECT DISTINCT purchase_cycle_date::text AS date
    FROM purchase_cycle_product_costs
    ORDER BY date DESC
  `;

  const todayStr = new Date().toISOString().split("T")[0];
  const cycles = [
    ...new Set([
      ...availableCycleRows.map((r) => r.date),
      ...(requestedCycle ? [requestedCycle] : []),
      todayStr,
    ]),
  ].sort((a, b) => b.localeCompare(a));

  const cycleDate = requestedCycle ?? cycles[0] ?? todayStr;

  // 2. Busca status de fechamento do comprador para o ciclo
  const closureRows = await sql<
    {
      status: string;
      closed_at: string | null;
      closed_by_name: string | null;
      reopened_at: string | null;
      reopened_by_name: string | null;
      reopen_reason: string | null;
      total_purchased_products: number;
      total_allocated_products: number;
    }[]
  >`
    SELECT
      c.status,
      c.closed_at::text,
      u_closed.name AS closed_by_name,
      c.reopened_at::text,
      u_reopened.name AS reopened_by_name,
      c.reopen_reason,
      c.total_purchased_products,
      c.total_allocated_products
    FROM purchase_cycle_buyer_closures c
    LEFT JOIN users u_closed ON u_closed.id = c.closed_by
    LEFT JOIN users u_reopened ON u_reopened.id = c.reopened_by
    WHERE c.purchase_cycle_date = ${cycleDate}::date
  `;

  const closureRaw = closureRows[0];
  const closureStatus: "OPEN" | "CLOSED" = closureRaw?.status === "CLOSED" ? "CLOSED" : "OPEN";

  // 3. Busca lojas participantes preservadas historicamente
  const storeRows = await resolveParticipatingStores(sql, cycleDate);

  const stores: StoreInfo[] = storeRows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
  }));

  const activeStore = stores.find((s) => s.id === selectedStoreId || s.slug === selectedStoreId) ?? stores[0] ?? null;
  const currentSelectedStoreId = activeStore?.id ?? null;

  // 4. Busca pedidos válidos mais recentes das lojas para o ciclo
  const orderRows = await sql<
    {
      store_id: string;
      order_id: string;
      revision: number;
    }[]
  >`
    WITH latest_orders AS (
      SELECT DISTINCT ON (store_id)
        id,
        store_id,
        revision,
        cancelled_at
      FROM orders
      WHERE purchase_cycle_date = ${cycleDate}::date
      ORDER BY store_id, submitted_at DESC, revision DESC, id DESC
    )
    SELECT store_id, id AS order_id, revision
    FROM latest_orders
    WHERE cancelled_at IS NULL
  `;

  const latestOrdersByStore = new Map(orderRows.map((o) => [o.store_id, o]));
  const validOrderIds = orderRows.map((o) => o.order_id);

  // Itens dos pedidos válidos
  const orderItemRows = validOrderIds.length > 0
    ? await sql<
        {
          store_id: string;
          product_id: string;
          quantity: string;
        }[]
      >`
        SELECT
          o.store_id,
          oi.product_id,
          oi.quantity::text
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.order_id IN ${sql(validOrderIds)}
      `
    : [];

  const cycleStoreOrders: Record<string, Record<string, string>> = {};
  const storeOrderQuantityMap = new Map<string, string>(); // key: `${storeId}:${productId}`
  const orderedProductIds = new Set<string>();

  for (const item of orderItemRows) {
    storeOrderQuantityMap.set(`${item.store_id}:${item.product_id}`, item.quantity);
    if (!cycleStoreOrders[item.product_id]) {
      cycleStoreOrders[item.product_id] = {};
    }
    cycleStoreOrders[item.product_id][item.store_id] = item.quantity;

    if (parseQuantity(item.quantity) > 0) {
      orderedProductIds.add(item.product_id);
    }
  }

  // 5. Custos do ciclo e flags de comprado
  const costRows = await sql<
    {
      product_id: string;
      cost: string | null;
      cost_is_unit: boolean | null;
      version: number | null;
      purchased: boolean;
    }[]
  >`
    SELECT
      product_id,
      cost::text,
      cost_is_unit,
      version,
      purchased
    FROM purchase_cycle_product_costs
    WHERE purchase_cycle_date = ${cycleDate}::date
  `;

  const costMap = new Map<
    string,
    {
      cost: string | null;
      cost_is_unit: boolean;
      version: number;
      purchased: boolean;
    }
  >();
  const purchasedProductIds: string[] = [];

  for (const c of costRows) {
    costMap.set(c.product_id, {
      cost: c.cost,
      cost_is_unit: c.cost_is_unit ?? false,
      version: c.version ?? 0,
      purchased: c.purchased,
    });
    if (c.purchased) {
      purchasedProductIds.push(c.product_id);
    }
  }

  // 6. Alocações existentes para o ciclo
  const allocationRows = await sql<
    {
      supplier_id: string;
      product_id: string;
      store_id: string;
      ordered_quantity: string;
      destined_quantity: string;
      purchase_format: string;
      is_additional_purchase: boolean;
      conversion_factor_kg: string | null;
      conversion_origin: string | null;
      notes: string | null;
      version: number;
    }[]
  >`
    SELECT
      supplier_id,
      product_id,
      store_id,
      ordered_quantity::text,
      destined_quantity::text,
      purchase_format,
      is_additional_purchase,
      conversion_factor_kg::text,
      conversion_origin,
      notes,
      version
    FROM purchase_cycle_product_allocations
    WHERE purchase_cycle_date = ${cycleDate}::date
  `;

  const allocationsBySupplierAndProduct = new Map<string, Array<(typeof allocationRows)[number]>>();
  const globallyAllocatedProductIds = new Set<string>();
  const supplierTotalDestinedMap = new Map<string, string[]>();
  const supplierStoreDestinedMap = new Map<string, Map<string, string[]>>();

  for (const alloc of allocationRows) {
    const suppProdKey = `${alloc.supplier_id}:${alloc.product_id}`;
    const list = allocationsBySupplierAndProduct.get(suppProdKey) ?? [];
    list.push(alloc);
    allocationsBySupplierAndProduct.set(suppProdKey, list);

    if (parseQuantity(alloc.destined_quantity) > 0) {
      globallyAllocatedProductIds.add(alloc.product_id);
      const suppList = supplierTotalDestinedMap.get(alloc.supplier_id) ?? [];
      suppList.push(alloc.destined_quantity);
      supplierTotalDestinedMap.set(alloc.supplier_id, suppList);

      let storeMap = supplierStoreDestinedMap.get(alloc.supplier_id);
      if (!storeMap) {
        storeMap = new Map<string, string[]>();
        supplierStoreDestinedMap.set(alloc.supplier_id, storeMap);
      }
      const storeList = storeMap.get(alloc.store_id) ?? [];
      storeList.push(alloc.destined_quantity);
      storeMap.set(alloc.store_id, storeList);
    }
  }

  // 6.1 Decisões explícitas de não compra por fornecedor/produto/loja
  const decisionRows = await sql<
    {
      supplier_id: string;
      product_id: string;
      store_id: string;
      decision: string;
    }[]
  >`
    SELECT supplier_id, product_id, store_id, decision
    FROM purchase_cycle_product_supplier_decisions
    WHERE purchase_cycle_date = ${cycleDate}::date
  `;
  const supplierDecisionsMap = new Map<string, string>();
  for (const d of decisionRows) {
    supplierDecisionsMap.set(`${d.supplier_id}:${d.product_id}:${d.store_id}`, d.decision);
  }

  // 6.2 Avaliação/conclusão de fornecedores por loja
  const supplierReviewRows = await sql<
    {
      supplier_id: string;
      store_id: string;
      status: string;
      reviewed_at: string;
      reviewed_by_name: string | null;
    }[]
  >`
    SELECT
      r.supplier_id,
      r.store_id,
      r.status,
      r.reviewed_at::text,
      u.name AS reviewed_by_name
    FROM purchase_cycle_supplier_store_reviews r
    LEFT JOIN users u ON u.id = r.reviewed_by
    WHERE r.purchase_cycle_date = ${cycleDate}::date
  `;
  const supplierStoreReviews: Record<string, Record<string, SupplierStoreReviewSummary>> = {};
  for (const r of supplierReviewRows) {
    if (!supplierStoreReviews[r.supplier_id]) {
      supplierStoreReviews[r.supplier_id] = {};
    }
    supplierStoreReviews[r.supplier_id][r.store_id] = {
      supplierId: r.supplier_id,
      storeId: r.store_id,
      status: r.status as SupplierStoreReviewStatus,
      reviewedAt: r.reviewed_at,
      reviewedByName: r.reviewed_by_name,
    };
  }

  // 6.3 Conferência conjunta dos cortes e finalizações de loja (apenas versões correntes)
  const storeClosureRows = await sql<
    {
      store_id: string;
      order_id: string | null;
      order_revision: number | null;
      status: string;
      total_ordered_items: number;
      total_destined_items: number;
      total_cut_items: number;
      cut_summary: StoreCutItem[];
      allocations_hash: string;
      order_hash: string | null;
      costs_hash: string | null;
      version: number;
      is_current: boolean;
      closed_at: string | null;
      closed_by_name: string | null;
      reopened_at: string | null;
      reopened_by_name: string | null;
      reopen_reason: string | null;
    }[]
  >`
    SELECT
      sc.store_id,
      sc.order_id,
      sc.order_revision,
      sc.status,
      sc.total_ordered_items,
      sc.total_destined_items,
      sc.total_cut_items,
      sc.cut_summary,
      sc.allocations_hash,
      sc.order_hash,
      sc.costs_hash,
      sc.version,
      sc.is_current,
      sc.closed_at::text,
      u_closed.name AS closed_by_name,
      sc.reopened_at::text,
      u_reopened.name AS reopened_by_name,
      sc.reopen_reason
    FROM purchase_cycle_store_closures sc
    LEFT JOIN users u_closed ON u_closed.id = sc.closed_by
    LEFT JOIN users u_reopened ON u_reopened.id = sc.reopened_by
    WHERE sc.purchase_cycle_date = ${cycleDate}::date
      AND sc.is_current = true
  `;
  const rawStoreClosuresMap = new Map(storeClosureRows.map((r) => [r.store_id, r]));

  // 7. Fornecedores
  const allSuppliers = await sql<
    {
      id: string;
      corporate_name: string;
      trade_name: string | null;
      tax_id: string | null;
      tax_invoice_rule: string;
      active: boolean;
    }[]
  >`
    SELECT
      id,
      corporate_name,
      trade_name,
      tax_id,
      tax_invoice_rule,
      active
    FROM suppliers
    ORDER BY active DESC, corporate_name ASC
  `;

  const supplierOptions: SupplierSummaryOption[] = allSuppliers.map((s) => {
    const destinedQuantities = supplierTotalDestinedMap.get(s.id) ?? [];
    const hasAllocations = destinedQuantities.length > 0;
    const totalDestinedQuantity = sumQuantities(destinedQuantities);

    const destinedByStore: Record<string, string> = {};
    const reviewedByStore: Record<string, boolean> = {};
    for (const store of stores) {
      const list = supplierStoreDestinedMap.get(s.id)?.get(store.id) ?? [];
      destinedByStore[store.id] = sumQuantities(list);
      reviewedByStore[store.id] = supplierStoreReviews[s.id]?.[store.id]?.status === "REVIEWED";
    }

    return {
      id: s.id,
      corporateName: s.corporate_name,
      tradeName: s.trade_name,
      taxId: s.tax_id,
      active: s.active,
      hasAllocationsInCycle: hasAllocations,
      totalDestinedQuantity,
      destinedByStore,
      reviewedByStore,
    };
  });

  // 7. Busca parâmetros de conversão e catálogo de produtos
  const allCatalogProducts = await sql<
    {
      id: string;
      erp_code: number;
      name: string;
      purchase_format: string;
      active: boolean;
      legacy_exclusive: boolean;
      conversion_quantity: string | null;
      conversion_origin: string | null;
      exclusive_supplier_id: string | null;
      exclusive_supplier_name: string | null;
    }[]
  >`
    SELECT
      p.id,
      p.erp_code,
      p.name,
      p.purchase_format,
      p.active,
      p.exclusive_supplier AS legacy_exclusive,
      ppp.conversion_quantity::text,
      ppp.conversion_origin,
      excl.supplier_id AS exclusive_supplier_id,
      s_excl.corporate_name AS exclusive_supplier_name
    FROM products p
    LEFT JOIN product_pricing_parameters ppp ON ppp.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT ps.supplier_id
      FROM product_suppliers ps
      WHERE ps.product_id = p.id
        AND ps.is_exclusive = true
        AND ps.active = true
      LIMIT 1
    ) excl ON true
    LEFT JOIN suppliers s_excl ON s_excl.id = excl.supplier_id
  `;

  // Fallback JEB se necessário para legacy exclusive
  const jebSupplier = allSuppliers.find(
    (s) => s.tax_id === "48336863000160" || s.corporate_name.toUpperCase().includes("JEB DISTRIBUIDORA"),
  );

  const catalogMap = new Map<string, (typeof allCatalogProducts)[0]>();
  const catalogSearchList: CatalogSearchItem[] = [];

  for (const prod of allCatalogProducts) {
    catalogMap.set(prod.id, prod);

    const isExclusive = Boolean(prod.exclusive_supplier_id) || prod.legacy_exclusive;
    const exclusiveSupplierId = prod.exclusive_supplier_id ?? (prod.legacy_exclusive && jebSupplier ? jebSupplier.id : null);
    const exclusiveSupplierName = prod.exclusive_supplier_name ?? (prod.legacy_exclusive && jebSupplier ? jebSupplier.corporate_name : null);

    const costInfo = costMap.get(prod.id);
    const purchasedInCosts = costInfo?.purchased ?? false;
    const orderedQuantities = cycleStoreOrders[prod.id] ?? {};
    const totalCycleOrders = sumQuantities(Object.values(orderedQuantities));

    if (prod.active) {
      catalogSearchList.push({
        id: prod.id,
        erpCode: prod.erp_code,
        name: prod.name,
        purchaseFormat: prod.purchase_format,
        isExclusive,
        exclusiveSupplierId,
        exclusiveSupplierName,
        purchasedInCosts,
        orderedQuantities,
        totalCycleOrders,
      });
    }
  }

  catalogSearchList.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));

  const storeSummary: Record<string, StoreSummaryData> = {};
  const storeClosures: Record<string, StoreClosureSummary> = {};

  for (const store of stores) {
    const activeOrder = latestOrdersByStore.get(store.id);
    const storeAllocations = allocationRows.filter((a) => a.store_id === store.id && parseQuantity(a.destined_quantity) > 0);
    const currentAllocationsHash = computeStoreAllocationsHash(
      storeAllocations.map((a) => ({
        productId: a.product_id,
        supplierId: a.supplier_id,
        destinedQuantity: a.destined_quantity,
      })),
    );

    // Produtos pedidos por esta loja
    const orderedProductIdsForStore = new Set<string>();
    for (const item of orderItemRows) {
      if (item.store_id === store.id && parseQuantity(item.quantity) > 0) {
        orderedProductIdsForStore.add(item.product_id);
      }
    }

    // Produtos com destinação positiva na loja
    const destinedProductIdsForStore = new Set(storeAllocations.map((a) => a.product_id));

    // Produtos relevantes para o cálculo de fingerprint de custos desta loja
    const relevantProductIds = new Set([
      ...orderedProductIdsForStore,
      ...destinedProductIdsForStore,
    ]);

    const currentCostsHash = computeStoreCostsHash(
      [...relevantProductIds].map((pid) => {
        const c = costMap.get(pid);
        return {
          productId: pid,
          purchased: c?.purchased ?? false,
          cost: c?.cost ?? null,
          costIsUnit: c?.cost_is_unit ?? false,
          version: c?.version ?? 0,
        };
      }),
    );

    const scRaw = rawStoreClosuresMap.get(store.id);
    let isStale = false;
    let staleReason: string | null = null;

    if (scRaw && scRaw.status === "CLOSED") {
      if (scRaw.allocations_hash !== currentAllocationsHash) {
        isStale = true;
        staleReason = "Destinações da loja foram alteradas após a conferência.";
      } else if (activeOrder && (scRaw.order_id !== activeOrder.order_id || scRaw.order_revision !== activeOrder.revision)) {
        isStale = true;
        staleReason = "Pedido da loja foi atualizado após a conferência.";
      } else if (!activeOrder && scRaw.order_id !== null) {
        isStale = true;
        staleReason = "Pedido da loja foi cancelado após a conferência.";
      } else if (scRaw.costs_hash && scRaw.costs_hash !== currentCostsHash) {
        isStale = true;
        staleReason = "Custos ou status de compra de produtos da loja foram alterados após a conferência.";
      }
    }

    const closureStatus = scRaw?.status === "CLOSED" ? "CLOSED" : "OPEN";

    // Mapa de destinações da loja por produto somando todos os fornecedores
    const storeAllocationsByProduct = new Map<string, string>();
    for (const a of storeAllocations) {
      const cur = parseQuantity(storeAllocationsByProduct.get(a.product_id) ?? "0");
      storeAllocationsByProduct.set(a.product_id, roundToTwoDecimals(cur + parseQuantity(a.destined_quantity)));
    }

    let totalDestinedProducts = 0;
    let totalPartialCutProducts = 0;
    let totalUnallocatedProducts = 0;

    for (const pid of orderedProductIdsForStore) {
      const orderedItem = orderItemRows.find((oi) => oi.store_id === store.id && oi.product_id === pid);
      const orderedQty = parseQuantity(orderedItem?.quantity ?? "0");
      const destinedQty = parseQuantity(storeAllocationsByProduct.get(pid) ?? "0");

      if (destinedQty >= orderedQty && destinedQty > 0) {
        totalDestinedProducts++;
      } else if (destinedQty > 0 && destinedQty < orderedQty) {
        totalPartialCutProducts++;
      } else {
        totalUnallocatedProducts++;
      }
    }

    for (const pid of destinedProductIdsForStore) {
      if (!orderedProductIdsForStore.has(pid)) {
        totalDestinedProducts++;
      }
    }

    // Pendências da loja:
    // Se a loja está FINALIZADA e NÃO stale: 0 pendências.
    // Se a loja está ABERTA (ou stale): itens que exigem conferência de cortes (parciais + totais)
    const totalPendingProducts = (closureStatus === "CLOSED" && !isStale)
      ? 0
      : (totalPartialCutProducts + totalUnallocatedProducts);

    const totalReviewedProducts = (closureStatus === "CLOSED" && !isStale)
      ? orderedProductIdsForStore.size
      : totalDestinedProducts;

    let cutsArray: StoreCutItem[] = [];
    if (scRaw && scRaw.status === "CLOSED" && !isStale && Array.isArray(scRaw.cut_summary)) {
      cutsArray = scRaw.cut_summary;
    } else {
      const storeOrderItems: Array<{
        productId: string;
        erpCode: number;
        productName: string;
        purchaseFormat: string;
        orderedQuantity: string;
      }> = [];

      for (const item of orderItemRows) {
        if (item.store_id === store.id && parseQuantity(item.quantity) > 0) {
          const prodInfo = catalogMap.get(item.product_id);
          storeOrderItems.push({
            productId: item.product_id,
            erpCode: prodInfo?.erp_code ?? 0,
            productName: prodInfo?.name ?? `Produto ${item.product_id}`,
            purchaseFormat: prodInfo?.purchase_format || "CX",
            orderedQuantity: item.quantity,
          });
        }
      }

      const cutCatalogMap = new Map<string, { erpCode: number; name: string; purchaseFormat: string }>();
      for (const [pid, prod] of catalogMap.entries()) {
        cutCatalogMap.set(pid, {
          erpCode: prod.erp_code,
          name: prod.name,
          purchaseFormat: prod.purchase_format,
        });
      }

      const calculated = calculateStoreCutSummary({
        orderedItems: storeOrderItems,
        storeAllocationsByProduct,
        catalogMap: cutCatalogMap,
      });
      cutsArray = calculated.cuts;
    }

    const previewOrderId = activeOrder?.order_id ?? null;
    const previewOrderRevision = activeOrder?.revision ?? null;
    const previewAllocationsHash = currentAllocationsHash;
    const previewCostsHash = currentCostsHash;

    const isClosedValid = closureStatus === "CLOSED" && !isStale;

    storeClosures[store.id] = {
      cycleDate,
      storeId: store.id,
      storeName: store.name,
      status: closureStatus,
      orderId: isClosedValid ? (scRaw?.order_id ?? previewOrderId) : previewOrderId,
      orderRevision: isClosedValid ? (scRaw?.order_revision ?? previewOrderRevision) : previewOrderRevision,
      totalOrderedItems: isClosedValid ? (scRaw?.total_ordered_items ?? orderedProductIdsForStore.size) : orderedProductIdsForStore.size,
      totalDestinedItems: isClosedValid ? (scRaw?.total_destined_items ?? destinedProductIdsForStore.size) : destinedProductIdsForStore.size,
      totalCutItems: isClosedValid ? (scRaw?.total_cut_items ?? cutsArray.filter((c) => c.status === "PARTIAL_CUT" || c.status === "TOTAL_CUT").length) : cutsArray.filter((c) => c.status === "PARTIAL_CUT" || c.status === "TOTAL_CUT").length,
      cuts: cutsArray,
      allocationsHash: isClosedValid ? (scRaw?.allocations_hash ?? currentAllocationsHash) : currentAllocationsHash,
      orderHash: isClosedValid ? (scRaw?.order_hash ?? (previewOrderId ? `${previewOrderId}:r${previewOrderRevision}` : null)) : (previewOrderId ? `${previewOrderId}:r${previewOrderRevision}` : null),
      costsHash: isClosedValid ? (scRaw?.costs_hash ?? currentCostsHash) : currentCostsHash,
      version: scRaw?.version ?? 1,
      isCurrent: scRaw?.is_current ?? true,
      closedAt: scRaw?.closed_at ?? null,
      closedByName: scRaw?.closed_by_name ?? null,
      reopenedAt: scRaw?.reopened_at ?? null,
      reopenedByName: scRaw?.reopened_by_name ?? null,
      reopenReason: scRaw?.reopen_reason ?? null,
      isStale,
      staleReason,
      previewOrderId,
      previewOrderRevision,
      previewAllocationsHash,
      previewCostsHash,
    };

    storeSummary[store.id] = {
      storeId: store.id,
      storeName: store.name,
      storeSlug: store.slug,
      totalAllocatedProducts: destinedProductIdsForStore.size,
      totalDestinedQuantity: sumQuantities(storeAllocations.map((a) => a.destined_quantity)),
      totalOrderedProducts: orderedProductIdsForStore.size,
      totalDestinedProducts,
      totalPartialCutProducts,
      totalUnallocatedProducts,
      totalReviewedProducts,
      totalPendingProducts,
      closureStatus,
      isStale,
      staleReason,
      closureSummary: cutsArray,
    };
  }

  // 8. Identifica produtos comprados que não foram alocados
  const unassignedPurchasedProducts: Array<{ id: string; erpCode: number; name: string; purchaseFormat: string }> = [];

  for (const pid of purchasedProductIds) {
    if (!globallyAllocatedProductIds.has(pid)) {
      const prod = catalogMap.get(pid);
      if (prod) {
        unassignedPurchasedProducts.push({
          id: prod.id,
          erpCode: prod.erp_code,
          name: prod.name,
          purchaseFormat: prod.purchase_format,
        });
      }
    }
  }

  // 10. Se um fornecedor específico foi selecionado (ou se há fornecedores disponíveis), constrói a visão de destinação dele
  const resolvedSupplierId =
    selectedSupplierId !== undefined
      ? selectedSupplierId
      : (supplierOptions.find((s) => s.hasAllocationsInCycle)?.id ?? supplierOptions[0]?.id ?? null);

  let destinationData: SupplierDestinationData | null = null;

  if (resolvedSupplierId) {
    const supplierRow = allSuppliers.find((s) => s.id === resolvedSupplierId);
    if (!supplierRow) {
      if (selectedSupplierId) {
        throw new AllocationValidationError("Fornecedor selecionado não encontrado.");
      }
    } else {
      // Utiliza a regra compartilhada e estrita de elegibilidade
      const targetProductIds = await getSupplierEligibleProductIds(sql, {
        cycleDate,
        supplierId: resolvedSupplierId,
        storeId: currentSelectedStoreId ?? undefined,
      });

      // Monta a lista de itens de destinação por produto
      const products: ProductAllocationItem[] = [];

      for (const pid of targetProductIds) {
        const prod = catalogMap.get(pid);
        if (!prod) continue;

        const isExclusive = Boolean(prod.exclusive_supplier_id) || prod.legacy_exclusive;
        const exclusiveSupplierId = prod.exclusive_supplier_id ?? (prod.legacy_exclusive && jebSupplier ? jebSupplier.id : null);
        const exclusiveSupplierName = prod.exclusive_supplier_name ?? (prod.legacy_exclusive && jebSupplier ? jebSupplier.corporate_name : null);

        const costInfo = costMap.get(pid);
        const hasOfficialCost = Boolean(costInfo?.cost);
        const officialCost = costInfo?.cost ?? null;
        const purchasedInCosts = costInfo?.purchased ?? false;

        const existingSupplierAllocs = allocationsBySupplierAndProduct.get(`${resolvedSupplierId}:${pid}`) ?? [];
        const allocByStore = new Map(existingSupplierAllocs.map((a) => [a.store_id, a]));

        const storeAllocations: Record<string, StoreAllocationData> = {};
        const orderedQtyList: string[] = [];
        const destinedQtyList: string[] = [];
        let itemVersion = 1;
        let itemNotes: string | null = null;

        for (const store of stores) {
          const orderQty = storeOrderQuantityMap.get(`${store.id}:${pid}`) ?? "0.00";
          const alloc = allocByStore.get(store.id);
          const isNotPurchased =
            supplierDecisionsMap.get(`${resolvedSupplierId}:${pid}:${store.id}`) === "NOT_PURCHASED";

          let destinedQty: string;
          let isAdditional = false;

          if (alloc) {
            destinedQty = alloc.destined_quantity;
            isAdditional = alloc.is_additional_purchase;
            if (alloc.version > itemVersion) itemVersion = alloc.version;
            if (alloc.notes) itemNotes = alloc.notes;
          } else if (isNotPurchased) {
            destinedQty = "0.00";
            isAdditional = false;
          } else {
            // Se não há alocação salva ainda para esta loja neste fornecedor:
            // Calcula o quanto já foi destinado para esta loja em OUTROS fornecedores
            const alreadyDestinedOther = allocationRows
              .filter(
                (a) =>
                  a.product_id === pid &&
                  a.store_id === store.id &&
                  a.supplier_id !== resolvedSupplierId &&
                  parseQuantity(a.destined_quantity) > 0,
              )
              .reduce((sum, a) => sum + parseQuantity(a.destined_quantity), 0);

            destinedQty = calculateSuggestedDestinedQuantity({
              orderedQuantity: orderQty,
              alreadyDestinedOtherSuppliers: alreadyDestinedOther,
              isPurchasedInCosts,
            });
            isAdditional = parseQuantity(orderQty) === 0 && parseQuantity(destinedQty) > 0;
          }

          const diff = calculateDifference(destinedQty, orderQty);

          storeAllocations[store.id] = {
            storeId: store.id,
            storeName: store.name,
            storeSlug: store.slug,
            orderedQuantity: roundToTwoDecimals(orderQty),
            destinedQuantity: roundToTwoDecimals(destinedQty),
            persistedDestinedQuantity: alloc
              ? roundToTwoDecimals(alloc.destined_quantity)
              : null,
            difference: diff,
            isAdditionalPurchase: isAdditional,
            notes: alloc?.notes ?? null,
          };

          orderedQtyList.push(orderQty);
          destinedQtyList.push(destinedQty);
        }

        const totalOrdered = sumQuantities(orderedQtyList);
        const totalDestined = sumQuantities(destinedQtyList);
        const totalDiff = calculateDifference(totalDestined, totalOrdered);
        const isAdditionalOverall = parseQuantity(totalOrdered) === 0 && parseQuantity(totalDestined) > 0;

        // Mantém snapshot de conversão
        const conversionFactorKg = prod.conversion_quantity;
        const conversionOrigin = prod.conversion_origin;

        // Decisão individual do fornecedor para a loja selecionada
        const supplierDecision = currentSelectedStoreId
          ? ((supplierDecisionsMap.get(`${resolvedSupplierId}:${prod.id}:${currentSelectedStoreId}`) as "NOT_PURCHASED") ?? null)
          : null;

        // Total já destinado a este produto na loja selecionada (somando todos os fornecedores)
        const storeAllocsAcrossSuppliers = currentSelectedStoreId
          ? allocationRows.filter(
              (a) => a.product_id === prod.id && a.store_id === currentSelectedStoreId && parseQuantity(a.destined_quantity) > 0,
            )
          : [];
        const storeTotalDestinedAcrossSuppliers = sumQuantities(
          storeAllocsAcrossSuppliers.map((a) => a.destined_quantity),
        );

        products.push({
          productId: prod.id,
          erpCode: prod.erp_code,
          productName: prod.name,
          purchaseFormat: prod.purchase_format,
          isExclusive,
          exclusiveSupplierId,
          exclusiveSupplierName,
          hasOfficialCost,
          officialCost,
          purchasedInCosts,
          isAdditionalPurchase: isAdditionalOverall,
          conversionFactorKg,
          conversionOrigin,
          stores: storeAllocations,
          totalOrdered,
          totalDestined,
          totalDifference: totalDiff,
          notes: itemNotes,
          version: itemVersion,
          supplierDecision,
          storeTotalDestinedAcrossSuppliers,
        });
      }

      products.sort((a, b) => a.productName.localeCompare(b.productName, "pt-BR", { sensitivity: "base" }));

      destinationData = {
        supplierId: supplierRow.id,
        corporateName: supplierRow.corporate_name,
        tradeName: supplierRow.trade_name,
        taxId: supplierRow.tax_id,
        taxInvoiceRule: supplierRow.tax_invoice_rule,
        products,
        totalProductsCount: products.length,
        totalDestinedQuantity: sumQuantities(products.map((p) => p.totalDestined)),
      };
    }
  }

  // Validação para o fechamento
  const simpleCatalogMap = new Map<string, { id: string; erpCode: number; name: string }>();
  for (const prod of allCatalogProducts) {
    simpleCatalogMap.set(prod.id, {
      id: prod.id,
      erpCode: prod.erp_code,
      name: prod.name,
    });
  }

  const { canClose, missingStores, missingProducts } = validateCycleClosureReadinessStoreFirst({
    stores,
    storeClosures,
    purchasedProductIds,
    globallyAllocatedProductIds,
    catalogMap: simpleCatalogMap,
  });

  const closure: BuyerCycleClosureSummary = {
    cycleDate,
    status: closureStatus,
    closedAt: closureRaw?.closed_at ?? null,
    closedByName: closureRaw?.closed_by_name ?? null,
    reopenedAt: closureRaw?.reopened_at ?? null,
    reopenedByName: closureRaw?.reopened_by_name ?? null,
    reopenReason: closureRaw?.reopen_reason ?? null,
    totalPurchasedInCosts: purchasedProductIds.length,
    totalAllocatedProducts: globallyAllocatedProductIds.size,
    missingProducts,
    missingStores,
    canClose,
  };

  return {
    cycleDate,
    cycles,
    selectedStoreId: currentSelectedStoreId,
    selectedSupplierId: resolvedSupplierId,
    closure,
    suppliers: supplierOptions,
    stores,
    destinationData,
    unassignedPurchasedProducts,
    catalogSearchList,
    cycleStoreOrders,
    storeSummary,
    storeClosures,
    supplierStoreReviews,
    loadedAt: new Date().toISOString(),
  };
}

export async function saveSupplierAllocations(
  principal: Principal,
  input: SaveSupplierAllocationsInput,
): Promise<{ success: boolean; affectedProductsCount: number }> {
  assertPermission(principal, "compras:destinacao");

  if (!isCycleDate(input.cycleDate)) {
    throw new AllocationValidationError("Data de compra inválida.");
  }

  const sql = database().sql;

  return await sql.begin(async (tx) => {
    // 1. Lock transacional serializado por ciclo para evitar concorrência entre gravação e fechamento
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${input.cycleDate}::text))`;

    // 2. Verifica se o ciclo está fechado
    const [closure] = await tx<{ status: string }[]>`
      SELECT status
      FROM purchase_cycle_buyer_closures
      WHERE purchase_cycle_date = ${input.cycleDate}::date
    `;

    if (closure && closure.status === "CLOSED") {
      throw new CycleClosedError(
        "O ciclo de compras está fechado. Reabra o ciclo operacional para realizar alterações.",
      );
    }

    // 3. Valida fornecedor
    const [supplier] = await tx<{ id: string; active: boolean; corporate_name: string; tax_id: string | null }[]>`
      SELECT id, active, corporate_name, tax_id
      FROM suppliers
      WHERE id = ${input.supplierId}::uuid
    `;

    if (!supplier) {
      throw new AllocationValidationError("Fornecedor não encontrado.");
    }

    if (!supplier.active) {
      throw new AllocationValidationError(`Fornecedor ${supplier.corporate_name} está inativo.`);
    }

    // 4. Busca pedidos válidos das lojas para recuperar quantidade pedida original
    const orderRows = await tx<{ store_id: string; order_id: string }[]>`
      WITH latest_orders AS (
        SELECT DISTINCT ON (store_id)
          id,
          store_id,
          cancelled_at
        FROM orders
        WHERE purchase_cycle_date = ${input.cycleDate}::date
        ORDER BY store_id, submitted_at DESC, revision DESC, id DESC
      )
      SELECT store_id, id AS order_id
      FROM latest_orders
      WHERE cancelled_at IS NULL
    `;

    const validOrderIds = orderRows.map((o) => o.order_id);
    const orderItemRows = validOrderIds.length > 0
      ? await tx<{ store_id: string; product_id: string; quantity: string }[]>`
          SELECT o.store_id, oi.product_id, oi.quantity::text
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE oi.order_id IN ${tx(validOrderIds)}
        `
      : [];

    const storeOriginalOrderMap = new Map<string, string>();
    for (const item of orderItemRows) {
      storeOriginalOrderMap.set(`${item.store_id}:${item.product_id}`, item.quantity);
    }

    const storeRows = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM stores
    `;
    const storeNameMap = new Map<string, string>(storeRows.map((s) => [s.id, s.name]));

    // 5. Itera sobre os produtos para validações de exclusividade e gravação
    let affectedCount = 0;

    for (const productInput of input.allocations) {
      // Verifica integridade do produto e exclusividade
      const [prodRow] = await tx<
        {
          id: string;
          erp_code: number;
          name: string;
          purchase_format: string;
          exclusive_supplier: boolean;
          conversion_quantity: string | null;
          conversion_origin: string | null;
          exclusive_supplier_id: string | null;
          exclusive_supplier_name: string | null;
        }[]
      >`
        SELECT
          p.id,
          p.erp_code,
          p.name,
          p.purchase_format,
          p.exclusive_supplier,
          ppp.conversion_quantity::text,
          ppp.conversion_origin,
          excl.supplier_id AS exclusive_supplier_id,
          s_excl.corporate_name AS exclusive_supplier_name
        FROM products p
        LEFT JOIN product_pricing_parameters ppp ON ppp.product_id = p.id
        LEFT JOIN LATERAL (
          SELECT ps.supplier_id
          FROM product_suppliers ps
          WHERE ps.product_id = p.id
            AND ps.is_exclusive = true
            AND ps.active = true
          LIMIT 1
        ) excl ON true
        LEFT JOIN suppliers s_excl ON s_excl.id = excl.supplier_id
        WHERE p.id = ${productInput.productId}::uuid
      `;

      if (!prodRow) {
        throw new AllocationValidationError(`Produto não encontrado: ${productInput.productId}`);
      }

      const targetStores = input.storeId
        ? productInput.stores.filter((s) => s.storeId === input.storeId)
        : productInput.stores;

      // Busca alocações existentes para este produto/fornecedor/ciclo
      const existingAllocRows = await tx<
        {
          id: string;
          store_id: string;
          ordered_quantity: string;
          destined_quantity: string;
          is_additional_purchase: boolean;
          notes: string | null;
          version: number;
        }[]
      >`
        SELECT id, store_id, ordered_quantity::text, destined_quantity::text, is_additional_purchase, notes, version
        FROM purchase_cycle_product_allocations
        WHERE purchase_cycle_date = ${input.cycleDate}::date
          AND supplier_id = ${input.supplierId}::uuid
          AND product_id = ${prodRow.id}::uuid
        FOR UPDATE
      `;
      const hasExistingAllocation = existingAllocRows.some(
        (r) => parseQuantity(r.destined_quantity) > 0,
      );
      const existingStoreMap = new Map(existingAllocRows.map((r) => [r.store_id, r]));

      // Regra de exclusividade:
      // Se produto é exclusivo de outro fornecedor, rejeitar novas destinações ou aumentos indevidos.
      // Permitir redução e zeragem de alocações preexistentes para viabilizar correções históricas.
      const isJeb =
        supplier.tax_id === "48336863000160" ||
        supplier.corporate_name.toUpperCase().includes("JEB DISTRIBUIDORA");

      const isExclusivityViolated =
        (prodRow.exclusive_supplier_id && prodRow.exclusive_supplier_id !== input.supplierId) ||
        (prodRow.exclusive_supplier && !prodRow.exclusive_supplier_id && !isJeb);

      if (isExclusivityViolated) {
        const isAttemptingNewOrIncreasedAllocation = targetStores.some((storeInput) => {
          const destinedNum = parseQuantity(storeInput.destinedQuantity);
          const existingAlloc = existingStoreMap.get(storeInput.storeId);
          const previousDestinedNum = existingAlloc ? parseQuantity(existingAlloc.destined_quantity) : 0;
          return destinedNum > previousDestinedNum || (previousDestinedNum <= 0 && destinedNum > 0);
        });

        if (isAttemptingNewOrIncreasedAllocation) {
          if (prodRow.exclusive_supplier_id && prodRow.exclusive_supplier_id !== input.supplierId) {
            throw new ExclusivityViolationError(
              `O produto "${prodRow.name}" é exclusivo do fornecedor "${prodRow.exclusive_supplier_name}". Não pode ser comprado de outro fornecedor.`,
            );
          }
          if (prodRow.exclusive_supplier && !prodRow.exclusive_supplier_id && !isJeb) {
            throw new ExclusivityViolationError(
              `O produto "${prodRow.name}" é exclusivo da JEB Distribuidora. Não pode ser comprado de outro fornecedor.`,
            );
          }
        }
      }

      let productChanged = false;

      // Verifica se o produto foi marcado como comprado nos custos deste ciclo
      const [costRow] = await tx<{ purchased: boolean; cost: string | null }[]>`
        SELECT purchased, cost
        FROM purchase_cycle_product_costs
        WHERE purchase_cycle_date = ${input.cycleDate}::date
          AND product_id = ${prodRow.id}::uuid
      `;
      const isPurchasedInCosts = costRow?.purchased ?? false;

      // Soma total de pedidos das lojas para este produto no ciclo
      let totalCycleOrdersNum = 0;
      for (const [key, qtyStr] of storeOriginalOrderMap.entries()) {
        if (key.endsWith(`:${prodRow.id}`)) {
          totalCycleOrdersNum += parseQuantity(qtyStr);
        }
      }

      // Total destinado nesta requisição para este produto
      const totalDestinedInRequest = targetStores.reduce(
        (sum, s) => sum + parseQuantity(s.destinedQuantity),
        0
      );

      // Validação das regras de compra (Bug 03 - Regras A, B e C com auditoria e confirmação explícita)
      const validation = validateAllocationPurchasedStatus({
        productName: prodRow.name,
        erpCode: prodRow.erp_code,
        purchaseFormat: prodRow.purchase_format,
        isPurchasedInCosts,
        totalCycleOrdersNum,
        totalDestinedNum: totalDestinedInRequest,
        isOpportunityConfirmed: productInput.isOpportunityConfirmed,
        hasExistingAllocation,
      });

      if (!validation.isValid) {
        throw new AllocationValidationError(validation.errorMessage!);
      }

      for (const storeInput of targetStores) {
        const destinedNum = parseQuantity(storeInput.destinedQuantity);
        const originalOrderStr = storeOriginalOrderMap.get(`${storeInput.storeId}:${prodRow.id}`) ?? "0";
        const originalOrderNum = parseQuantity(originalOrderStr);
        const existingAlloc = existingStoreMap.get(storeInput.storeId);
        const previousDestinedNum = existingAlloc ? parseQuantity(existingAlloc.destined_quantity) : 0;

        const isOpportunity = totalCycleOrdersNum === 0 && !isPurchasedInCosts;
        const isAdditional = isOpportunity || (originalOrderNum === 0 && destinedNum > 0);

        const prevCents = Math.round(previousDestinedNum * 100);
        const newCents = Math.round(destinedNum * 100);
        const storeName = storeNameMap.get(storeInput.storeId) ?? "Loja";
        const nextNotes = storeInput.notes ?? productInput.notes ?? null;
        const originalOrderCents = Math.round(originalOrderNum * 100);
        const existingOrderCents = existingAlloc
          ? Math.round(parseQuantity(existingAlloc.ordered_quantity) * 100)
          : 0;
        const allocationWillChange = existingAlloc
          ? prevCents !== newCents ||
            existingOrderCents !== originalOrderCents ||
            existingAlloc.is_additional_purchase !== isAdditional ||
            (existingAlloc.notes ?? null) !== nextNotes
          : destinedNum > 0 || originalOrderNum > 0;

        const competingAllocationRows = destinedNum > 0
          ? await tx<
              {
                id: string;
                supplier_id: string;
                supplier_name: string;
                destined_quantity: string;
                ordered_quantity: string;
                version: number;
              }[]
            >`
              SELECT
                a.id,
                a.supplier_id,
                s.corporate_name AS supplier_name,
                a.destined_quantity::text,
                a.ordered_quantity::text,
                a.version
              FROM purchase_cycle_product_allocations a
              JOIN suppliers s ON s.id = a.supplier_id
              WHERE a.purchase_cycle_date = ${input.cycleDate}::date
                AND a.product_id = ${prodRow.id}::uuid
                AND a.store_id = ${storeInput.storeId}::uuid
                AND a.supplier_id <> ${input.supplierId}::uuid
                AND a.destined_quantity > 0
              ORDER BY s.corporate_name, a.supplier_id
              FOR UPDATE OF a
            `
          : [];

        if (allocationWillChange && competingAllocationRows.length > 0) {
          const existingPositiveAllocations = [
            ...(prevCents > 0
              ? [{
                  supplierId: input.supplierId,
                  supplierName: supplier.corporate_name,
                  destinedQuantity: previousDestinedNum.toFixed(2),
                  isTargetSupplier: true,
                }]
              : []),
            ...competingAllocationRows.map((row) => ({
              supplierId: row.supplier_id,
              supplierName: row.supplier_name,
              destinedQuantity: roundToTwoDecimals(row.destined_quantity),
              isTargetSupplier: false,
            })),
          ];
          const conflictFingerprint = [
            input.cycleDate,
            prodRow.id,
            storeInput.storeId,
            `target:${input.supplierId}:${existingAlloc?.version ?? 0}:${previousDestinedNum.toFixed(2)}`,
            ...competingAllocationRows.map((row) =>
              `${row.supplier_id}:${row.version}:${roundToTwoDecimals(row.destined_quantity)}`,
            ),
          ].join("|");
          const conflict = {
            productId: prodRow.id,
            productName: prodRow.name,
            erpCode: prodRow.erp_code,
            purchaseFormat: prodRow.purchase_format,
            storeId: storeInput.storeId,
            storeName,
            orderedQuantity: roundToTwoDecimals(originalOrderStr),
            intendedQuantity: destinedNum.toFixed(2),
            totalAlreadyDestined: sumQuantities(
              existingPositiveAllocations.map((allocation) => allocation.destinedQuantity),
            ),
            allocations: existingPositiveAllocations,
            fingerprint: conflictFingerprint,
          };

          if (
            !storeInput.conflictResolution ||
            storeInput.conflictFingerprint !== conflictFingerprint
          ) {
            throw new AllocationDestinationConflictError(
              `O produto "${prodRow.name}" já possui destinação positiva em outro fornecedor para ${storeName}. Confirme se deseja transferir ou registrar uma compra realmente dividida.`,
              [conflict],
            );
          }

          if (storeInput.conflictResolution === "TRANSFER") {
            for (const source of competingAllocationRows) {
              await tx`
                UPDATE purchase_cycle_product_allocations
                SET
                  destined_quantity = 0,
                  updated_by = ${principal.userId}::uuid,
                  version = version + 1,
                  updated_at = now()
                WHERE id = ${source.id}::uuid
              `;

              await tx`
                INSERT INTO audit_events (
                  id, actor_id, action, entity_type, entity_id, metadata, created_at
                ) VALUES (
                  gen_random_uuid(),
                  ${principal.userId}::uuid,
                  'ALLOCATION_TRANSFERRED',
                  'purchase_cycle_product_allocation',
                  ${source.id}::text,
                  ${JSON.stringify({
                    cycleDate: input.cycleDate,
                    productId: prodRow.id,
                    productName: prodRow.name,
                    productErpCode: prodRow.erp_code,
                    storeId: storeInput.storeId,
                    storeName,
                    sourceSupplierId: source.supplier_id,
                    sourceSupplierName: source.supplier_name,
                    sourcePreviousDestinedQuantity: roundToTwoDecimals(source.destined_quantity),
                    destinationSupplierId: input.supplierId,
                    destinationSupplierName: supplier.corporate_name,
                    destinationDestinedQuantity: destinedNum.toFixed(2),
                    orderedQuantity: roundToTwoDecimals(originalOrderStr),
                    sourcePreviousVersion: source.version,
                    resolution: "TRANSFER",
                  })}::jsonb,
                  now()
                )
              `;
            }
            productChanged = true;
          } else {
            await tx`
              INSERT INTO audit_events (
                id, actor_id, action, entity_type, entity_id, metadata, created_at
              ) VALUES (
                gen_random_uuid(),
                ${principal.userId}::uuid,
                'ALLOCATION_SPLIT_CONFIRMED',
                'purchase_cycle_product_allocation',
                ${existingAlloc?.id ?? prodRow.id}::text,
                ${JSON.stringify({
                  cycleDate: input.cycleDate,
                  productId: prodRow.id,
                  productName: prodRow.name,
                  productErpCode: prodRow.erp_code,
                  storeId: storeInput.storeId,
                  storeName,
                  supplierId: input.supplierId,
                  supplierName: supplier.corporate_name,
                  orderedQuantity: roundToTwoDecimals(originalOrderStr),
                  intendedQuantity: destinedNum.toFixed(2),
                  totalAlreadyDestined: sumQuantities(
                    existingPositiveAllocations.map((allocation) => allocation.destinedQuantity),
                  ),
                  existingAllocations: existingPositiveAllocations,
                  resolution: "SPLIT_CONFIRMED",
                })}::jsonb,
                now()
              )
            `;
            productChanged = true;
          }
        }

        if (!allocationWillChange) {
          continue;
        }

        // Auditoria Transacional Completa:
        // Caso 1: Destinação anterior era positiva e agora foi zerada
        if (prevCents > 0 && newCents === 0) {
          const reason =
            storeInput.notes ??
            productInput.notes ??
            (existingAlloc?.is_additional_purchase
              ? "Remoção de compra de oportunidade"
              : !isPurchasedInCosts
              ? "Zerar destinação indevida de produto não comprado"
              : "Zerar destinação / corte total da loja");

          await tx`
            INSERT INTO audit_events (
              id,
              actor_id,
              action,
              entity_type,
              entity_id,
              metadata,
              created_at
            ) VALUES (
              gen_random_uuid(),
              ${principal.userId}::uuid,
              'ALLOCATION_ZEROED',
              'purchase_cycle_product_allocation',
              ${existingAlloc?.id ?? prodRow.id}::text,
              ${JSON.stringify({
                cycleDate: input.cycleDate,
                supplierId: input.supplierId,
                supplierName: supplier.corporate_name,
                productId: prodRow.id,
                productName: prodRow.name,
                productErpCode: prodRow.erp_code,
                storeId: storeInput.storeId,
                storeName,
                previousDestinedQuantity: existingAlloc?.destined_quantity ?? previousDestinedNum.toFixed(2),
                newDestinedQuantity: "0.00",
                previousOrderedQuantity: existingAlloc?.ordered_quantity ?? originalOrderStr,
                isAdditionalPurchase: existingAlloc?.is_additional_purchase ?? false,
                previousVersion: existingAlloc?.version ?? 1,
                reason,
              })}::jsonb,
              now()
            )
          `;
        } else if (newCents > 0 && isOpportunity && (!existingAlloc || prevCents === 0)) {
          // Caso 2: Criação de nova compra de oportunidade
          await tx`
            INSERT INTO audit_events (
              id,
              actor_id,
              action,
              entity_type,
              entity_id,
              metadata,
              created_at
            ) VALUES (
              gen_random_uuid(),
              ${principal.userId}::uuid,
              'OPPORTUNITY_ALLOCATION_CREATED',
              'purchase_cycle_product_allocation',
              ${existingAlloc?.id ?? prodRow.id}::text,
              ${JSON.stringify({
                cycleDate: input.cycleDate,
                supplierId: input.supplierId,
                supplierName: supplier.corporate_name,
                productId: prodRow.id,
                productName: prodRow.name,
                productErpCode: prodRow.erp_code,
                storeId: storeInput.storeId,
                storeName,
                previousDestinedQuantity: "0.00",
                destinedQuantity: destinedNum.toFixed(2),
                newDestinedQuantity: destinedNum.toFixed(2),
                previousOrderedQuantity: "0.00",
                isAdditionalPurchase: true,
                isOpportunityConfirmed: true,
                previousVersion: existingAlloc?.version ?? 0,
                reason: storeInput.notes ?? productInput.notes ?? "Inclusão de compra de oportunidade sem pedido",
              })}::jsonb,
              now()
            )
          `;
        } else if (newCents > 0 && !isOpportunity && (!existingAlloc || prevCents === 0)) {
          // Caso 3: Criação de destinação normal inicial
          await tx`
            INSERT INTO audit_events (
              id,
              actor_id,
              action,
              entity_type,
              entity_id,
              metadata,
              created_at
            ) VALUES (
              gen_random_uuid(),
              ${principal.userId}::uuid,
              'ALLOCATION_CREATED',
              'purchase_cycle_product_allocation',
              ${existingAlloc?.id ?? prodRow.id}::text,
              ${JSON.stringify({
                cycleDate: input.cycleDate,
                supplierId: input.supplierId,
                supplierName: supplier.corporate_name,
                productId: prodRow.id,
                productName: prodRow.name,
                productErpCode: prodRow.erp_code,
                storeId: storeInput.storeId,
                storeName,
                previousDestinedQuantity: "0.00",
                newDestinedQuantity: destinedNum.toFixed(2),
                previousOrderedQuantity: originalOrderStr,
                isAdditionalPurchase: isAdditional,
                previousVersion: existingAlloc?.version ?? 0,
                reason: storeInput.notes ?? productInput.notes ?? "Criação de destinação de compras",
              })}::jsonb,
              now()
            )
          `;
        } else if (prevCents > 0 && newCents > 0 && prevCents !== newCents) {
          // Caso 4: Alteração de quantidade positiva para outra quantidade positiva (ex: 5 CX -> 3 CX)
          const defaultReason =
            destinedNum < previousDestinedNum
              ? `Redução de destinação (${previousDestinedNum.toFixed(2)} -> ${destinedNum.toFixed(2)})`
              : `Aumento de destinação (${previousDestinedNum.toFixed(2)} -> ${destinedNum.toFixed(2)})`;

          await tx`
            INSERT INTO audit_events (
              id,
              actor_id,
              action,
              entity_type,
              entity_id,
              metadata,
              created_at
            ) VALUES (
              gen_random_uuid(),
              ${principal.userId}::uuid,
              'ALLOCATION_UPDATED',
              'purchase_cycle_product_allocation',
              ${existingAlloc?.id ?? prodRow.id}::text,
              ${JSON.stringify({
                cycleDate: input.cycleDate,
                supplierId: input.supplierId,
                supplierName: supplier.corporate_name,
                productId: prodRow.id,
                productName: prodRow.name,
                productErpCode: prodRow.erp_code,
                storeId: storeInput.storeId,
                storeName,
                previousDestinedQuantity: existingAlloc?.destined_quantity ?? previousDestinedNum.toFixed(2),
                newDestinedQuantity: destinedNum.toFixed(2),
                previousOrderedQuantity: existingAlloc?.ordered_quantity ?? originalOrderStr,
                isAdditionalPurchase: existingAlloc?.is_additional_purchase ?? isAdditional,
                previousVersion: existingAlloc?.version ?? 1,
                reason: storeInput.notes ?? productInput.notes ?? defaultReason,
              })}::jsonb,
              now()
            )
          `;
        }
        // Caso 5: Se prevCents === newCents, não gera evento duplicado (inalterado)

        // Gravação da alocação no banco:
        // Apenas persiste se a quantidade destinada for positiva (> 0) OU se já existia alocação positiva anterior sendo zerada.
        // Isso evita criar linhas desnecessárias de alocação 0.00 para fornecedores que não atenderam o item.
        const shouldPersistAllocation =
          destinedNum > 0 || (existingAlloc && previousDestinedNum > 0);

        if (shouldPersistAllocation) {
          if (destinedNum > 0) {
            await tx`
              DELETE FROM purchase_cycle_product_supplier_decisions
              WHERE purchase_cycle_date = ${input.cycleDate}::date
                AND supplier_id = ${input.supplierId}::uuid
                AND product_id = ${prodRow.id}::uuid
                AND store_id = ${storeInput.storeId}::uuid
            `;
          }

          await tx`
            INSERT INTO purchase_cycle_product_allocations (
              purchase_cycle_date,
              supplier_id,
              product_id,
              store_id,
              ordered_quantity,
              destined_quantity,
              purchase_format,
              is_additional_purchase,
              conversion_factor_kg,
              conversion_origin,
              notes,
              created_by,
              updated_by,
              version,
              created_at,
              updated_at
            )
            VALUES (
              ${input.cycleDate}::date,
              ${input.supplierId}::uuid,
              ${prodRow.id}::uuid,
              ${storeInput.storeId}::uuid,
              ${originalOrderNum.toFixed(2)}::numeric,
              ${destinedNum.toFixed(2)}::numeric,
              ${prodRow.purchase_format},
              ${isAdditional},
              ${prodRow.conversion_quantity ? Number(prodRow.conversion_quantity).toFixed(3) : null}::numeric,
              ${prodRow.conversion_origin ?? null},
              ${nextNotes},
              ${principal.userId}::uuid,
              ${principal.userId}::uuid,
              1,
              now(),
              now()
            )
            ON CONFLICT (purchase_cycle_date, supplier_id, product_id, store_id)
            DO UPDATE SET
              destined_quantity = EXCLUDED.destined_quantity,
              ordered_quantity = EXCLUDED.ordered_quantity,
              is_additional_purchase = EXCLUDED.is_additional_purchase,
              conversion_factor_kg = COALESCE(purchase_cycle_product_allocations.conversion_factor_kg, EXCLUDED.conversion_factor_kg),
              conversion_origin = COALESCE(purchase_cycle_product_allocations.conversion_origin, EXCLUDED.conversion_origin),
              notes = EXCLUDED.notes,
              updated_by = ${principal.userId}::uuid,
              version = purchase_cycle_product_allocations.version + 1,
              updated_at = now()
          `;
          productChanged = true;
        } else {
          // Se ambas as quantidades são 0, limpa alocação desnecessária
          await tx`
            DELETE FROM purchase_cycle_product_allocations
            WHERE purchase_cycle_date = ${input.cycleDate}::date
              AND supplier_id = ${input.supplierId}::uuid
              AND product_id = ${prodRow.id}::uuid
              AND store_id = ${storeInput.storeId}::uuid
          `;
          productChanged ||= Boolean(existingAlloc);
        }
      }

      if (productChanged) {
        affectedCount++;
      }
    }

    return {
      success: true,
      affectedProductsCount: affectedCount,
    };
  });
}

export async function closeBuyerCycle(
  principal: Principal,
  cycleDate: string,
): Promise<{ success: boolean; closedAt: string }> {
  assertPermission(principal, "compras:destinacao");

  if (!isCycleDate(cycleDate)) {
    throw new AllocationValidationError("Data de compra inválida.");
  }

  const sql = database().sql;

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${cycleDate}::text))`;

    // 1. Verifica estado atual
    const [existing] = await tx<{ status: string }[]>`
      SELECT status
      FROM purchase_cycle_buyer_closures
      WHERE purchase_cycle_date = ${cycleDate}::date
    `;

    if (existing && existing.status === "CLOSED") {
      throw new AllocationValidationError("O ciclo de compras já está fechado.");
    }

    // 1.1 Validação Store-First: Lojas participantes históricas precisam ter conferência válida em purchase_cycle_store_closures
    const participatingStores = await resolveParticipatingStores(tx, cycleDate);

    if (participatingStores.length === 0) {
      throw new AllocationValidationError(
        "Não é possível fechar o ciclo de compras: nenhuma loja participante identificada para esta data.",
      );
    }

    const storeClosureRows = await tx<{
      store_id: string;
      order_id: string | null;
      order_revision: number | null;
      status: string;
      allocations_hash: string;
      costs_hash: string | null;
    }[]>`
      SELECT store_id, order_id, order_revision, status, allocations_hash, costs_hash
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${cycleDate}::date
        AND is_current = true
    `;
    const storeClosuresMap = new Map(storeClosureRows.map((r) => [r.store_id, r]));

    const missingStoreNames: string[] = [];
    const staleStoreNames: string[] = [];

    for (const st of participatingStores) {
      const sc = storeClosuresMap.get(st.id);
      if (!sc || sc.status !== "CLOSED") {
        missingStoreNames.push(st.name);
        continue;
      }

      // Validação de staleness:
      // a) Pedido atual da loja
      const [currOrder] = await tx<{ id: string; revision: number }[]>`
        SELECT id, revision
        FROM orders
        WHERE purchase_cycle_date = ${cycleDate}::date
          AND store_id = ${st.id}::uuid
          AND cancelled_at IS NULL
        ORDER BY submitted_at DESC, revision DESC, id DESC
        LIMIT 1
      `;

      if (currOrder && (sc.order_id !== currOrder.id || sc.order_revision !== currOrder.revision)) {
        staleStoreNames.push(`${st.name} (pedido atualizado após a conferência)`);
        continue;
      }
      if (!currOrder && sc.order_id !== null) {
        staleStoreNames.push(`${st.name} (pedido cancelado após a conferência)`);
        continue;
      }

      // b) Alocações atuais da loja
      const currentStoreAllocs = await tx<{ product_id: string; supplier_id: string; destined_quantity: string }[]>`
        SELECT product_id, supplier_id, destined_quantity::text
        FROM purchase_cycle_product_allocations
        WHERE purchase_cycle_date = ${cycleDate}::date
          AND store_id = ${st.id}::uuid
          AND destined_quantity > 0
      `;

      const currentHash = computeStoreAllocationsHash(
        currentStoreAllocs.map((a) => ({
          productId: a.product_id,
          supplierId: a.supplier_id,
          destinedQuantity: a.destined_quantity,
        })),
      );
      if (sc.allocations_hash !== currentHash) {
        staleStoreNames.push(`${st.name} (destinações alteradas após a conferência)`);
        continue;
      }

      // c) Custos relevantes atuais da loja
      const relevantPids = new Set<string>();
      if (currOrder) {
        const orderItems = await tx<{ product_id: string }[]>`
          SELECT product_id FROM order_items WHERE order_id = ${currOrder.id}::uuid AND quantity > 0
        `;
        for (const oi of orderItems) relevantPids.add(oi.product_id);
      }
      for (const a of currentStoreAllocs) relevantPids.add(a.product_id);

      if (relevantPids.size > 0) {
        const currentCostRows = await tx<{
          product_id: string;
          purchased: boolean;
          cost: string | null;
          cost_is_unit: boolean | null;
          version: number | null;
        }[]>`
          SELECT product_id, purchased, cost::text, cost_is_unit, version
          FROM purchase_cycle_product_costs
          WHERE purchase_cycle_date = ${cycleDate}::date
            AND product_id IN ${tx([...relevantPids])}
        `;
        const currentCostsHash = computeStoreCostsHash(
          [...relevantPids].map((pid) => {
            const c = currentCostRows.find((row) => row.product_id === pid);
            return {
              productId: pid,
              purchased: c?.purchased ?? false,
              cost: c?.cost ?? null,
              costIsUnit: c?.cost_is_unit ?? false,
              version: c?.version ?? 0,
            };
          }),
        );
        if (sc.costs_hash && sc.costs_hash !== currentCostsHash) {
          staleStoreNames.push(`${st.name} (custos ou status de compra de produtos alterados após a conferência)`);
        }
      }
    }

    if (missingStoreNames.length > 0 || staleStoreNames.length > 0) {
      const parts: string[] = [];
      if (missingStoreNames.length > 0) {
        parts.push(`Lojas com conferência pendente: ${missingStoreNames.join(", ")}`);
      }
      if (staleStoreNames.length > 0) {
        parts.push(`Lojas com conferência desatualizada: ${staleStoreNames.join(", ")}`);
      }
      throw new AllocationValidationError(
        `Não é possível fechar o ciclo. ${parts.join(". ")}. Conclua a conferência de cortes e finalize todas as lojas antes de fechar o ciclo.`,
      );
    }

    // 2. Busca produtos marcados como comprados nos custos
    const purchasedRows = await tx<{ product_id: string; erp_code: number; name: string }[]>`
      SELECT
        c.product_id,
        p.erp_code,
        p.name
      FROM purchase_cycle_product_costs c
      JOIN products p ON p.id = c.product_id
      WHERE c.purchase_cycle_date = ${cycleDate}::date
        AND c.purchased = true
    `;

    // 3. Busca produtos com destinação positiva no ciclo
    const allocatedRows = await tx<{ product_id: string }[]>`
      SELECT DISTINCT product_id
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${cycleDate}::date
        AND destined_quantity > 0
    `;

    const allocatedSet = new Set(allocatedRows.map((r) => r.product_id));
    const missingProducts = purchasedRows.filter((p) => !allocatedSet.has(p.product_id));

    if (missingProducts.length > 0) {
      const missingList = missingProducts.map((p) => `[${p.erp_code}] ${p.name}`).slice(0, 5).join(", ");
      const extraCount = missingProducts.length > 5 ? ` e mais ${missingProducts.length - 5}` : "";
      throw new AllocationValidationError(
        `Não é possível fechar o ciclo. Existem ${missingProducts.length} produto(s) comprado(s) sem fornecedor/destinação atribuída: ${missingList}${extraCount}.`,
      );
    }

    // 3.1 Proteção Bug 03: Rejeita fechamento se houver produto com pedidos das lojas, não comprado nos custos, com destinação ativa
    // Utiliza a última revisão válida das lojas no ciclo (DISTINCT ON store_id)
    const invalidAllocatedRows = await tx<{ erp_code: number; name: string }[]>`
      WITH latest_orders AS (
        SELECT DISTINCT ON (store_id)
          id,
          store_id,
          cancelled_at
        FROM orders
        WHERE purchase_cycle_date = ${cycleDate}::date
        ORDER BY store_id, submitted_at DESC, revision DESC, id DESC
      ),
      valid_orders AS (
        SELECT id FROM latest_orders WHERE cancelled_at IS NULL
      )
      SELECT DISTINCT p.erp_code, p.name
      FROM purchase_cycle_product_allocations a
      JOIN products p ON p.id = a.product_id
      LEFT JOIN purchase_cycle_product_costs c
        ON c.purchase_cycle_date = a.purchase_cycle_date
       AND c.product_id = a.product_id
      WHERE a.purchase_cycle_date = ${cycleDate}::date
        AND a.destined_quantity > 0
        AND COALESCE(c.purchased, false) = false
        AND EXISTS (
          SELECT 1
          FROM order_items oi
          JOIN valid_orders vo ON vo.id = oi.order_id
          WHERE oi.product_id = a.product_id
            AND oi.quantity > 0
        )
    `;

    if (invalidAllocatedRows.length > 0) {
      const invalidList = invalidAllocatedRows.map((p) => `[${p.erp_code}] ${p.name}`).join(", ");
      throw new AllocationValidationError(
        `Não é possível fechar o ciclo. Há produto(s) com pedido das lojas não marcado(s) como comprado(s) nos custos que possuem destinação ativa: ${invalidList}. Zere a destinação ou marque como comprado nos custos.`,
      );
    }

    const closedAt = new Date().toISOString();

    await tx`
      INSERT INTO purchase_cycle_buyer_closures (
        purchase_cycle_date,
        status,
        closed_at,
        closed_by,
        total_purchased_products,
        total_allocated_products,
        version,
        created_at,
        updated_at
      )
      VALUES (
        ${cycleDate}::date,
        'CLOSED',
        ${closedAt}::timestamptz,
        ${principal.userId}::uuid,
        ${purchasedRows.length},
        ${allocatedSet.size},
        1,
        now(),
        now()
      )
      ON CONFLICT (purchase_cycle_date)
      DO UPDATE SET
        status = 'CLOSED',
        closed_at = ${closedAt}::timestamptz,
        closed_by = ${principal.userId}::uuid,
        total_purchased_products = ${purchasedRows.length},
        total_allocated_products = ${allocatedSet.size},
        version = purchase_cycle_buyer_closures.version + 1,
        updated_at = now()
    `;

    return {
      success: true,
      closedAt,
    };
  });
}

export async function reopenBuyerCycle(
  principal: Principal,
  cycleDate: string,
  reason: string,
): Promise<{ success: boolean; reopenedAt: string }> {
  assertPermission(principal, "compras:destinacao");

  if (!isCycleDate(cycleDate)) {
    throw new AllocationValidationError("Data de compra inválida.");
  }

  const trimmedReason = reason?.trim();
  if (!trimmedReason || trimmedReason.length < 5) {
    throw new AllocationValidationError("Justificativa de reabertura é obrigatória (mínimo de 5 caracteres).");
  }

  const sql = database().sql;

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${cycleDate}::text))`;

    const [existing] = await tx<{ status: string }[]>`
      SELECT status
      FROM purchase_cycle_buyer_closures
      WHERE purchase_cycle_date = ${cycleDate}::date
    `;

    if (!existing || existing.status !== "CLOSED") {
      throw new AllocationValidationError("O ciclo de compras não está fechado.");
    }

    const reopenedAt = new Date().toISOString();

    await tx`
      UPDATE purchase_cycle_buyer_closures
      SET
        status = 'OPEN',
        reopened_at = ${reopenedAt}::timestamptz,
        reopened_by = ${principal.userId}::uuid,
        reopen_reason = ${trimmedReason},
        version = version + 1,
        updated_at = now()
      WHERE purchase_cycle_date = ${cycleDate}::date
    `;

    return {
      success: true,
      reopenedAt,
    };
  });
}

export async function setProductSupplierDecision(
  principal: Principal,
  input: SetProductSupplierDecisionInput,
): Promise<{ success: boolean }> {
  assertPermission(principal, "compras:destinacao");

  if (!isCycleDate(input.cycleDate)) {
    throw new AllocationValidationError("Data de compra inválida.");
  }

  const sql = database().sql;

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${input.cycleDate}::text))`;

    // 1. Verifica ciclo fechado
    const [cycleClosure] = await tx<{ status: string }[]>`
      SELECT status FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${input.cycleDate}::date
    `;
    if (cycleClosure && cycleClosure.status === "CLOSED") {
      throw new CycleClosedError("O ciclo de compras está fechado. Reabra o ciclo para realizar alterações.");
    }

    // 2. Verifica se há destinação positiva já salva neste fornecedor
    const [existingAlloc] = await tx<{ destined_quantity: string }[]>`
      SELECT destined_quantity::text
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND supplier_id = ${input.supplierId}::uuid
        AND product_id = ${input.productId}::uuid
        AND store_id = ${input.storeId}::uuid
    `;

    if (existingAlloc && parseQuantity(existingAlloc.destined_quantity) > 0) {
      if (!input.confirmRemoveDestined) {
        throw new AllocationValidationError(
          `Este produto já possui quantidade destinada (${roundToTwoDecimals(existingAlloc.destined_quantity)}) salva neste fornecedor. Confirme a remoção para marcar como não comprado.`,
        );
      }

      // Remove destinação existente com auditoria
      await tx`
        DELETE FROM purchase_cycle_product_allocations
        WHERE purchase_cycle_date = ${input.cycleDate}::date
          AND supplier_id = ${input.supplierId}::uuid
          AND product_id = ${input.productId}::uuid
          AND store_id = ${input.storeId}::uuid
      `;

      await tx`
        INSERT INTO audit_events (
          actor_id,
          action,
          entity_type,
          entity_id,
          metadata,
          created_at
        ) VALUES (
          ${principal.userId}::uuid,
          'ALLOCATION_ZEROED',
          'allocation',
          ${input.productId},
          ${JSON.stringify({
            cycleDate: input.cycleDate,
            supplierId: input.supplierId,
            productId: input.productId,
            storeId: input.storeId,
            previousQuantity: existingAlloc.destined_quantity,
            newQuantity: "0.00",
            reason: "Marcado como não comprado deste fornecedor",
          })}::jsonb,
          now()
        )
      `;
    }

    // 3. Grava a decisão em purchase_cycle_product_supplier_decisions
    await tx`
      INSERT INTO purchase_cycle_product_supplier_decisions (
        purchase_cycle_date,
        supplier_id,
        product_id,
        store_id,
        decision,
        notes,
        created_by,
        updated_by,
        created_at,
        updated_at
      ) VALUES (
        ${input.cycleDate}::date,
        ${input.supplierId}::uuid,
        ${input.productId}::uuid,
        ${input.storeId}::uuid,
        ${input.decision},
        ${input.notes ?? null},
        ${principal.userId}::uuid,
        ${principal.userId}::uuid,
        now(),
        now()
      )
      ON CONFLICT (purchase_cycle_date, supplier_id, product_id, store_id)
      DO UPDATE SET
        decision = EXCLUDED.decision,
        notes = EXCLUDED.notes,
        updated_by = ${principal.userId}::uuid,
        updated_at = now()
    `;

    // 4. Registra evento de auditoria
    await tx`
      INSERT INTO audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
      ) VALUES (
        ${principal.userId}::uuid,
        'ALLOCATION_SUPPLIER_REJECTED',
        'product_supplier_decision',
        ${input.productId},
        ${JSON.stringify({
          cycleDate: input.cycleDate,
          supplierId: input.supplierId,
          productId: input.productId,
          storeId: input.storeId,
          decision: input.decision,
          notes: input.notes ?? null,
        })}::jsonb,
        now()
      )
    `;

    return { success: true };
  });
}

export async function revertProductSupplierDecision(
  principal: Principal,
  input: RevertProductSupplierDecisionInput,
): Promise<{ success: boolean }> {
  assertPermission(principal, "compras:destinacao");

  if (!isCycleDate(input.cycleDate)) {
    throw new AllocationValidationError("Data de compra inválida.");
  }

  const sql = database().sql;

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${input.cycleDate}::text))`;

    const [cycleClosure] = await tx<{ status: string }[]>`
      SELECT status FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${input.cycleDate}::date
    `;
    if (cycleClosure && cycleClosure.status === "CLOSED") {
      throw new CycleClosedError("O ciclo de compras está fechado. Reabra o ciclo para realizar alterações.");
    }

    await tx`
      DELETE FROM purchase_cycle_product_supplier_decisions
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND supplier_id = ${input.supplierId}::uuid
        AND product_id = ${input.productId}::uuid
        AND store_id = ${input.storeId}::uuid
    `;

    await tx`
      INSERT INTO audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
      ) VALUES (
        ${principal.userId}::uuid,
        'ALLOCATION_SUPPLIER_REVERTED',
        'product_supplier_decision',
        ${input.productId},
        ${JSON.stringify({
          cycleDate: input.cycleDate,
          supplierId: input.supplierId,
          productId: input.productId,
          storeId: input.storeId,
        })}::jsonb,
        now()
      )
    `;

    return { success: true };
  });
}

export async function concludeSupplierStoreReview(
  principal: Principal,
  input: ConcludeSupplierStoreReviewInput,
): Promise<{ success: boolean; affectedCount: number }> {
  assertPermission(principal, "compras:destinacao");

  if (!isCycleDate(input.cycleDate)) {
    throw new AllocationValidationError("Data de compra inválida.");
  }

  const sql = database().sql;

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${input.cycleDate}::text))`;

    const [cycleClosure] = await tx<{ status: string }[]>`
      SELECT status FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${input.cycleDate}::date
    `;
    if (cycleClosure && cycleClosure.status === "CLOSED") {
      throw new CycleClosedError("O ciclo de compras está fechado. Reabra o ciclo para realizar alterações.");
    }

    // 1. Usa a MESMA regra centralizada de elegibilidade da interface
    const eligibleSet = await getSupplierEligibleProductIds(tx, {
      cycleDate: input.cycleDate,
      supplierId: input.supplierId,
      storeId: input.storeId,
    });

    // 2. Busca alocações com destinação positiva existentes nesta loja
    const positiveAllocations = await tx<{ product_id: string }[]>`
      SELECT product_id
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND supplier_id = ${input.supplierId}::uuid
        AND store_id = ${input.storeId}::uuid
        AND destined_quantity > 0
    `;
    const positiveProductIds = new Set(positiveAllocations.map((a) => a.product_id));

    // 3. Busca decisões existentes nesta loja
    const existingDecisions = await tx<{ product_id: string }[]>`
      SELECT product_id
      FROM purchase_cycle_product_supplier_decisions
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND supplier_id = ${input.supplierId}::uuid
        AND store_id = ${input.storeId}::uuid
    `;
    const decidedProductIds = new Set(existingDecisions.map((d) => d.product_id));

    // 4. Produtos reais que precisam ser marcados como NOT_PURCHASED
    const actualPendingProductIds = [...eligibleSet]
      .filter((pid) => !positiveProductIds.has(pid) && !decidedProductIds.has(pid))
      .sort();

    // 5. Validação estrita de correspondência com a lista exibida e confirmada pelo comprador
    if (input.expectedProductIds !== undefined) {
      const expectedSorted = [...input.expectedProductIds].sort();
      const isExactMatch =
        actualPendingProductIds.length === expectedSorted.length &&
        actualPendingProductIds.every((pid, idx) => pid === expectedSorted[idx]);

      if (!isExactMatch) {
        throw new AllocationDestinationConflictError(
          "A lista de produtos a concluir foi alterada concorrentemente ou difere do estado persistido. Por favor, atualize a tela e revise a conferência antes de confirmar.",
        );
      }
    }

    // 6. Grava decisões 'NOT_PURCHASED' para exatamente os produtos confirmados
    for (const pid of actualPendingProductIds) {
      await tx`
        INSERT INTO purchase_cycle_product_supplier_decisions (
          purchase_cycle_date,
          supplier_id,
          product_id,
          store_id,
          decision,
          created_by,
          updated_by,
          created_at,
          updated_at
        ) VALUES (
          ${input.cycleDate}::date,
          ${input.supplierId}::uuid,
          ${pid}::uuid,
          ${input.storeId}::uuid,
          'NOT_PURCHASED',
          ${principal.userId}::uuid,
          ${principal.userId}::uuid,
          now(),
          now()
        )
        ON CONFLICT (purchase_cycle_date, supplier_id, product_id, store_id)
        DO UPDATE SET
          decision = 'NOT_PURCHASED',
          updated_by = ${principal.userId}::uuid,
          updated_at = now()
      `;
    }

    // 7. Atualiza status do review deste fornecedor para a loja
    await tx`
      INSERT INTO purchase_cycle_supplier_store_reviews (
        purchase_cycle_date,
        supplier_id,
        store_id,
        status,
        reviewed_at,
        reviewed_by,
        version,
        created_at,
        updated_at
      ) VALUES (
        ${input.cycleDate}::date,
        ${input.supplierId}::uuid,
        ${input.storeId}::uuid,
        'REVIEWED',
        now(),
        ${principal.userId}::uuid,
        1,
        now(),
        now()
      )
      ON CONFLICT (purchase_cycle_date, supplier_id, store_id)
      DO UPDATE SET
        status = 'REVIEWED',
        reviewed_at = now(),
        reviewed_by = ${principal.userId}::uuid,
        version = purchase_cycle_supplier_store_reviews.version + 1,
        updated_at = now()
    `;

    // 8. Evento de auditoria
    await tx`
      INSERT INTO audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
      ) VALUES (
        ${principal.userId}::uuid,
        'SUPPLIER_STORE_BATCH_CONCLUDED',
        'supplier_store_review',
        ${input.supplierId},
        ${JSON.stringify({
          cycleDate: input.cycleDate,
          supplierId: input.supplierId,
          storeId: input.storeId,
          markedCount: actualPendingProductIds.length,
          productIds: actualPendingProductIds,
        })}::jsonb,
        now()
      )
    `;

    return { success: true, affectedCount: actualPendingProductIds.length };
  });
}

export async function closeStoreCycle(
  principal: Principal,
  input: CloseStoreCycleInput,
): Promise<{
  success: boolean;
  cuts: StoreCutItem[];
  totalCutItems: number;
  version: number;
  isCurrent: boolean;
  status: "CLOSED";
}> {
  assertPermission(principal, "compras:destinacao");

  if (!isCycleDate(input.cycleDate)) {
    throw new AllocationValidationError("Data de compra inválida.");
  }

  const sql = database().sql;

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${input.cycleDate}::text))`;

    const [cycleClosure] = await tx<{ status: string }[]>`
      SELECT status FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${input.cycleDate}::date
    `;
    if (cycleClosure && cycleClosure.status === "CLOSED") {
      throw new CycleClosedError("O ciclo de compras está fechado. Reabra o ciclo para realizar alterações.");
    }

    // 1. Busca último pedido válido da loja
    const [activeOrder] = await tx<{ id: string; revision: number }[]>`
      SELECT id, revision
      FROM orders
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND store_id = ${input.storeId}::uuid
        AND cancelled_at IS NULL
      ORDER BY submitted_at DESC, revision DESC, id DESC
      LIMIT 1
    `;

    // 2. Busca itens do pedido da loja
    const orderItems = activeOrder
      ? await tx<{ product_id: string; erp_code: number; name: string; purchase_format: string; quantity: string }[]>`
          SELECT oi.product_id, p.erp_code, p.name, p.purchase_format, oi.quantity::text
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = ${activeOrder.id}::uuid
            AND oi.quantity > 0
          ORDER BY p.name ASC
        `
      : [];

    // 3. Busca todas as destinações da loja somando todos os fornecedores
    const storeAllocations = await tx<{ product_id: string; supplier_id: string; destined_quantity: string }[]>`
      SELECT product_id, supplier_id, destined_quantity::text
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND store_id = ${input.storeId}::uuid
        AND destined_quantity > 0
    `;

    const storeAllocationsByProduct = new Map<string, string>();
    for (const a of storeAllocations) {
      const current = parseQuantity(storeAllocationsByProduct.get(a.product_id) ?? "0");
      storeAllocationsByProduct.set(a.product_id, roundToTwoDecimals(current + parseQuantity(a.destined_quantity)));
    }

    // 4. Calcula o resumo dos cortes conjunto
    const extraAllocProductIds = [...storeAllocationsByProduct.keys()].filter(
      (pid) => !orderItems.some((oi) => oi.product_id === pid),
    );
    const extraProducts = extraAllocProductIds.length > 0
      ? await tx<{ id: string; erp_code: number; name: string; purchase_format: string }[]>`
          SELECT id, erp_code, name, purchase_format
          FROM products
          WHERE id IN ${tx(extraAllocProductIds)}
        `
      : [];
    const cutCatalogMap = new Map<string, { erpCode: number; name: string; purchaseFormat: string }>();
    for (const ep of extraProducts) {
      cutCatalogMap.set(ep.id, { erpCode: ep.erp_code, name: ep.name, purchaseFormat: ep.purchase_format });
    }

    const { cuts, totalOrderedItems, totalDestinedItems, totalCutItems } = calculateStoreCutSummary({
      orderedItems: orderItems.map((oi) => ({
        productId: oi.product_id,
        erpCode: oi.erp_code,
        productName: oi.name,
        purchaseFormat: oi.purchase_format,
        orderedQuantity: oi.quantity,
      })),
      storeAllocationsByProduct,
      catalogMap: cutCatalogMap,
    });

    // 5. Calcula os fingerprints imutáveis de destinações e custos da loja
    const allocationsHash = computeStoreAllocationsHash(
      storeAllocations.map((a) => ({
        productId: a.product_id,
        supplierId: a.supplier_id,
        destinedQuantity: a.destined_quantity,
      })),
    );

    const relevantProductIds = new Set([
      ...orderItems.map((oi) => oi.product_id),
      ...storeAllocations.map((a) => a.product_id),
    ]);

    const storeCostRows = relevantProductIds.size > 0
      ? await tx<{
          product_id: string;
          purchased: boolean;
          cost: string | null;
          cost_is_unit: boolean | null;
          version: number | null;
        }[]>`
          SELECT product_id, purchased, cost::text, cost_is_unit, version
          FROM purchase_cycle_product_costs
          WHERE purchase_cycle_date = ${input.cycleDate}::date
            AND product_id IN ${tx([...relevantProductIds])}
        `
      : [];

    const currentCostsHash = computeStoreCostsHash(
      [...relevantProductIds].map((pid) => {
        const c = storeCostRows.find((row) => row.product_id === pid);
        return {
          productId: pid,
          purchased: c?.purchased ?? false,
          cost: c?.cost ?? null,
          costIsUnit: c?.cost_is_unit ?? false,
          version: c?.version ?? 0,
        };
      }),
    );

    // 6. Proteção de concorrência otimista: valida se o resumo exibido ao comprador ainda é o mesmo
    const currentOrderId = activeOrder?.id ?? null;
    const currentOrderRevision = activeOrder?.revision ?? null;

    if (input.expectedOrderId === undefined || input.expectedOrderId !== currentOrderId) {
      throw new AllocationDestinationConflictError(
        `O pedido da loja foi alterado ou cancelado concorrentemente (esperado: ${input.expectedOrderId ?? "nenhum"}, atual: ${currentOrderId ?? "nenhum"}). Por favor, confira o novo resumo de cortes antes de finalizar a loja.`,
      );
    }

    if (input.expectedOrderRevision === undefined || input.expectedOrderRevision !== currentOrderRevision) {
      throw new AllocationDestinationConflictError(
        `A revisão do pedido da loja foi alterada concorrentemente (esperado: ${input.expectedOrderRevision ?? "nenhum"}, atual: ${currentOrderRevision ?? "nenhum"}). Por favor, confira o novo resumo de cortes antes de finalizar a loja.`,
      );
    }

    if (!input.expectedAllocationsHash || allocationsHash !== input.expectedAllocationsHash) {
      throw new AllocationDestinationConflictError(
        "As destinações da loja foram alteradas concorrentemente após a abertura da conferência. Por favor, confira o novo resumo de cortes antes de finalizar a loja.",
      );
    }

    if (!input.expectedCostsHash || currentCostsHash !== input.expectedCostsHash) {
      throw new AllocationDestinationConflictError(
        "Os custos ou status de compra de produtos da loja foram alterados concorrentemente após a abertura da conferência. Por favor, confira o novo resumo de cortes antes de finalizar a loja.",
      );
    }

    const orderHash = activeOrder ? `${activeOrder.id}:r${activeOrder.revision}` : null;
    const closedAt = new Date().toISOString();

    // 7. Modelo append-only: calcula a próxima versão e desativa a versão anterior como is_current
    const [verRow] = await tx<{ next_version: number }[]>`
      SELECT COALESCE(MAX(version), 0) + 1 AS next_version
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND store_id = ${input.storeId}::uuid
    `;
    const nextVersion = verRow.next_version;

    await tx`
      UPDATE purchase_cycle_store_closures
      SET is_current = false
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND store_id = ${input.storeId}::uuid
        AND is_current = true
    `;

    await tx`
      INSERT INTO purchase_cycle_store_closures (
        purchase_cycle_date,
        store_id,
        order_id,
        order_revision,
        status,
        total_ordered_items,
        total_destined_items,
        total_cut_items,
        cut_summary,
        allocations_hash,
        order_hash,
        costs_hash,
        closed_at,
        closed_by,
        version,
        is_current,
        created_at,
        updated_at
      ) VALUES (
        ${input.cycleDate}::date,
        ${input.storeId}::uuid,
        ${activeOrder ? activeOrder.id : null}::uuid,
        ${activeOrder ? activeOrder.revision : null},
        'CLOSED',
        ${totalOrderedItems},
        ${totalDestinedItems},
        ${totalCutItems},
        ${JSON.stringify(cuts)}::jsonb,
        ${allocationsHash},
        ${orderHash},
        ${currentCostsHash},
        ${closedAt}::timestamptz,
        ${principal.userId}::uuid,
        ${nextVersion},
        true,
        now(),
        now()
      )
    `;

    // 8. Auditoria
    await tx`
      INSERT INTO audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
      ) VALUES (
        ${principal.userId}::uuid,
        'STORE_CYCLE_CLOSED',
        'store_closure',
        ${input.storeId},
        ${JSON.stringify({
          cycleDate: input.cycleDate,
          storeId: input.storeId,
          orderId: activeOrder?.id ?? null,
          orderRevision: activeOrder?.revision ?? null,
          version: nextVersion,
          totalOrderedItems,
          totalDestinedItems,
          totalCutItems,
          allocationsHash,
          costsHash: currentCostsHash,
        })}::jsonb,
        now()
      )
    `;

    return {
      success: true,
      cuts,
      totalCutItems,
      version: nextVersion,
      isCurrent: true,
      status: "CLOSED",
    };
  });
}

export async function reopenStoreCycle(
  principal: Principal,
  input: ReopenStoreCycleInput,
): Promise<{ success: boolean; reopenedAt: string }> {
  assertPermission(principal, "compras:destinacao");

  if (!isCycleDate(input.cycleDate)) {
    throw new AllocationValidationError("Data de compra inválida.");
  }

  const trimmedReason = input.reason?.trim();
  if (!trimmedReason || trimmedReason.length < 5) {
    throw new AllocationValidationError("Justificativa de reabertura é obrigatória (mínimo de 5 caracteres).");
  }

  const sql = database().sql;

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${input.cycleDate}::text))`;

    const [cycleClosure] = await tx<{ status: string }[]>`
      SELECT status FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${input.cycleDate}::date
    `;
    if (cycleClosure && cycleClosure.status === "CLOSED") {
      throw new CycleClosedError("O ciclo geral de compras está fechado. Reabra o ciclo geral antes de alterar a loja.");
    }

    const [existing] = await tx<{
      id: string;
      status: string;
      version: number;
      order_id: string | null;
      order_revision: number | null;
      total_ordered_items: number;
      total_destined_items: number;
      total_cut_items: number;
      cut_summary: unknown;
      allocations_hash: string;
      order_hash: string | null;
      costs_hash: string | null;
      closed_at: string;
      closed_by: string;
    }[]>`
      SELECT
        id, status, version, order_id, order_revision,
        total_ordered_items, total_destined_items, total_cut_items,
        cut_summary, allocations_hash, order_hash, costs_hash,
        closed_at::text, closed_by
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND store_id = ${input.storeId}::uuid
        AND is_current = true
    `;

    if (!existing || existing.status !== "CLOSED") {
      throw new AllocationValidationError("A conferência da loja não está finalizada para ser reaberta.");
    }

    const reopenedAt = new Date().toISOString();

    // 1. Marca a versão anterior (fechamento) como is_current = false SEM ALTERAR seus dados históricos (status permanece 'CLOSED' e campos intactos)
    await tx`
      UPDATE purchase_cycle_store_closures
      SET is_current = false
      WHERE id = ${existing.id}::uuid
    `;

    // 2. Insere a nova versão representando o estado de reabertura (append-only)
    const nextVersion = existing.version + 1;
    await tx`
      INSERT INTO purchase_cycle_store_closures (
        purchase_cycle_date,
        store_id,
        order_id,
        order_revision,
        status,
        total_ordered_items,
        total_destined_items,
        total_cut_items,
        cut_summary,
        allocations_hash,
        order_hash,
        costs_hash,
        closed_at,
        closed_by,
        reopened_at,
        reopened_by,
        reopen_reason,
        version,
        is_current,
        created_at,
        updated_at
      ) VALUES (
        ${input.cycleDate}::date,
        ${input.storeId}::uuid,
        ${existing.order_id ? existing.order_id : null}::uuid,
        ${existing.order_revision},
        'REOPENED',
        ${existing.total_ordered_items},
        ${existing.total_destined_items},
        ${existing.total_cut_items},
        ${JSON.stringify(existing.cut_summary)}::jsonb,
        ${existing.allocations_hash},
        ${existing.order_hash},
        ${existing.costs_hash},
        ${existing.closed_at}::timestamptz,
        ${existing.closed_by}::uuid,
        ${reopenedAt}::timestamptz,
        ${principal.userId}::uuid,
        ${trimmedReason},
        ${nextVersion},
        true,
        now(),
        now()
      )
    `;

    await tx`
      INSERT INTO audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
      ) VALUES (
        ${principal.userId}::uuid,
        'STORE_CYCLE_REOPENED',
        'store_closure',
        ${input.storeId},
        ${JSON.stringify({
          cycleDate: input.cycleDate,
          storeId: input.storeId,
          reopenedFromVersion: existing.version,
          newVersion: nextVersion,
          version: nextVersion,
          reason: trimmedReason,
        })}::jsonb,
        now()
      )
    `;

    return {
      success: true,
      reopenedAt,
    };
  });
}
