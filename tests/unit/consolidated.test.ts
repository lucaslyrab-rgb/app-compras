import { describe, expect, it } from "vitest";
import {
  buildConsolidatedProducts,
  canViewConsolidated,
  filterConsolidatedProducts,
  isCycleDate,
  shortStoreName,
  storeColor,
  sumRequested,
  type CatalogProduct,
  type ConsolidatedStore,
} from "@/modules/purchasing/domain";

const stores: ConsolidatedStore[] = [
  "ponta-da-fruta",
  "balneario",
  "santa-monica",
].map((slug, i) => ({
  id: String(i),
  slug,
  name: `MultiShow ${slug}`,
  order: {
    id: `o${i}`,
    revision: 2,
    submittedAt: "2026-09-22T21:00:00Z",
    cutoffAt: "2026-09-22T22:00:00Z",
  },
}));
const catalog: CatalogProduct[] = [
  { id: "b", erpCode: 102, name: "BANANA", purchaseFormat: "CX", active: true },
  {
    id: "a",
    erpCode: 101,
    name: "ABACAXI",
    purchaseFormat: "UND",
    active: true,
  },
  { id: "c", erpCode: 103, name: "BATATA", purchaseFormat: "SC", active: true },
];

describe("Consolidado de leitura", () => {
  it("soma pedidos, nunca estoques, sem converter formatos", () => {
    const items = stores.flatMap((store, i) =>
      catalog.map((product) => ({
        storeId: store.id,
        productId: product.id,
        stock: "99999.00",
        quantity: ["10.00", "5.00", "8.00"][i],
      })),
    );
    const rows = buildConsolidatedProducts(catalog, stores, items);
    expect(rows.map((p) => p.name)).toEqual(["ABACAXI", "BANANA", "BATATA"]);
    expect(rows.map((p) => p.purchaseFormat)).toEqual(["UND", "CX", "SC"]);
    expect(rows.every((p) => p.total === "23.00")).toBe(true);
    expect(rows[0].stores["0"]?.stock).toBe("99999.00");
    expect(rows[0]).not.toHaveProperty("totalStock");
    const changedStock = buildConsolidatedProducts(
      catalog,
      stores,
      items.map((item) => ({ ...item, stock: "0.00" })),
    );
    expect(changedStock.map((p) => p.total)).toEqual(rows.map((p) => p.total));
  });
  it("distingue zero, loja ausente e produto ausente no snapshot", () => {
    const partial = [stores[0], stores[1], { ...stores[2], order: null }];
    const rows = buildConsolidatedProducts(catalog, partial, [
      { storeId: "0", productId: "b", stock: "20.00", quantity: "0.00" },
      { storeId: "1", productId: "b", stock: "5.00", quantity: "3.00" },
    ]);
    const banana = rows.find((p) => p.id === "b")!;
    expect(banana.total).toBe("3.00");
    expect(banana.stores["0"]?.quantity).toBe("0.00");
    expect(banana.stores["2"]).toBeNull();
    expect(rows.find((p) => p.id === "a")!.stores["0"]).toBeNull();
    const empty = buildConsolidatedProducts(
      catalog,
      stores.map((s) => ({ ...s, order: null })),
      [],
    );
    expect(
      empty.every(
        (p) =>
          p.total === "0.00" &&
          Object.values(p.stores).every((v) => v === null),
      ),
    ).toBe(true);
  });
  it("combina busca por nome/ERP e filtros, ignorando estoque", () => {
    const rows = buildConsolidatedProducts(catalog, stores, [
      { storeId: "0", productId: "a", stock: "20.00", quantity: "0.00" },
      { storeId: "1", productId: "b", stock: "0.00", quantity: "1.00" },
    ]);
    expect(filterConsolidatedProducts(rows, "", "all")).toHaveLength(3);
    expect(
      filterConsolidatedProducts(rows, "", "filled").map((p) => p.id),
    ).toEqual(["b"]);
    expect(
      filterConsolidatedProducts(rows, "", "empty").map((p) => p.id),
    ).toEqual(["a", "c"]);
    expect(
      filterConsolidatedProducts(rows, " bAnAnA ", "filled").map((p) => p.id),
    ).toEqual(["b"]);
    expect(
      filterConsolidatedProducts(rows, "102", "filled").map((p) => p.id),
    ).toEqual(["b"]);
    expect(filterConsolidatedProducts(rows, "banana", "empty")).toHaveLength(0);
    expect(filterConsolidatedProducts(rows, "101", "empty")).toHaveLength(1);
  });
  it("mantém precisão decimal sem conversão e não soma formatos entre produtos", () => {
    expect(sumRequested(["0.10", "0.20"])).toBe("0.30");
    expect(sumRequested(["9999999999.99", "9999999999.99"])).toBe(
      "19999999999.98",
    );
    expect(sumRequested(["2", "3.5"])).toBe("5.50");
    expect(sumRequested([])).toBe("0.00");
  });
  it("permite Comprador/Gestor, recusa Loja e valida datas reais", () => {
    expect(
      canViewConsolidated({ userId: "x", storeId: null, role: "COMPRADOR" }),
    ).toBe(true);
    expect(
      canViewConsolidated({ userId: "x", storeId: null, role: "GESTOR" }),
    ).toBe(true);
    expect(
      canViewConsolidated({ userId: "x", storeId: "s", role: "LOJA" }),
    ).toBe(false);
    expect(isCycleDate("2026-09-23")).toBe(true);
    for (const invalid of ["2026-02-30", "22/09/2026", "invalid", "2026-13-01"])
      expect(isCycleDate(invalid)).toBe(false);
  });
  it("mantém cores estáveis por slug e aceita novas lojas", () => {
    expect(stores.map((s) => storeColor(s.slug))).toEqual([
      "blue",
      "green",
      "orange",
    ]);
    expect(storeColor("nova-loja")).toBe("neutral");
    expect(shortStoreName("MultiShow Ponta da Fruta")).toBe("Ponta da Fruta");
    expect(shortStoreName("Nova loja")).toBe("Nova loja");
  });
});
