import { AuthorizationError, type Principal } from "@/modules/identity";
import {
  buildPurchaseCostProducts,
  canManagePurchaseCosts,
  validatePurchaseCost,
  type PurchaseCostsData,
} from "./domain";
import {
  persistPurchaseCost,
  readPurchaseCostStates,
} from "./repository";
import { isCycleDate } from "../domain";
import { loadConsolidated } from "../service";

export async function loadPurchaseCosts(
  principal: Principal,
  requestedCycle?: string,
): Promise<PurchaseCostsData> {
  if (!canManagePurchaseCosts(principal))
    throw new AuthorizationError("Acesso restrito ao Comprador e Gestor");
  const consolidated = await loadConsolidated(principal, requestedCycle);
  const productsWithOrder = consolidated.products.filter(
    (product) => Number(product.total) > 0,
  );
  const states = await readPurchaseCostStates(
    principal,
    productsWithOrder.map((product) => product.id),
    consolidated.cycleDate,
  );
  return {
    cycleDate: consolidated.cycleDate,
    cycles: consolidated.cycles,
    stores: consolidated.stores,
    products: buildPurchaseCostProducts(consolidated, states),
    loadedAt: new Date().toISOString(),
  };
}

export async function savePurchaseCost(
  principal: Principal,
  input: {
    productId: string;
    cycleDate: string;
    costInput: string;
    costIsUnit?: boolean;
    purchased: boolean;
    expectedVersion: number;
  },
) {
  if (!canManagePurchaseCosts(principal))
    throw new AuthorizationError("Acesso restrito ao Comprador e Gestor");
  if (!isCycleDate(input.cycleDate)) throw new Error("Data de compra inválida");
  const consolidated = await loadConsolidated(principal, input.cycleDate);
  const product = consolidated.products.find(
    (candidate) =>
      candidate.id === input.productId && Number(candidate.total) > 0,
  );
  if (!product)
    throw new Error("Produto sem pedido válido neste ciclo de compra.");
  const cost = validatePurchaseCost(input.costInput, input.purchased);
  return persistPurchaseCost(principal, {
    productId: input.productId,
    cycleDate: input.cycleDate,
    cost,
    costIsUnit: input.costIsUnit ?? false,
    purchased: input.purchased,
    expectedVersion: input.expectedVersion,
  });
}
