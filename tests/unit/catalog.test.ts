import { describe, expect, it } from "vitest";
import { authorizeProductManagement, normalizeProduct, productInput } from "@/modules/catalog/domain";

describe("catálogo", () => {
  it("normaliza produto preservando unidade e formato independentes", () => {
    const product = normalizeProduct({ erpCode: 1, name: "Banana prata", unit: "kg", purchaseFormat: "cx", markup: 100, exclusiveSupplier: true });
    expect(product).toEqual({ erpCode: 1, name: "BANANA PRATA", unit: "KG", purchaseFormat: "CX", markup: 100, exclusiveSupplier: true });
  });

  it("rejeita código e markup inválidos", () => {
    expect(() => productInput.parse({ erpCode: 0, name: "X", unit: "", purchaseFormat: "", markup: -1, exclusiveSupplier: false })).toThrow();
  });

  it("restringe manutenção ao Gestor", () => {
    expect(() => authorizeProductManagement({ userId: "u", role: "GESTOR", storeId: null })).not.toThrow();
    expect(() => authorizeProductManagement({ userId: "u", role: "COMPRADOR", storeId: null })).toThrow(/Gestor/);
  });
});
