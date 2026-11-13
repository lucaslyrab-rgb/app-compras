import { describe, expect, it } from "vitest";
import { buildConsolidatedProducts } from "@/modules/purchasing/domain";
import { buildConsolidatedPrintModel } from "@/modules/purchasing/reports/consolidated-print/domain";
import { filterLossProducts } from "@/modules/purchasing/losses/loss-product-picker";
import {
  compareForOperationalLists,
  sortForOperationalLists,
  startsPackagedSection,
} from "@/lib/product-sections";

describe("seção Embalados", () => {
  const items = [
    { name: "VAGEM VERDE WG 300G", isPackaged: true, erpCode: 2608 },
    { name: "Uva Itália", isPackaged: false, erpCode: 1420 },
    { name: "abacate", isPackaged: false, erpCode: 1 },
    { name: "JILO BRANCO WG 300G", isPackaged: true, erpCode: 2604 },
    { name: "Banana", erpCode: 33 },
  ];

  it("põe os embalados depois de todos os outros, cada grupo em A–Z", () => {
    expect(sortForOperationalLists(items).map((i) => i.erpCode)).toEqual([1, 33, 1420, 2604, 2608]);
    expect(compareForOperationalLists({ name: "A", erpCode: 2 }, { name: "a", erpCode: 1 })).toBeGreaterThan(0);
  });

  it("indica onde começa a seção", () => {
    const sorted = sortForOperationalLists(items);
    expect(sorted.map((_, index) => startsPackagedSection(sorted, index))).toEqual([false, false, false, true, false]);
    expect(startsPackagedSection([{ isPackaged: true }], 0)).toBe(true);
    expect(startsPackagedSection([], 0)).toBe(false);
  });
});

describe("Embalados nas listas operacionais", () => {
  const catalog = [
    { id: "w", erpCode: 2608, name: "VAGEM VERDE WG 300G", purchaseFormat: "UND", active: true, isPackaged: true },
    { id: "u", erpCode: 1420, name: "UVA ITALIA", purchaseFormat: "CX", active: true },
    { id: "a", erpCode: 1, name: "ABACATE", purchaseFormat: "CX", active: true },
  ];

  it("Consolidado e relatório A4 trazem os embalados no fim", () => {
    const products = buildConsolidatedProducts(catalog, [], []);
    expect(products.map((p) => p.id)).toEqual(["a", "u", "w"]);
    const model = buildConsolidatedPrintModel({
      cycleDate: "2026-11-13",
      cycles: [],
      stores: [],
      products,
    } as never);
    const rows = [...model.columns[0], ...model.columns[1]];
    expect(rows.map((r) => [r.id, r.isPackaged])).toEqual([["a", false], ["u", false], ["w", true]]);
  });

  it("Perdas: lista A–Z com embalados no fim, também na busca", () => {
    const list = catalog.map((p) => ({ ...p, unit: "KG" }));
    expect(filterLossProducts(list, "").map((p) => p.id)).toEqual(["a", "u", "w"]);
    expect(filterLossProducts(list, "a").map((p) => p.id)).toEqual(["a", "u", "w"]);
  });
});
