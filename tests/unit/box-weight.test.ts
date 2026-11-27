import { describe, expect, it } from "vitest";
import { boxWeightApplies, parseBoxWeightInput, resolveBoxWeight } from "@/modules/purchasing/allocations/domain";

describe("peso da caixa por compra", () => {
  it("vale o da compra, depois o padrão do fornecedor, depois a conversão do produto", () => {
    expect(resolveBoxWeight({ cycleKg: "10.000", supplierKg: "20", productKg: "18", lastKg: "13", supplierLinked: true })).toEqual({
      kg: "10", source: "CYCLE", defaultKg: "20", defaultSource: "SUPPLIER", lastKg: "13", supplierLinked: true,
    });
    expect(resolveBoxWeight({ supplierKg: "20", productKg: "18" })).toMatchObject({ kg: "20", source: "SUPPLIER", defaultKg: "20" });
    expect(resolveBoxWeight({ productKg: "18.000" })).toMatchObject({ kg: "18", source: "PRODUCT", defaultSource: "PRODUCT", supplierLinked: false });
    expect(resolveBoxWeight({ cycleKg: "12.5" })).toMatchObject({ kg: "12.5", source: "CYCLE", defaultKg: null, defaultSource: null });
    expect(resolveBoxWeight({ productKg: "0" })).toMatchObject({ kg: null, source: null });
  });

  it("só se aplica a produto comprado em caixa e vendido em KG", () => {
    expect(boxWeightApplies("CX", "KG")).toBe(true);
    expect(boxWeightApplies("sc", " kg ")).toBe(true);
    expect(boxWeightApplies("KG", "KG")).toBe(false);
    expect(boxWeightApplies("CX", "UND")).toBe(false);
    expect(boxWeightApplies(null, "KG")).toBe(false);
  });

  it("lê o peso digitado com vírgula ou ponto", () => {
    expect(parseBoxWeightInput("10")).toBe(10);
    expect(parseBoxWeightInput(" 12,5 ")).toBe(12.5);
    expect(parseBoxWeightInput("18.25 kg")).toBe(18.25);
    for (const bad of ["", "0", "-3", "abc", "10,1234", "10000"]) {
      expect(() => parseBoxWeightInput(bad)).toThrow();
    }
  });
});
