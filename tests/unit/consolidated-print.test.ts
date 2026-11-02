import { describe, expect, it } from "vitest";
import {
  COMPACT_ROWS_PER_COLUMN,
  buildConsolidatedPrintModel,
  storeInitials,
} from "@/modules/purchasing/reports/consolidated-print/domain";
import type { ConsolidatedData } from "@/modules/purchasing/domain";

const stores = [
  { id: "pf", slug: "ponta-da-fruta", name: "MultiShow Ponta da Fruta", order: { id: "o1", revision: 1, submittedAt: "2026-10-30T21:07:00Z" } },
  { id: "ba", slug: "balneario", name: "MultiShow Balneário", order: { id: "o2", revision: 1, submittedAt: "2026-10-30T19:20:00Z" } },
  { id: "sm", slug: "santa-monica", name: "MultiShow Santa Mônica", order: null },
] as unknown as ConsolidatedData["stores"];

function product(id: string, name: string, quantities: [string | null, string | null, string | null], format = "CX") {
  const values = quantities.map((q) => (q === null ? null : { stock: "0", quantity: q }));
  const total = quantities.reduce((sum, q) => sum + Number(q ?? 0), 0);
  return {
    id,
    erpCode: Number(id.replace(/\D/g, "")) || 1,
    name,
    purchaseFormat: format,
    active: true,
    stores: { pf: values[0], ba: values[1], sm: values[2] },
    total: String(total),
  };
}

function data(products: ReturnType<typeof product>[]): ConsolidatedData {
  return { cycleDate: "2026-11-03", cycles: ["2026-11-03"], stores, products, loadedAt: "2026-11-02T13:00:00Z" } as ConsolidatedData;
}

describe("relatório A4 do Consolidado", () => {
  it("gera as siglas das lojas como na folha de papel", () => {
    expect(stores.map((s) => storeInitials(s.name))).toEqual(["PF", "BA", "SM"]);
  });

  it("imprime todos os produtos em ordem alfabética, em duas colunas", () => {
    const model = buildConsolidatedPrintModel(
      data([
        product("p3", "Tomate", ["8", "0", null]),
        product("p1", "Abacate", ["1", "1", null]),
        product("p2", "Maçã Gala", [null, null, null]),
      ]),
    );
    expect(model.columns[0].map((r) => r.name)).toEqual(["Abacate", "Maçã Gala"]);
    expect(model.columns[1].map((r) => r.name)).toEqual(["Tomate"]);
    expect(model.totalProducts).toBe(3);
    expect(model.productsWithOrder).toBe(2);
    expect(model.stores.map((s) => [s.initials, s.sent])).toEqual([["PF", true], ["BA", true], ["SM", false]]);
  });

  it("zero e produto não informado viram traço; total com unidade", () => {
    const model = buildConsolidatedPrintModel(data([product("p1", "Tomate", ["8", "0", null])]));
    expect(model.columns[0][0]).toMatchObject({ quantities: [8, null, null], total: 8, unit: "CX" });
  });

  it("compacta a fonte quando a coluna passa do limite", () => {
    const many = Array.from({ length: COMPACT_ROWS_PER_COLUMN * 2 + 2 }, (_, i) =>
      product(`p${i + 1}`, `Produto ${String(i).padStart(3, "0")}`, [null, null, null]),
    );
    expect(buildConsolidatedPrintModel(data(many)).density).toBe("compact");
    expect(buildConsolidatedPrintModel(data(many.slice(0, 76))).density).toBe("normal");
  });
});
