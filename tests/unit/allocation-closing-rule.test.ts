import { describe, expect, it } from "vitest";
import { classifyStorePurchasedGaps } from "@/modules/purchasing/allocations/domain";

describe("Regra de fechamento da loja (04/11/2026)", () => {
  const orderedByStore = [
    { productId: "aipim", orderedQuantity: "2.00" },
    { productId: "maca", orderedQuantity: "3.00" },
    { productId: "laranja", orderedQuantity: "6.00" },
    { productId: "abobrinha", orderedQuantity: "1.00" },
    { productId: "sem-pedido", orderedQuantity: "0.00" },
  ];
  const purchased = new Set(["aipim", "maca", "laranja", "sem-pedido"]);

  it("trava o comprado sem destino e pede confirmação do que foi só para outras lojas", () => {
    const result = classifyStorePurchasedGaps({
      orderedByStore,
      purchasedProductIds: purchased,
      destinedTotalByProduct: new Map([
        ["maca", 5],
        ["laranja", 6],
      ]),
      destinedToStoreByProduct: new Map([["laranja", 6]]),
    });
    expect(result.withoutDestination).toEqual(["aipim"]);
    expect(result.zeroForStore).toEqual(["maca"]);
  });

  it("produto não marcado como comprado é corte normal, sem trava", () => {
    const result = classifyStorePurchasedGaps({
      orderedByStore: [{ productId: "abobrinha", orderedQuantity: "1.00" }],
      purchasedProductIds: purchased,
      destinedTotalByProduct: new Map(),
      destinedToStoreByProduct: new Map(),
    });
    expect(result).toEqual({ withoutDestination: [], zeroForStore: [] });
  });
});
