import { describe, expect, it } from "vitest";
import { initialPricingParameters, readProducts } from "../../scripts/import-products";

describe("importador oficial", () => {
  it("lê 74 produtos e 21 exclusivos", async () => {
    const products = await readProducts("base_produtos_atual.xlsx");
    expect(products).toHaveLength(74);
    expect(products.filter((product) => product.exclusiveSupplier)).toHaveLength(21);
    expect(new Set(products.map((product) => product.erpCode)).size).toBe(74);
  });

  it("define parâmetros iniciais sem inventar conversão para formato desconhecido", () => {
    expect(initialPricingParameters("CX")).toEqual({ saleUnit: "KG", conversionQuantity: "20", conversionOrigin: "PROVISIONAL" });
    expect(initialPricingParameters("SC")).toEqual({ saleUnit: "KG", conversionQuantity: "20", conversionOrigin: "PROVISIONAL" });
    for (const format of ["UND", "PCT", "BDJ"])
      expect(initialPricingParameters(format)).toEqual({ saleUnit: "UND", conversionQuantity: "1", conversionOrigin: "UNIT" });
    expect(() => initialPricingParameters("DZ")).toThrow(/sem conversão inicial/i);
  });
});
