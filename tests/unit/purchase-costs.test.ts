import { describe, expect, it } from "vitest";
import {
  buildPurchaseCostProducts,
  canManagePurchaseCosts,
  filterPurchaseCostProducts,
  formatCostInput,
  formatCurrency,
  isCostChanged,
  parseCostInput,
  storeQuantity,
  validatePurchaseCost,
  type PurchaseCostState,
} from "@/modules/purchasing/costs/domain";
import {
  buildConsolidatedProducts,
  type CatalogProduct,
  type ConsolidatedData,
  type ConsolidatedStore,
} from "@/modules/purchasing/domain";

const stores: ConsolidatedStore[] = [
  ["p", "ponta-da-fruta", "MultiShow Ponta da Fruta"],
  ["b", "balneario", "MultiShow Balneário"],
  ["s", "santa-monica", "MultiShow Santa Mônica"],
].map(([id, slug, name]) => ({
  id,
  slug,
  name,
  order: {
    id: `order-${id}`,
    revision: 1,
    submittedAt: "2026-09-22T18:00:00.000Z",
    cutoffAt: "2026-09-22T22:00:00.000Z",
  },
}));

const catalog: CatalogProduct[] = [
  { id: "banana", erpCode: 12, name: "BANANA PRATA", purchaseFormat: "CX", active: true },
  { id: "batata", erpCode: 34, name: "BATATA", purchaseFormat: "SC", active: true },
  { id: "abacaxi", erpCode: 56, name: "ABACAXI", purchaseFormat: "UND", active: true },
  { id: "zero", erpCode: 78, name: "SEM PEDIDO", purchaseFormat: "BDJ", active: true },
];

function consolidated(): ConsolidatedData {
  const items = stores.flatMap((store, storeIndex) =>
    catalog.map((product) => ({
      storeId: store.id,
      productId: product.id,
      stock: "999.00",
      quantity:
        product.id === "zero"
          ? "0.00"
          : ["20.00", "15.00", "10.00"][storeIndex],
    })),
  );
  return {
    cycleDate: "2026-09-23",
    cycles: ["2026-09-23"],
    stores,
    products: buildConsolidatedProducts(catalog, stores, items),
    loadedAt: "2026-09-22T18:00:00.000Z",
  };
}

const states: PurchaseCostState[] = [
  {
    productId: "banana",
    exclusiveSupplier: true,
    currentCost: null,
    purchased: false,
    version: 0,
    updatedAt: null,
    previousCost: "72.00",
    previousCycleDate: "2026-09-22",
  },
  {
    productId: "batata",
    exclusiveSupplier: false,
    currentCost: "125.90",
    purchased: true,
    version: 2,
    updatedAt: "2026-09-22T18:10:00.000Z",
    previousCost: "120.00",
    previousCycleDate: "2026-09-22",
  },
  {
    productId: "abacaxi",
    exclusiveSupplier: false,
    currentCost: null,
    purchased: false,
    version: 0,
    updatedAt: null,
    previousCost: null,
    previousCycleDate: null,
  },
];

