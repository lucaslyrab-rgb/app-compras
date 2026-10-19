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
    readonly conflicts: AllocationDestinationConflict[],
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

export type StoreSummaryData = {
  storeId: string;
  storeName: string;
  storeSlug: string;
  totalAllocatedProducts: number;
  totalDestinedQuantity: string;
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
