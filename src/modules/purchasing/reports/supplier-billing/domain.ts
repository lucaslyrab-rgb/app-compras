export type BillingStoreItem = {
  productId: string;
  erpCode: number;
  productName: string;
  unit: string;
  purchaseFormat: string;
  quantity: string;
};

export type BillingStoreSection = {
  storeId: string;
  storeSlug: string;
  storeName: string;
  hasOrder: boolean;
  orderId: string | null;
  revision: number | null;
  submittedAt: string | null;
  cutoffAt: string | null;
  items: BillingStoreItem[];
  totalQuantity: string;
};

export type ConsolidatedProductBilling = {
  productId: string;
  erpCode: number;
  productName: string;
  unit: string;
  purchaseFormat: string;
  storeQuantities: Record<string, string>;
  totalQuantity: string;
};

export type ProductWithoutDemand = {
  productId: string;
  erpCode: number;
  productName: string;
  purchaseFormat: string;
  unit: string;
};

export type SupplierBillingHeader = {
  id: string;
  corporateName: string;
  tradeName: string | null;
  taxId: string | null;
  taxIdType: string;
  taxInvoiceRule: string;
  contactName: string | null;
  contactPhone: string | null;
};

export type SupplierBillingReport = {
  supplier: SupplierBillingHeader;
  cycleDate: string;
  availableCycles: string[];
  stores: BillingStoreSection[];
  consolidatedProducts: ConsolidatedProductBilling[];
  productsWithoutOrders: ProductWithoutDemand[];
  loadedAt: string;
};

export function sumQuantities(quantities: string[]): string {
  const cents = quantities.reduce((sum, quantity) => {
    if (!quantity || quantity === "—") return sum;
    const [whole, fraction = ""] = quantity.split(".");
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  }, 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function formatQuantityPtBr(value: string | number): string {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return "0";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatCycleDatePtBr(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}