describe("Lançamento de custos", () => {
  it("normaliza entrada BRL sem usar float", () => {
    expect(parseCostInput("75")).toBe("75.00");
    expect(parseCostInput("75,5")).toBe("75.50");
    expect(parseCostInput("75,50")).toBe("75.50");
    expect(parseCostInput("R$ 1.125,90")).toBe("1125.90");
    expect(formatCostInput("125.90")).toBe("125,90");
    expect(formatCurrency("1125.90")).toBe("R$ 1.125,90");
  });

  it("rejeita custo negativo, zero, inválido, infinito e acima do limite", () => {
    for (const invalid of ["-1", "0", "NaN", "Infinity", "1,234", "100000000"])
      expect(() => parseCostInput(invalid)).toThrow();
    expect(parseCostInput("")).toBeNull();
    expect(() => validatePurchaseCost("", true)).toThrow(
      /Informe o custo antes/,
    );
  });

  it("pré-preenche custo atual com o último efetivamente comprado", () => {
    const rows = buildPurchaseCostProducts(consolidated(), states);
    const banana = rows.find((product) => product.id === "banana")!;
    expect(banana.previousCost).toBe("72.00");
    expect(banana.currentCost).toBe("72.00");
    expect(banana.inheritedCost).toBe(true);
    expect(banana.purchased).toBe(false);
  });

  it("produto sem histórico inicia vazio", () => {
    const row = buildPurchaseCostProducts(consolidated(), states).find(
      (product) => product.id === "abacaxi",
    )!;
    expect(row.previousCost).toBeNull();
    expect(row.currentCost).toBeNull();
    expect(row.inheritedCost).toBe(true);
  });

  it("preserva custo salvo e comprado do ciclo", () => {
    const row = buildPurchaseCostProducts(consolidated(), states).find(
      (product) => product.id === "batata",
    )!;
    expect(row.currentCost).toBe("125.90");
    expect(row.previousCost).toBe("120.00");
    expect(row.purchased).toBe(true);
    expect(row.version).toBe(2);
  });

  it("detecta alteração somente quando existe custo anterior diferente", () => {
    expect(isCostChanged("75.00", "75,00")).toBe(false);
    expect(isCostChanged("75.00", "78,00")).toBe(true);
    expect(isCostChanged(null, "78,00")).toBe(false);
    expect(isCostChanged("75.00", "valor inválido")).toBe(false);
  });

  it("exclui da tela produtos sem pedido e mantém formato/total sem conversão", () => {
    const rows = buildPurchaseCostProducts(consolidated(), states);
    expect(rows.map((product) => product.id)).not.toContain("zero");
    expect(rows.map((product) => [product.purchaseFormat, product.total])).toEqual([
      ["UND", "45.00"],
      ["CX", "45.00"],
      ["SC", "45.00"],
    ]);
    expect(rows[0]).not.toHaveProperty("totalStock");
  });

  it("identifica fornecedor exclusivo existente no catálogo", () => {
    expect(
      buildPurchaseCostProducts(consolidated(), states).find(
        (product) => product.id === "banana",
      )?.exclusiveSupplier,
    ).toBe(true);
  });

  it("filtra Todos, Faltam comprar e Comprados pelo checkbox", () => {
    const rows = buildPurchaseCostProducts(consolidated(), states);
    expect(filterPurchaseCostProducts(rows, "", "all")).toHaveLength(3);
    expect(
      filterPurchaseCostProducts(rows, "", "pending").map((product) => product.id),
    ).toEqual(["abacaxi", "banana"]);
    expect(
      filterPurchaseCostProducts(rows, "", "purchased").map((product) => product.id),
    ).toEqual(["batata"]);
  });

  it("combina busca por nome e ERP com filtro", () => {
    const rows = buildPurchaseCostProducts(consolidated(), states);
    expect(
      filterPurchaseCostProducts(rows, "banana", "pending").map(
        (product) => product.id,
      ),
    ).toEqual(["banana"]);
    expect(
      filterPurchaseCostProducts(rows, "34", "purchased").map(
        (product) => product.id,
      ),
    ).toEqual(["batata"]);
    expect(filterPurchaseCostProducts(rows, "banana", "purchased")).toHaveLength(0);
  });

  it("obtém P/B/S apenas dos pedidos e nunca do estoque", () => {
    const banana = buildPurchaseCostProducts(consolidated(), states).find(
      (product) => product.id === "banana",
    )!;
    expect(stores.map((store) => storeQuantity(banana, store))).toEqual([
      "20.00",
      "15.00",
      "10.00",
    ]);
    expect(banana.total).toBe("45.00");
  });

  it("autoriza Comprador/Gestor e recusa Loja", () => {
    expect(
      canManagePurchaseCosts({ userId: "1", role: "COMPRADOR", storeId: null }),
    ).toBe(true);
    expect(
      canManagePurchaseCosts({ userId: "1", role: "GESTOR", storeId: null }),
    ).toBe(true);
    expect(
      canManagePurchaseCosts({ userId: "1", role: "LOJA", storeId: "s" }),
    ).toBe(false);
  });
});
