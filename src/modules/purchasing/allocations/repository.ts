import { database } from "@/db/client";
import { assertPermission, type Principal } from "@/modules/identity";
import {
  AllocationDestinationConflictError,
  AllocationValidationError,
  CycleClosedError,
  ExclusivityViolationError,
  calculateDifference,
  calculateStoreCutSummary,
  computeStoreAllocationsHash,
  isCycleDate,
  parseQuantity,
  roundToTwoDecimals,
  sumQuantities,
  validateAllocationPurchasedStatus,
  validateClosureReadiness,
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

const BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE = 424242;

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

  // 3. Busca lojas ativas
  const storeRows = await sql<{ id: string; slug: string; name: string }[]>`
    SELECT id, slug, name
    FROM stores
    WHERE active = true
    ORDER BY CASE slug
      WHEN 'ponta-da-fruta' THEN 1
      WHEN 'balneario' THEN 2
      WHEN 'santa-monica' THEN 3
      ELSE 4
    END, name ASC
  `;

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
      purchased: boolean;
    }[]
  >`
    SELECT
      product_id,
      cost::text,
      purchased
    FROM purchase_cycle_product_costs
    WHERE purchase_cycle_date = ${cycleDate}::date
  `;

  const costMap = new Map<string, { cost: string | null; purchased: boolean }>();
  const purchasedProductIds: string[] = [];

  for (const c of costRows) {
    costMap.set(c.product_id, { cost: c.cost, purchased: c.purchased });
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

  // 6.3 Conferência conjunta dos cortes e finalizações de loja
  const storeClosureRows = await sql<
    {
      store_id: string;
      order_id: string | null;
      order_revision: number | null;
      status: string;
      total_ordered_items: number;
      total_destined_items: number;
      total_cut_items: number;
      cut_summary: any;
      allocations_hash: string;
      order_hash: string | null;
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
      sc.closed_at::text,
      u_closed.name AS closed_by_name,
      sc.reopened_at::text,
      u_reopened.name AS reopened_by_name,
      sc.reopen_reason
    FROM purchase_cycle_store_closures sc
    LEFT JOIN users u_closed ON u_closed.id = sc.closed_by
    LEFT JOIN users u_reopened ON u_reopened.id = sc.reopened_by
    WHERE sc.purchase_cycle_date = ${cycleDate}::date
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
      }
    }

    const closureStatus = scRaw?.status === "CLOSED" ? "CLOSED" : "OPEN";

    // Produtos pedidos por esta loja
    const orderedProductIdsForStore = new Set<string>();
    for (const item of orderItemRows) {
      if (item.store_id === store.id && parseQuantity(item.quantity) > 0) {
        orderedProductIdsForStore.add(item.product_id);
      }
    }

    // Produtos da loja que possuem destinação positiva somada de fornecedores
    const destinedProductIdsForStore = new Set(storeAllocations.map((a) => a.product_id));

    // Produtos da loja que foram decididos como NOT_PURCHASED em algum fornecedor
    const notPurchasedProductIdsForStore = new Set<string>();
    for (const d of decisionRows) {
      if (d.store_id === store.id && d.decision === "NOT_PURCHASED") {
        notPurchasedProductIdsForStore.add(d.product_id);
      }
    }

    // Produtos que já têm conferência (destinação positiva OU decisão de não comprado)
    const reviewedProductIds = new Set([
      ...destinedProductIdsForStore,
      ...notPurchasedProductIdsForStore,
    ]);

    // Pendentes são os produtos pedidos que não têm nem destinação nem decisão em nenhum fornecedor
    let pendingCount = 0;
    for (const pid of orderedProductIdsForStore) {
      if (!reviewedProductIds.has(pid)) {
        pendingCount++;
      }
    }

    let cutsArray: StoreCutItem[] = [];
    if (scRaw && scRaw.status === "CLOSED" && !isStale && Array.isArray(scRaw.cut_summary)) {
      cutsArray = scRaw.cut_summary;
    } else {
      // Itens pedidos pela loja
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

      const storeAllocationsByProduct = new Map<string, string>();
      for (const a of storeAllocations) {
        const cur = parseQuantity(storeAllocationsByProduct.get(a.product_id) ?? "0");
        storeAllocationsByProduct.set(a.product_id, roundToTwoDecimals(cur + parseQuantity(a.destined_quantity)));
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

    storeClosures[store.id] = {
      cycleDate,
      storeId: store.id,
      storeName: store.name,
      status: closureStatus,
      orderId: scRaw?.order_id ?? activeOrder?.order_id ?? null,
      orderRevision: scRaw?.order_revision ?? activeOrder?.revision ?? null,
      totalOrderedItems: scRaw?.total_ordered_items ?? orderedProductIdsForStore.size,
      totalDestinedItems: scRaw?.total_destined_items ?? destinedProductIdsForStore.size,
      totalCutItems: scRaw?.total_cut_items ?? cutsArray.filter((c) => c.status === "PARTIAL_CUT" || c.status === "TOTAL_CUT").length,
      cuts: cutsArray,
      allocationsHash: scRaw?.allocations_hash ?? currentAllocationsHash,
      closedAt: scRaw?.closed_at ?? null,
      closedByName: scRaw?.closed_by_name ?? null,
      reopenedAt: scRaw?.reopened_at ?? null,
      reopenedByName: scRaw?.reopened_by_name ?? null,
      reopenReason: scRaw?.reopen_reason ?? null,
      isStale,
      staleReason,
    };

    storeSummary[store.id] = {
      storeId: store.id,
      storeName: store.name,
      storeSlug: store.slug,
      totalAllocatedProducts: destinedProductIdsForStore.size,
      totalDestinedQuantity: sumQuantities(storeAllocations.map((a) => a.destined_quantity)),
      totalOrderedProducts: orderedProductIdsForStore.size,
      totalReviewedProducts: reviewedProductIds.size,
      totalPendingProducts: pendingCount,
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
      // Busca vínculos de produtos deste fornecedor
      const supplierProductLinks = await sql<{ product_id: string }[]>`
        SELECT product_id
        FROM product_suppliers
        WHERE supplier_id = ${resolvedSupplierId}::uuid
          AND active = true
      `;
      const linkedProductIds = new Set(supplierProductLinks.map((l) => l.product_id));

      // Determina quais produtos devem aparecer para este fornecedor:
      // 1. Produtos que já possuem alocações para este fornecedor neste ciclo (permite ver/corrigir/zerar)
      // 2. Produtos vinculados a este fornecedor SOMENTE se comprados nos custos (Regra A)
      // 3. Se for a JEB, produtos legados com exclusive_supplier = true SOMENTE se comprados nos custos (Regra A)
      const targetProductIds = new Set<string>();

      for (const alloc of allocationRows) {
        if (alloc.supplier_id === resolvedSupplierId) {
          const costInfo = costMap.get(alloc.product_id);
          // Se for comprado nos custos, mantém na lista.
          // Se NÃO for comprado nos custos, só mantém se ainda tiver destinação positiva (para permitir visualizar e zerar)
          if (costInfo?.purchased || parseQuantity(alloc.destined_quantity) > 0) {
            targetProductIds.add(alloc.product_id);
          }
        }
      }

      for (const pid of linkedProductIds) {
        const costInfo = costMap.get(pid);
        if (costInfo?.purchased) {
          targetProductIds.add(pid);
        }
      }

      for (const d of decisionRows) {
        if (d.supplier_id === resolvedSupplierId) {
          targetProductIds.add(d.product_id);
        }
      }

      const isSelectedJeb =
        supplierRow.tax_id === "48336863000160" ||
        supplierRow.corporate_name.toUpperCase().includes("JEB DISTRIBUIDORA");

      if (isSelectedJeb) {
        for (const prod of allCatalogProducts) {
          if (prod.legacy_exclusive) {
            const costInfo = costMap.get(prod.id);
            if (costInfo?.purchased) {
              targetProductIds.add(prod.id);
            }
          }
        }
      }

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
            // Se não há alocação salva ainda para esta loja:
            // Se o produto foi comprado ou pedido, sugere a quantidade do pedido original
            destinedQty = parseQuantity(orderQty) > 0 ? roundToTwoDecimals(orderQty) : "0.00";
            isAdditional = parseQuantity(orderQty) === 0;
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

      // Regra de exclusividade:
      // Se produto é exclusivo de outro fornecedor, rejeitar
      const isJeb =
        supplier.tax_id === "48336863000160" ||
        supplier.corporate_name.toUpperCase().includes("JEB DISTRIBUIDORA");

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

      const targetStores = input.storeId
        ? productInput.stores.filter((s) => s.storeId === input.storeId)
        : productInput.stores;

      // Total destinado nesta requisição para este produto
      const totalDestinedInRequest = targetStores.reduce(
        (sum, s) => sum + parseQuantity(s.destinedQuantity),
        0
      );

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

        if (destinedNum > 0 || originalOrderNum > 0) {
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

    // 1.1 Validação Store-First: TODAS as lojas ativas precisam ter conferência válida em purchase_cycle_store_closures
    const allActiveStores = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM stores WHERE active = true ORDER BY name ASC
    `;

    const storeClosureRows = await tx<{
      store_id: string;
      order_id: string | null;
      order_revision: number | null;
      status: string;
      allocations_hash: string;
    }[]>`
      SELECT store_id, order_id, order_revision, status, allocations_hash
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${cycleDate}::date
    `;
    const storeClosuresMap = new Map(storeClosureRows.map((r) => [r.store_id, r]));

    const missingStoreNames: string[] = [];
    const staleStoreNames: string[] = [];

    for (const st of allActiveStores) {
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

    // Busca produtos elegíveis para este fornecedor que foram comprados nos custos OU já têm alocação
    const eligibleProductRows = await tx<{ product_id: string }[]>`
      SELECT DISTINCT p.id AS product_id
      FROM products p
      JOIN purchase_cycle_product_costs c ON c.product_id = p.id AND c.purchase_cycle_date = ${input.cycleDate}::date
      LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.supplier_id = ${input.supplierId}::uuid AND ps.active = true
      WHERE c.purchased = true
        AND (ps.id IS NOT NULL OR p.exclusive_supplier = true)
    `;

    // Busca decisões existentes para não sobrescrever
    const existingDecisions = await tx<{ product_id: string }[]>`
      SELECT product_id
      FROM purchase_cycle_product_supplier_decisions
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND supplier_id = ${input.supplierId}::uuid
        AND store_id = ${input.storeId}::uuid
    `;
    const decidedProductIds = new Set(existingDecisions.map((d) => d.product_id));

    // Busca alocações com destined_quantity > 0 existentes para não sobrescrever
    const positiveAllocations = await tx<{ product_id: string }[]>`
      SELECT product_id
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND supplier_id = ${input.supplierId}::uuid
        AND store_id = ${input.storeId}::uuid
        AND destined_quantity > 0
    `;
    const positiveProductIds = new Set(positiveAllocations.map((a) => a.product_id));

    // Produtos a marcar como NOT_PURCHASED
    const toMarkNotPurchased = eligibleProductRows
      .map((r) => r.product_id)
      .filter((pid) => !decidedProductIds.has(pid) && !positiveProductIds.has(pid));

    for (const pid of toMarkNotPurchased) {
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

    // Atualiza status do review deste fornecedor para a loja
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

    // Auditoria
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
          markedCount: toMarkNotPurchased.length,
        })}::jsonb,
        now()
      )
    `;

    return { success: true, affectedCount: toMarkNotPurchased.length };
  });
}

export async function closeStoreCycle(
  principal: Principal,
  input: CloseStoreCycleInput,
): Promise<{ success: boolean; cuts: StoreCutItem[]; totalCutItems: number }> {
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

    // 5. Calcula o hash imutável das alocações da loja
    const allocationsHash = computeStoreAllocationsHash(
      storeAllocations.map((a) => ({
        productId: a.product_id,
        supplierId: a.supplier_id,
        destinedQuantity: a.destined_quantity,
      })),
    );
    const orderHash = activeOrder ? `${activeOrder.id}:r${activeOrder.revision}` : null;
    const closedAt = new Date().toISOString();

    // 6. Insere ou atualiza em purchase_cycle_store_closures
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
        closed_at,
        closed_by,
        version,
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
        ${closedAt}::timestamptz,
        ${principal.userId}::uuid,
        1,
        now(),
        now()
      )
      ON CONFLICT (purchase_cycle_date, store_id)
      DO UPDATE SET
        status = 'CLOSED',
        order_id = EXCLUDED.order_id,
        order_revision = EXCLUDED.order_revision,
        total_ordered_items = EXCLUDED.total_ordered_items,
        total_destined_items = EXCLUDED.total_destined_items,
        total_cut_items = EXCLUDED.total_cut_items,
        cut_summary = EXCLUDED.cut_summary,
        allocations_hash = EXCLUDED.allocations_hash,
        order_hash = EXCLUDED.order_hash,
        closed_at = ${closedAt}::timestamptz,
        closed_by = ${principal.userId}::uuid,
        version = purchase_cycle_store_closures.version + 1,
        updated_at = now()
    `;

    // 7. Auditoria
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
          totalOrderedItems,
          totalDestinedItems,
          totalCutItems,
          allocationsHash,
        })}::jsonb,
        now()
      )
    `;

    return {
      success: true,
      cuts,
      totalCutItems,
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

    const [existing] = await tx<{ status: string }[]>`
      SELECT status
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${input.cycleDate}::date
        AND store_id = ${input.storeId}::uuid
    `;

    if (!existing || existing.status !== "CLOSED") {
      throw new AllocationValidationError("A conferência da loja não está finalizada.");
    }

    const reopenedAt = new Date().toISOString();

    await tx`
      UPDATE purchase_cycle_store_closures
      SET
        status = 'OPEN',
        reopened_at = ${reopenedAt}::timestamptz,
        reopened_by = ${principal.userId}::uuid,
        reopen_reason = ${trimmedReason},
        version = version + 1,
        updated_at = now()
      WHERE purchase_cycle_date = ${input.cycleDate}::date
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
        'STORE_CYCLE_REOPENED',
        'store_closure',
        ${input.storeId},
        ${JSON.stringify({
          cycleDate: input.cycleDate,
          storeId: input.storeId,
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
