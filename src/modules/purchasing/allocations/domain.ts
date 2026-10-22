import { hasPermission, type Principal } from "@/modules/identity";

export class AllocationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationValidationError";
  }
}

export class ExclusivityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExclusivityViolationError";
  }
}

export class CycleClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleClosedError";
  }
}

export type AllocationConflictResolution = "TRANSFER" | "SPLIT_CONFIRMED";

export type AllocationConflictSupplier = {
  supplierId: string;
  supplierName: string;
  destinedQuantity: string;
  isTargetSupplier: boolean;
};

export type AllocationDestinationConflict = {
  productId: string;
  productName: string;
  erpCode: number;
  purchaseFormat: string;
  storeId: string;
  storeName: string;
  orderedQuantity: string;
  intendedQuantity: string;
  totalAlreadyDestined: string;
  allocations: AllocationConflictSupplier[];
  fingerprint: string;
};

export class AllocationDestinationConflictError extends Error {
  constructor(
    message: string,
    readonly conflicts: AllocationDestinationConflict[] = [],
  ) {
    super(message);
    this.name = "AllocationDestinationConflictError";
  }
}

export function canManageDestinations(principal: Principal): boolean {
  return hasPermission(principal, "compras:destinacao");
}

export function isCycleDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function roundToTwoDecimals(value: string | number): string {
  const num = typeof value === "number" ? value : Number.parseFloat(value);
  if (Number.isNaN(num) || num < 0) return "0.00";
  return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function parseQuantity(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "number" ? value : Number.parseFloat(String(value).replace(",", "."));
  return Number.isNaN(num) || num < 0 ? 0 : num;
}

export function sumQuantities(quantities: (string | number)[]): string {
  const cents = quantities.reduce<number>((acc, qty) => {
    const parsed = parseQuantity(qty);
    return acc + Math.round(parsed * 100);
  }, 0);
  return (cents / 100).toFixed(2);
}

export function calculateDifference(destined: string | number, ordered: string | number): string {
  const destCents = Math.round(parseQuantity(destined) * 100);
  const ordCents = Math.round(parseQuantity(ordered) * 100);
  const diffCents = destCents - ordCents;
  const sign = diffCents > 0 ? "+" : diffCents < 0 ? "-" : "";
  const abs = Math.abs(diffCents);
  return `${sign}${(abs / 100).toFixed(2)}`;
}

export type StoreInfo = {
  id: string;
  slug: string;
  name: string;
};

export type StoreAllocationData = {
  storeId: string;
  storeName: string;
  storeSlug: string;
  orderedQuantity: string;
  destinedQuantity: string;
  /** Quantidade já confirmada no banco; null identifica apenas uma sugestão local. */
  persistedDestinedQuantity: string | null;
  difference: string;
  isAdditionalPurchase: boolean;
  notes?: string | null;
};

export type ProductAllocationItem = {
  productId: string;
  erpCode: number;
  productName: string;
  purchaseFormat: string;
  isExclusive: boolean;
  exclusiveSupplierId: string | null;
  exclusiveSupplierName: string | null;
  hasOfficialCost: boolean;
  officialCost: string | null;
  purchasedInCosts: boolean;
  isAdditionalPurchase: boolean;
  conversionFactorKg: string | null;
  conversionOrigin: string | null;
  stores: Record<string, StoreAllocationData>;
  totalOrdered: string;
  totalDestined: string;
  totalDifference: string;
  notes?: string | null;
  isOpportunityConfirmed?: boolean;
  version: number;
  supplierDecision?: "NOT_PURCHASED" | null;
  storeTotalDestinedAcrossSuppliers?: string;
};

export type SupplierDestinationData = {
  supplierId: string;
  corporateName: string;
  tradeName: string | null;
  taxId: string | null;
  taxInvoiceRule: string;
  products: ProductAllocationItem[];
  totalProductsCount: number;
  totalDestinedQuantity: string;
};

export type BuyerCycleClosureSummary = {
  cycleDate: string;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  closedByName: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  totalPurchasedInCosts: number;
  totalAllocatedProducts: number;
  missingProducts: Array<{ id: string; erpCode: number; name: string }>;
  missingStores?: Array<{ id: string; name: string; reason: string }>;
  canClose: boolean;
};

export type SupplierSummaryOption = {
  id: string;
  corporateName: string;
  tradeName: string | null;
  taxId: string | null;
  active: boolean;
  hasAllocationsInCycle: boolean;
  totalDestinedQuantity: string;
  destinedByStore: Record<string, string>;
  reviewedByStore?: Record<string, boolean>;
};

export type CatalogSearchItem = {
  id: string;
  erpCode: number;
  name: string;
  purchaseFormat: string;
  isExclusive: boolean;
  exclusiveSupplierId: string | null;
  exclusiveSupplierName: string | null;
  purchasedInCosts?: boolean;
  orderedQuantities?: Record<string, string>;
  totalCycleOrders?: string;
};

/**
 * Validação de integridade entre pedido, custos e destinação (Bug 03 - Regras A, B e C)
 */
export function validateAllocationPurchasedStatus(params: {
  productName: string;
  erpCode: number;
  purchaseFormat: string;
  isPurchasedInCosts: boolean;
  totalCycleOrdersNum: number;
  totalDestinedNum: number;
  isOpportunityConfirmed?: boolean;
  hasExistingAllocation?: boolean;
}): { isValid: boolean; errorMessage?: string } {
  const {
    productName,
    erpCode,
    purchaseFormat,
    isPurchasedInCosts,
    totalCycleOrdersNum,
    totalDestinedNum,
    isOpportunityConfirmed,
    hasExistingAllocation,
  } = params;

  // Regra A: Compra normal (marcada como comprada na tela de custos)
  if (isPurchasedInCosts) {
    return { isValid: true };
  }

  // Regra C: Produto solicitado pelas lojas, mas NÃO marcado como comprado nos custos
  if (totalCycleOrdersNum > 0) {
    if (totalDestinedNum > 0) {
      return {
        isValid: false,
        errorMessage: `O produto "${productName}" (ERP ${erpCode}) possui pedido das lojas neste ciclo (${roundToTwoDecimals(totalCycleOrdersNum)} ${purchaseFormat}), mas não está marcado como comprado na tela de custos. Marque-o como comprado nos custos antes de realizar a destinação.`,
      };
    }
    // Se totalDestinedNum === 0 e hasExistingAllocation, permite zerar para corrigir destinação indevida passada
    return { isValid: true };
  }

  // Regra B: Compra de oportunidade (sem pedidos em nenhuma loja e não comprado nos custos)
  // Caso 1: Oportunidade já gravada anteriormente (hasExistingAllocation = true)
  if (hasExistingAllocation) {
    // Permite alterar quantidade ou zerar destinação sem ficar preso pela validação de quantidade positiva
    return { isValid: true };
  }

  // Caso 2: Nova oportunidade sendo adicionada
  if (totalDestinedNum === 0) {
    return {
      isValid: false,
      errorMessage: `A compra de oportunidade do produto "${productName}" deve possuir quantidade destinada maior que zero.`,
    };
  }

  if (!isOpportunityConfirmed) {
    return {
      isValid: false,
      errorMessage: `A inclusão do produto "${productName}" como compra de oportunidade sem pedido requer confirmação explícita do comprador.`,
    };
  }

  return { isValid: true };
}

export const BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE = 424242;

export type ProductSupplierDecisionType = "NOT_PURCHASED";

export type StoreClosureStatus = "OPEN" | "CLOSED";

export type StoreCutItemStatus = "FULFILLED" | "PARTIAL_CUT" | "TOTAL_CUT" | "ADDITIONAL";

export type StoreCutItem = {
  productId: string;
  erpCode: number;
  productName: string;
  purchaseFormat: string;
  orderedQuantity: string;
  destinedQuantity: string;
  cutQuantity: string;
  status: StoreCutItemStatus;
};

export type StoreClosureSummary = {
  cycleDate: string;
  storeId: string;
  storeName: string;
  status: StoreClosureStatus;
  orderId: string | null;
  orderRevision: number | null;
  totalOrderedItems: number;
  totalDestinedItems: number;
  totalCutItems: number;
  cuts: StoreCutItem[];
  allocationsHash: string;
  orderHash?: string | null;
  costsHash?: string | null;
  version: number;
  isCurrent: boolean;
  closedAt: string | null;
  closedByName: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  isStale: boolean;
  staleReason?: string | null;
  previewOrderId: string | null;
  previewOrderRevision: number | null;
  previewAllocationsHash: string;
  previewCostsHash: string;
};

export type SupplierStoreReviewStatus = "REVIEWED" | "PENDING";

export type SupplierStoreReviewSummary = {
  supplierId: string;
  storeId: string;
  status: SupplierStoreReviewStatus;
  reviewedAt: string | null;
  reviewedByName: string | null;
};

export type StoreSummaryData = {
  storeId: string;
  storeName: string;
  storeSlug: string;
  totalAllocatedProducts: number;
  totalDestinedQuantity: string;
  totalOrderedProducts: number;
  totalDestinedProducts: number;
  totalPartialCutProducts: number;
  totalUnallocatedProducts: number;
  totalReviewedProducts: number;
  totalPendingProducts: number;
  closureStatus: StoreClosureStatus;
  isStale: boolean;
  staleReason?: string | null;
  closureSummary?: StoreCutItem[];
};

export type BuyerAllocationWorkspaceData = {
  cycleDate: string;
  cycles: string[];
  selectedStoreId: string | null;
  selectedSupplierId: string | null;
  closure: BuyerCycleClosureSummary;
  suppliers: SupplierSummaryOption[];
  stores: StoreInfo[];
  destinationData: SupplierDestinationData | null;
  unassignedPurchasedProducts: Array<{ id: string; erpCode: number; name: string; purchaseFormat: string }>;
  catalogSearchList: CatalogSearchItem[];
  cycleStoreOrders: Record<string, Record<string, string>>;
  storeSummary: Record<string, StoreSummaryData>;
  storeClosures: Record<string, StoreClosureSummary>;
  supplierStoreReviews: Record<string, Record<string, SupplierStoreReviewSummary>>;
  loadedAt: string;
};

export type SaveStoreAllocationInput = {
  storeId: string;
  destinedQuantity: string;
  notes?: string;
  conflictResolution?: AllocationConflictResolution;
  conflictFingerprint?: string;
};

export type SaveProductAllocationInput = {
  productId: string;
  stores: SaveStoreAllocationInput[];
  notes?: string;
  isOpportunityConfirmed?: boolean;
};

export type SaveSupplierAllocationsInput = {
  cycleDate: string;
  supplierId: string;
  storeId?: string;
  allocations: SaveProductAllocationInput[];
};

export type SetProductSupplierDecisionInput = {
  cycleDate: string;
  supplierId: string;
  storeId: string;
  productId: string;
  decision: ProductSupplierDecisionType;
  notes?: string;
  confirmRemoveDestined?: boolean;
};

export type RevertProductSupplierDecisionInput = {
  cycleDate: string;
  supplierId: string;
  storeId: string;
  productId: string;
};

export type ConcludeSupplierStoreReviewInput = {
  cycleDate: string;
  supplierId: string;
  storeId: string;
  expectedProductIds: string[];
};

export type CloseStoreCycleInput = {
  cycleDate: string;
  storeId: string;
  expectedOrderId: string | null;
  expectedOrderRevision: number | null;
  expectedAllocationsHash: string;
  expectedCostsHash: string;
};

export type ReopenStoreCycleInput = {
  cycleDate: string;
  storeId: string;
  reason: string;
};

export function canSupplierProvideProduct(params: {
  supplierId: string;
  isJeb: boolean;
  exclusiveSupplierId: string | null;
  legacyExclusive: boolean;
  isLinkedToSupplier: boolean;
}): boolean {
  const { supplierId, isJeb, exclusiveSupplierId, legacyExclusive, isLinkedToSupplier } = params;
  // 1. Vínculo moderno de exclusividade (tabela product_suppliers) tem precedência sobre flag legada
  if (exclusiveSupplierId) {
    return exclusiveSupplierId === supplierId;
  }
  // 2. Sem exclusividade moderna: produto exclusivo legado pertence apenas à JEB Distribuidora
  if (legacyExclusive) {
    return isJeb;
  }
  // 3. Sem exclusividade: fornecedor precisa ter vínculo ativo com o produto
  return isLinkedToSupplier;
}

export function hasPendingStoreAllocation(
  allocation:
    | Pick<
        StoreAllocationData,
        "orderedQuantity" | "destinedQuantity" | "persistedDestinedQuantity"
      >
    | undefined,
): boolean {
  if (!allocation) return false;
  const currentCents = Math.round(parseQuantity(allocation.destinedQuantity) * 100);
  if (allocation.persistedDestinedQuantity === null) {
    const orderedCents = Math.round(parseQuantity(allocation.orderedQuantity) * 100);
    return currentCents > 0 || orderedCents > 0;
  }
  const persistedCents = Math.round(parseQuantity(allocation.persistedDestinedQuantity) * 100);
  return currentCents !== persistedCents;
}

export function computeStoreAllocationsHash(
  allocations: Array<{ productId: string; supplierId: string; destinedQuantity: string }>,
): string {
  const sorted = [...allocations]
    .filter((a) => parseQuantity(a.destinedQuantity) > 0)
    .sort((a, b) => {
      const cmp = a.productId.localeCompare(b.productId);
      return cmp !== 0 ? cmp : a.supplierId.localeCompare(b.supplierId);
    });

  const payload = sorted
    .map((a) => `${a.productId}:${a.supplierId}:${roundToTwoDecimals(a.destinedQuantity)}`)
    .join("|");

  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `h_${(hash >>> 0).toString(16)}_${sorted.length}`;
}

export function computeStoreCostsHash(
  items: Array<{
    productId: string;
    purchased: boolean;
    cost?: string | number | null;
    costIsUnit?: boolean | null;
    version?: number | null;
  }>,
): string {
  const sorted = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
  const payload = sorted
    .map((i) => {
      const p = i.purchased ? "1" : "0";
      const c = i.cost !== null && i.cost !== undefined ? roundToTwoDecimals(String(i.cost)) : "";
      const u = i.costIsUnit ? "1" : "0";
      const v = i.version ?? 0;
      return `${i.productId}:${p}:${c}:${u}:${v}`;
    })
    .join("|");

  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `c_${(hash >>> 0).toString(16)}_${sorted.length}`;
}

export function calculateStoreCutSummary(params: {
  orderedItems: Array<{
    productId: string;
    erpCode: number;
    productName: string;
    purchaseFormat: string;
    orderedQuantity: string;
  }>;
  storeAllocationsByProduct: Map<string, string>;
  catalogMap?: Map<string, { erpCode: number; name: string; purchaseFormat: string }>;
}): {
  cuts: StoreCutItem[];
  totalOrderedItems: number;
  totalDestinedItems: number;
  totalCutItems: number;
} {
  const { orderedItems, storeAllocationsByProduct, catalogMap } = params;
  const cuts: StoreCutItem[] = [];
  let totalDestinedItems = 0;
  let totalCutItems = 0;

  for (const item of orderedItems) {
    const orderedNum = parseQuantity(item.orderedQuantity);
    const destinedNum = parseQuantity(storeAllocationsByProduct.get(item.productId) ?? "0");
    const orderedQtyStr = roundToTwoDecimals(orderedNum);
    const destinedQtyStr = roundToTwoDecimals(destinedNum);

    let status: StoreCutItemStatus;
    let cutQtyStr = "0.00";

    if (destinedNum >= orderedNum && orderedNum > 0) {
      status = "FULFILLED";
      totalDestinedItems++;
    } else if (destinedNum > 0 && destinedNum < orderedNum) {
      status = "PARTIAL_CUT";
      cutQtyStr = roundToTwoDecimals(orderedNum - destinedNum);
      totalDestinedItems++;
      totalCutItems++;
    } else if (orderedNum > 0 && destinedNum === 0) {
      status = "TOTAL_CUT";
      cutQtyStr = orderedQtyStr;
      totalCutItems++;
    } else {
      status = "ADDITIONAL";
      if (destinedNum > 0) totalDestinedItems++;
    }

    cuts.push({
      productId: item.productId,
      erpCode: item.erpCode,
      productName: item.productName,
      purchaseFormat: item.purchaseFormat,
      orderedQuantity: orderedQtyStr,
      destinedQuantity: destinedQtyStr,
      cutQuantity: cutQtyStr,
      status,
    });
  }

  // Itens de oportunidade ou adicionais destinados à loja sem pedido original
  if (catalogMap) {
    const processedProductIds = new Set(orderedItems.map((i) => i.productId));
    for (const [productId, destinedQtyStr] of storeAllocationsByProduct.entries()) {
      if (processedProductIds.has(productId)) continue;
      const destinedNum = parseQuantity(destinedQtyStr);
      if (destinedNum <= 0) continue;

      const catItem = catalogMap.get(productId);
      cuts.push({
        productId,
        erpCode: catItem?.erpCode ?? 0,
        productName: catItem?.name ?? `Produto ${productId}`,
        purchaseFormat: catItem?.purchaseFormat ?? "UN",
        orderedQuantity: "0.00",
        destinedQuantity: roundToTwoDecimals(destinedNum),
        cutQuantity: "0.00",
        status: "ADDITIONAL",
      });
      totalDestinedItems++;
    }
  }

  return {
    cuts,
    totalOrderedItems: orderedItems.length,
    totalDestinedItems,
    totalCutItems,
  };
}

export function validateCycleClosureReadinessStoreFirst(params: {
  stores: StoreInfo[];
  storeClosures: Record<string, StoreClosureSummary>;
  purchasedProductIds: string[];
  globallyAllocatedProductIds: Set<string>;
  catalogMap: Map<string, { id: string; erpCode: number; name: string }>;
}): {
  canClose: boolean;
  missingStores: Array<{ id: string; name: string; reason: string }>;
  missingProducts: Array<{ id: string; erpCode: number; name: string }>;
} {
  const {
    stores,
    storeClosures,
    purchasedProductIds,
    globallyAllocatedProductIds,
    catalogMap,
  } = params;

  const missingStores: Array<{ id: string; name: string; reason: string }> = [];
  const missingProducts: Array<{ id: string; erpCode: number; name: string }> = [];

  // 1. Cada uma das lojas ativas precisa estar FINALIZADA e NÃO stale
  for (const store of stores) {
    const closure = storeClosures[store.id];
    if (!closure || closure.status !== "CLOSED") {
      missingStores.push({
        id: store.id,
        name: store.name,
        reason: "Conferência da loja não finalizada.",
      });
    } else if (closure.isStale) {
      missingStores.push({
        id: store.id,
        name: store.name,
        reason: closure.staleReason ?? "Conferência da loja desatualizada após alterações.",
      });
    }
  }

  // 2. Todos os produtos marcados como comprados nos custos devem ter sido alocados
  for (const pid of purchasedProductIds) {
    if (!globallyAllocatedProductIds.has(pid)) {
      const p = catalogMap.get(pid);
      if (p) {
        missingProducts.push(p);
      } else {
        missingProducts.push({ id: pid, erpCode: 0, name: `Produto ${pid}` });
      }
    }
  }

  return {
    canClose: missingStores.length === 0 && missingProducts.length === 0,
    missingStores,
    missingProducts,
  };
}

export function validateClosureReadiness(
  purchasedProductIds: string[],
  allocatedProductIds: Set<string>,
  catalogMap: Map<string, { id: string; erpCode: number; name: string }>,
): { canClose: boolean; missingProducts: Array<{ id: string; erpCode: number; name: string }> } {
  const missingProducts: Array<{ id: string; erpCode: number; name: string }> = [];

  for (const pid of purchasedProductIds) {
    if (!allocatedProductIds.has(pid)) {
      const p = catalogMap.get(pid);
      if (p) {
        missingProducts.push(p);
      } else {
        missingProducts.push({ id: pid, erpCode: 0, name: `Produto ${pid}` });
      }
    }
  }

  return {
    canClose: missingProducts.length === 0,
    missingProducts,
  };
}
