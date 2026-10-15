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
};

export type CatalogSearchItem = {
  id: string;
  erpCode: number;
  name: string;
  purchaseFormat: string;
  isExclusive: boolean;
  exclusiveSupplierId: string | null;
  exclusiveSupplierName: string | null;
};

export type BuyerAllocationWorkspaceData = {
  cycleDate: string;
  cycles: string[];
  selectedSupplierId: string | null;
  closure: BuyerCycleClosureSummary;
  suppliers: SupplierSummaryOption[];
  stores: StoreInfo[];
  destinationData: SupplierDestinationData | null;
  unassignedPurchasedProducts: Array<{ id: string; erpCode: number; name: string; purchaseFormat: string }>;
  catalogSearchList: CatalogSearchItem[];
  loadedAt: string;
};

export type SaveStoreAllocationInput = {
  storeId: string;
  destinedQuantity: string;
  notes?: string;
};

export type SaveProductAllocationInput = {
  productId: string;
  stores: SaveStoreAllocationInput[];
  notes?: string;
};

export type SaveSupplierAllocationsInput = {
  cycleDate: string;
  supplierId: string;
  allocations: SaveProductAllocationInput[];
};

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
