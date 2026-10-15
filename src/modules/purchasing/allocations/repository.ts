import { database } from "@/db/client";
import { assertPermission, type Principal } from "@/modules/identity";
import {
  AllocationValidationError,
  CycleClosedError,
  ExclusivityViolationError,
  calculateDifference,
  isCycleDate,
  parseQuantity,
  roundToTwoDecimals,
  sumQuantities,
  validateClosureReadiness,
  type BuyerAllocationWorkspaceData,
  type BuyerCycleClosureSummary,
  type CatalogSearchItem,
  type ProductAllocationItem,
  type SaveSupplierAllocationsInput,
  type StoreAllocationData,
  type StoreInfo,
  type SupplierDestinationData,
  type SupplierSummaryOption,
} from "./domain";

const ALLOCATIONS_ADVISORY_LOCK_ID = 42424203;
const BUYER_CLOSURE_ADVISORY_LOCK_ID = 42424204;

export async function readBuyerAllocationWorkspace(
  principal: Principal,
  requestedCycle?: string,
  selectedSupplierId?: string | null,
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

  // 4. Busca pedidos válidos mais recentes das lojas para o ciclo
  const orderRows = await sql<
    {
      store_id: string;
      order_id: string;
    }[]
  >`
    WITH latest_orders AS (
      SELECT DISTINCT ON (store_id)
        id,
        store_id,
        cancelled_at
      FROM orders
      WHERE purchase_cycle_date = ${cycleDate}::date
      ORDER BY store_id, submitted_at DESC, revision DESC, id DESC
    )
    SELECT store_id, id AS order_id
    FROM latest_orders
    WHERE cancelled_at IS NULL
  `;

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

  const storeOrderQuantityMap = new Map<string, string>(); // key: `${storeId}:${productId}`
  const orderedProductIds = new Set<string>();

  for (const item of orderItemRows) {
    storeOrderQuantityMap.set(`${item.store_id}:${item.product_id}`, item.quantity);
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
    }
  }

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
    return {
      id: s.id,
      corporateName: s.corporate_name,
      tradeName: s.trade_name,
      taxId: s.tax_id,
      active: s.active,
      hasAllocationsInCycle: hasAllocations,
      totalDestinedQuantity,
    };
  });

  // 8. Busca parâmetros de conversão e produtos
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

    if (prod.active) {
      catalogSearchList.push({
        id: prod.id,
        erpCode: prod.erp_code,
        name: prod.name,
        purchaseFormat: prod.purchase_format,
        isExclusive,
        exclusiveSupplierId,
        exclusiveSupplierName,
      });
    }
  }

  catalogSearchList.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));

  // 9. Identifica produtos comprados que não foram alocados
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

  // 10. Se um fornecedor específico foi selecionado, constrói a visão de destinação dele
  let destinationData: SupplierDestinationData | null = null;

  if (selectedSupplierId) {
    const supplierRow = allSuppliers.find((s) => s.id === selectedSupplierId);
    if (!supplierRow) {
      throw new AllocationValidationError("Fornecedor selecionado não encontrado.");
    }

    // Busca vínculos de produtos deste fornecedor
    const supplierProductLinks = await sql<{ product_id: string }[]>`
      SELECT product_id
      FROM product_suppliers
      WHERE supplier_id = ${selectedSupplierId}::uuid
        AND active = true
    `;
    const linkedProductIds = new Set(supplierProductLinks.map((l) => l.product_id));

    // Determina quais produtos devem aparecer para este fornecedor:
    // 1. Produtos que já possuem alocações para este fornecedor neste ciclo
    // 2. Produtos vinculados a este fornecedor
    // 3. Se for a JEB, produtos legados com exclusive_supplier = true
    const targetProductIds = new Set<string>();

    for (const alloc of allocationRows) {
      if (alloc.supplier_id === selectedSupplierId) {
        targetProductIds.add(alloc.product_id);
      }
    }

    for (const pid of linkedProductIds) {
      targetProductIds.add(pid);
    }

    const isSelectedJeb =
      supplierRow.tax_id === "48336863000160" ||
      supplierRow.corporate_name.toUpperCase().includes("JEB DISTRIBUIDORA");

    if (isSelectedJeb) {
      for (const prod of allCatalogProducts) {
        if (prod.legacy_exclusive) {
          targetProductIds.add(prod.id);
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

      const existingSupplierAllocs = allocationsBySupplierAndProduct.get(`${selectedSupplierId}:${pid}`) ?? [];
      const allocByStore = new Map(existingSupplierAllocs.map((a) => [a.store_id, a]));

      const storeAllocations: Record<string, StoreAllocationData> = {};
      const orderedQtyList: string[] = [];
      const destinedQtyList: string[] = [];
      let itemVersion = 1;
      let itemNotes: string | null = null;

      for (const store of stores) {
        const orderQty = storeOrderQuantityMap.get(`${store.id}:${pid}`) ?? "0.00";
        const alloc = allocByStore.get(store.id);

        let destinedQty: string;
        let isAdditional = false;

        if (alloc) {
          destinedQty = alloc.destined_quantity;
          isAdditional = alloc.is_additional_purchase;
          if (alloc.version > itemVersion) itemVersion = alloc.version;
          if (alloc.notes) itemNotes = alloc.notes;
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

  // Validação para o fechamento
  const simpleCatalogMap = new Map<string, { id: string; erpCode: number; name: string }>();
  for (const prod of allCatalogProducts) {
    simpleCatalogMap.set(prod.id, {
      id: prod.id,
      erpCode: prod.erp_code,
      name: prod.name,
    });
  }

  const { canClose, missingProducts } = validateClosureReadiness(
    purchasedProductIds,
    globallyAllocatedProductIds,
    simpleCatalogMap,
  );

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
    canClose,
  };

  return {
    cycleDate,
    cycles,
    selectedSupplierId: selectedSupplierId ?? null,
    closure,
    suppliers: supplierOptions,
    stores,
    destinationData,
    unassignedPurchasedProducts,
    catalogSearchList,
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
    // 1. Lock transacional para evitar concorrência no ciclo
    await tx`SELECT pg_advisory_xact_lock(${ALLOCATIONS_ADVISORY_LOCK_ID})`;

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

    // 5. Itera sobre os produtos para validações de exclusividade e gravação
    let affectedCount = 0;

    for (const productInput of input.allocations) {
      // Verifica integridade do produto e exclusividade
      const [prodRow] = await tx<
        {
          id: string;
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

      let productHadValidDestination = false;

      for (const storeInput of productInput.stores) {
        const destinedNum = parseQuantity(storeInput.destinedQuantity);
        const originalOrderStr = storeOriginalOrderMap.get(`${storeInput.storeId}:${prodRow.id}`) ?? "0";
        const originalOrderNum = parseQuantity(originalOrderStr);

        const isAdditional = originalOrderNum === 0 && destinedNum > 0;

        if (destinedNum > 0 || originalOrderNum > 0) {
          productHadValidDestination = true;

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
              ${storeInput.notes ?? productInput.notes ?? null},
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
        } else {
          // Se ambas as quantidades são 0, limpa alocação desnecessária
          await tx`
            DELETE FROM purchase_cycle_product_allocations
            WHERE purchase_cycle_date = ${input.cycleDate}::date
              AND supplier_id = ${input.supplierId}::uuid
              AND product_id = ${prodRow.id}::uuid
              AND store_id = ${storeInput.storeId}::uuid
          `;
        }
      }

      if (productHadValidDestination) {
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
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CLOSURE_ADVISORY_LOCK_ID})`;

    // 1. Verifica estado atual
    const [existing] = await tx<{ status: string }[]>`
      SELECT status
      FROM purchase_cycle_buyer_closures
      WHERE purchase_cycle_date = ${cycleDate}::date
    `;

    if (existing && existing.status === "CLOSED") {
      throw new AllocationValidationError("O ciclo de compras já está fechado.");
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
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CLOSURE_ADVISORY_LOCK_ID})`;

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
