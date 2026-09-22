import type { Principal } from "@/modules/identity";

export type OrderSummary = {
  id: string;
  revision: number;
  submittedAt: string;
  cutoffAt: string;
};
export type ConsolidatedStore = {
  id: string;
  slug: string;
  name: string;
  order: OrderSummary | null;
};
export type CatalogProduct = {
  id: string;
  erpCode: number;
  name: string;
  purchaseFormat: string;
  active: boolean;
  imageUrl?: string | null;
};
export type StoreValues = { stock: string; quantity: string };
export type ConsolidatedProduct = CatalogProduct & {
  stores: Record<string, StoreValues | null>;
  total: string;
};
export type ConsolidatedData = {
  cycleDate: string;
  cycles: string[];
  stores: ConsolidatedStore[];
  products: ConsolidatedProduct[];
  loadedAt: string;
};
export type ConsolidatedItem = StoreValues & {
  storeId: string;
  productId: string;
};
export type OrderFilter = "all" | "filled" | "empty";

export function canViewConsolidated(principal: Principal) {
  return principal.role === "COMPRADOR" || principal.role === "GESTOR";
}

// Values already use the product's purchase format. Integer hundredths avoid floating point drift.
export function sumRequested(quantities: string[]) {
  const cents = quantities.reduce((sum, quantity) => {
    const [whole, fraction = ""] = quantity.split(".");
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }, 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function buildConsolidatedProducts(
  catalog: CatalogProduct[],
  stores: ConsolidatedStore[],
  items: ConsolidatedItem[],
): ConsolidatedProduct[] {
  const byProduct = new Map<string, Map<string, StoreValues>>();
  for (const item of items) {
    if (!byProduct.has(item.productId))
      byProduct.set(item.productId, new Map());
    byProduct
      .get(item.productId)!
      .set(item.storeId, { stock: item.stock, quantity: item.quantity });
  }
  return catalog
    .map((product) => {
      const values = Object.fromEntries(
        stores.map((store) => [
          store.id,
          store.order
            ? (byProduct.get(product.id)?.get(store.id) ?? null)
            : null,
        ]),
      );
      return {
        ...product,
        stores: values,
        total: sumRequested(
          Object.values(values).flatMap((value) =>
            value ? [value.quantity] : [],
          ),
        ),
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) ||
        a.erpCode - b.erpCode,
    );
}

export function filterConsolidatedProducts(
  products: ConsolidatedProduct[],
  query: string,
  filter: OrderFilter,
) {
  const term = query.trim().toLocaleLowerCase("pt-BR");
  return products.filter(
    (product) =>
      (!term ||
        product.name.toLocaleLowerCase("pt-BR").includes(term) ||
        String(product.erpCode).includes(term)) &&
      (filter === "all" ||
        (filter === "filled"
          ? Number(product.total) > 0
          : Number(product.total) === 0)),
  );
}

export function isCycleDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export function shortStoreName(name: string) {
  return name.replace(/^MultiShow\s+/i, "");
}

// Stable colors for the existing stores; new stores receive a neutral palette.
export function storeColor(slug: string) {
  return (
    (
      {
        "ponta-da-fruta": "blue",
        balneario: "green",
        "santa-monica": "orange",
      } as Record<string, string>
    )[slug] ?? "neutral"
  );
}
