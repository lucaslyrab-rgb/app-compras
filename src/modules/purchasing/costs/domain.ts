import type { Principal } from "@/modules/identity";
import type {
  ConsolidatedData,
  ConsolidatedProduct,
  ConsolidatedStore,
} from "../domain";

export const MAX_COST_CENTS = 9_999_999_999n;

export type CostFilter = "all" | "pending" | "purchased";

export type PurchaseCostState = {
  productId: string;
  exclusiveSupplier: boolean;
  currentCost: string | null;
  purchased: boolean;
  version: number;
  updatedAt: string | null;
  previousCost: string | null;
  previousCycleDate: string | null;
};

export type PurchaseCostProduct = ConsolidatedProduct & {
  exclusiveSupplier: boolean;
  previousCost: string | null;
  previousCycleDate: string | null;
  currentCost: string | null;
  inheritedCost: boolean;
  purchased: boolean;
  version: number;
  updatedAt: string | null;
};

export type PurchaseCostsData = {
  cycleDate: string;
  cycles: string[];
  stores: ConsolidatedStore[];
  products: PurchaseCostProduct[];
  loadedAt: string;
};

export type SavedPurchaseCost = {
  productId: string;
  cycleDate: string;
  cost: string | null;
  purchased: boolean;
  version: number;
  updatedAt: string;
};

export class PurchaseCostConflictError extends Error {
  constructor(public readonly current: SavedPurchaseCost) {
    super("O custo foi atualizado em outra sessão.");
    this.name = "PurchaseCostConflictError";
  }
}

export class PurchaseCostValidationError extends Error {
  override name = "PurchaseCostValidationError";
}

export function canManagePurchaseCosts(principal: Principal) {
  return principal.role === "COMPRADOR" || principal.role === "GESTOR";
}

function costCents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function parseCostInput(input: string | null | undefined) {
  const raw = (input ?? "")
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/[\s\u00a0]/g, "");
  if (!raw) return null;
  if (!/^[0-9.,]+$/.test(raw))
    throw new PurchaseCostValidationError("Informe um custo válido.");

  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  const decimalAt = Math.max(comma, dot);
  let whole = raw;
  let fraction = "";
  if (decimalAt >= 0) {
    whole = raw.slice(0, decimalAt);
    fraction = raw.slice(decimalAt + 1);
  }
  whole = whole.replace(/[.,]/g, "");
  if (!whole) whole = "0";
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction))
    throw new PurchaseCostValidationError(
      "Use no máximo duas casas decimais.",
    );
  const canonical = `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
  const cents = costCents(canonical);
  if (cents <= 0n)
    throw new PurchaseCostValidationError("O custo deve ser maior que zero.");
  if (cents > MAX_COST_CENTS)
    throw new PurchaseCostValidationError("O custo informado é muito alto.");
  return canonical;
}

export function formatCostInput(cost: string | null) {
  if (!cost) return "";
  const [whole, fraction = ""] = cost.split(".");
  return `${BigInt(whole)},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

export function formatCurrency(cost: string | null) {
  if (!cost) return "—";
  const [whole, fraction = ""] = cost.split(".");
  const grouped = BigInt(whole)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${grouped},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

export function isCostChanged(
  previousCost: string | null,
  currentInput: string,
) {
  if (!previousCost) return false;
  try {
    return parseCostInput(currentInput) !== previousCost;
  } catch {
    return false;
  }
}

export function validatePurchaseCost(costInput: string, purchased: boolean) {
  const cost = parseCostInput(costInput);
  if (purchased && !cost)
    throw new PurchaseCostValidationError(
      "Informe o custo antes de marcar como comprado.",
    );
  return cost;
}

export function buildPurchaseCostProducts(
  consolidated: ConsolidatedData,
  states: PurchaseCostState[],
): PurchaseCostProduct[] {
  const byProduct = new Map(states.map((state) => [state.productId, state]));
  return consolidated.products
    .filter((product) => Number(product.total) > 0)
    .map((product) => {
      const state = byProduct.get(product.id);
      const inheritedCost = !state?.currentCost && !state?.version;
      return {
        ...product,
        exclusiveSupplier: state?.exclusiveSupplier ?? false,
        previousCost: state?.previousCost ?? null,
        previousCycleDate: state?.previousCycleDate ?? null,
        currentCost: inheritedCost
          ? (state?.previousCost ?? null)
          : (state?.currentCost ?? null),
        inheritedCost,
        purchased: state?.purchased ?? false,
        version: state?.version ?? 0,
        updatedAt: state?.updatedAt ?? null,
      };
    });
}

export function filterPurchaseCostProducts(
  products: PurchaseCostProduct[],
  query: string,
  filter: CostFilter,
) {
  const term = query.trim().toLocaleLowerCase("pt-BR");
  return products.filter(
    (product) =>
      (!term ||
        product.name.toLocaleLowerCase("pt-BR").includes(term) ||
        String(product.erpCode).includes(term)) &&
      (filter === "all" ||
        (filter === "purchased" ? product.purchased : !product.purchased)),
  );
}

export function storeQuantity(
  product: ConsolidatedProduct,
  store: ConsolidatedStore,
) {
  return product.stores[store.id]?.quantity ?? null;
}
