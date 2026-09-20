import { describe, expect, it } from "vitest";
import { readProducts } from "../../scripts/import-products";

describe("importador oficial", () => {
  it("lê 74 produtos e 21 exclusivos", async () => {
    const products = await readProducts("base_produtos_atual.xlsx");
    expect(products).toHaveLength(74);
    expect(products.filter((product) => product.exclusiveSupplier)).toHaveLength(21);
    expect(new Set(products.map((product) => product.erpCode)).size).toBe(74);
  });
});
