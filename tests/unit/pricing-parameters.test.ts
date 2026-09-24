import { describe, expect, it } from "vitest";
import {
  authorizePricingManagement,
  filterPricingProducts,
  pricingProductMetrics,
  validatePricingSettings,
  validateProductPricing,
  type PricingProduct,
} from "@/modules/pricing/parameters/domain";

const products: PricingProduct[] = [
  { id: "1", erpCode: 1001, name: "BANANA PRATA", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: "20.000000", conversionOrigin: "PROVISIONAL", beneficiationLossPercent: "0.0000", specificMarginPercent: null, version: 1, updatedAt: "2026-09-23T00:00:00.000Z" },
  { id: "2", erpCode: 1002, name: "ALHO", purchaseFormat: "PCT", saleUnit: "UND", conversionQuantity: "1.000000", conversionOrigin: "UNIT", beneficiationLossPercent: "0.0000", specificMarginPercent: null, version: 1, updatedAt: "2026-09-23T00:00:00.000Z" },
  { id: "3", erpCode: 1003, name: "REPOLHO", purchaseFormat: "CX", saleUnit: "KG", conversionQuantity: "18.000000", conversionOrigin: "MANUAL", beneficiationLossPercent: "40.0000", specificMarginPercent: "25.0000", version: 2, updatedAt: "2026-09-23T00:00:00.000Z" },
];

describe("parâmetros de precificação", () => {
  it("normaliza entradas válidas e permite margem global", () => {
    expect(validateProductPricing({ saleUnit: "kg", conversionQuantity: "20,5", beneficiationLossPercent: "40", specificMarginPercent: null })).toEqual({
      saleUnit: "KG",
      conversionQuantity: "20.500000",
      beneficiationLossPercent: "40.0000",
      specificMarginPercent: null,
    });
  });

  it("rejeita limites inválidos", () => {
    expect(() => validateProductPricing({ saleUnit: "KG", conversionQuantity: "0", beneficiationLossPercent: "0", specificMarginPercent: null })).toThrow(/maior que zero/i);
    expect(() => validateProductPricing({ saleUnit: "KG", conversionQuantity: "20", beneficiationLossPercent: "100", specificMarginPercent: null })).toThrow(/perda/i);
    expect(() => validateProductPricing({ saleUnit: "KG", conversionQuantity: "20", beneficiationLossPercent: "0", specificMarginPercent: "-1" })).toThrow(/margem/i);
    expect(() => validatePricingSettings({ operatingCostPercent: "80", defaultMarginPercent: "20" })).toThrow(/menos de 100/i);
  });

  it("filtra por nome, ERP, formato e origem", () => {
    expect(filterPricingProducts(products, "banana", "all")).toHaveLength(1);
    expect(filterPricingProducts(products, "1002", "all")).toHaveLength(1);
    expect(filterPricingProducts(products, "pct", "unit")).toHaveLength(1);
    expect(filterPricingProducts(products, "", "configured")).toHaveLength(1);
    expect(pricingProductMetrics(products)).toEqual({ total: 3, provisional: 1, unit: 1, configured: 1 });
  });

  it("autoriza somente Gestor", () => {
    expect(() => authorizePricingManagement({ userId: "g", role: "GESTOR", storeId: null })).not.toThrow();
    expect(() => authorizePricingManagement({ userId: "c", role: "COMPRADOR", storeId: null })).toThrow(/Gestor/);
    expect(() => authorizePricingManagement({ userId: "l", role: "LOJA", storeId: "s" })).toThrow(/Gestor/);
  });
});
