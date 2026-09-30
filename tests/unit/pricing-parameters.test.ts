import { describe, expect, it } from "vitest";
import {
  authorizePricingManagement,
  authorizeProductManagement,
  authorizePricingProductRead,
  authorizePricingSettingsRead,
  authorizePricingSettingsManagement,
  filterPricingProducts,
  pricingProductMetrics,
  paginatePricingProducts,
  validatePricingSettings,
  validateProductPricing,
  type PricingProduct,
} from "@/modules/pricing/parameters/domain";

const products: PricingProduct[] = [
  { id: "1", erpCode: 1001, name: "BANANA PRATA", catalogUnit: "KG", purchaseFormat: "CX", exclusiveSupplier: false, active: true, productVersion: 1, photoKey: null, photoUpdatedAt: null, saleUnit: "KG", conversionQuantity: "20.000000", conversionOrigin: "PROVISIONAL", beneficiationLossPercent: "0.0000", specificMarginPercent: null, version: 1, updatedAt: "2026-09-23T00:00:00.000Z" },
  { id: "2", erpCode: 1002, name: "ALHO", catalogUnit: "UND", purchaseFormat: "PCT", exclusiveSupplier: true, active: false, productVersion: 1, photoKey: null, photoUpdatedAt: null, saleUnit: "UND", conversionQuantity: "1.000000", conversionOrigin: "UNIT", beneficiationLossPercent: "0.0000", specificMarginPercent: null, version: 1, updatedAt: "2026-09-23T00:00:00.000Z" },
  { id: "3", erpCode: 1003, name: "REPOLHO", catalogUnit: "KG", purchaseFormat: "CX", exclusiveSupplier: false, active: true, productVersion: 2, photoKey: null, photoUpdatedAt: null, saleUnit: "KG", conversionQuantity: "18.000000", conversionOrigin: "MANUAL", beneficiationLossPercent: "40.0000", specificMarginPercent: "25.0000", version: 2, updatedAt: "2026-09-23T00:00:00.000Z" },
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
    expect(filterPricingProducts(products, "", "all", "active")).toHaveLength(2);
    expect(filterPricingProducts(products, "", "all", "inactive")).toHaveLength(1);
    expect(pricingProductMetrics(products)).toEqual({ total: 3, active: 2, inactive: 1, provisional: 1, unit: 1, configured: 1 });
  });

  it("pagina somente depois da busca e dos filtros", () => {
    const catalog = Array.from({ length: 45 }, (_, index) => ({ ...products[0], id: String(index), erpCode: 2000 + index, name: `PRODUTO ${index}` }));
    const page = paginatePricingProducts(filterPricingProducts(catalog, "produto", "all", "active"), 2);
    expect(page.items).toHaveLength(20);
    expect(page.start).toBe(20);
    expect(page.end).toBe(40);
    expect(page.total).toBe(45);
  });

  it("autoriza somente Gestor", () => {
    const gestorPricing = { userId: "g", role: "GESTOR" as const, storeId: null, permissions: ["gestor:precificacao" as const] };
    const gestorProducts = { userId: "gp", role: "GESTOR" as const, storeId: null, permissions: ["gestor:produtos" as const] };
    const gestorSettings = { userId: "gs", role: "GESTOR" as const, storeId: null, permissions: ["gestor:configuracoes" as const] };
    const comprador = { userId: "c", role: "COMPRADOR" as const, storeId: null, permissions: ["compras:consolidado" as const, "compras:custos" as const] };
    const loja = { userId: "l", role: "LOJA" as const, storeId: "s", permissions: ["pedidos:criar" as const, "pedidos:historico" as const] };

    expect(() => authorizePricingManagement(gestorPricing)).not.toThrow();
    expect(() => authorizePricingManagement(gestorProducts)).toThrow(/Gestor/);
    expect(() => authorizePricingManagement(comprador)).toThrow(/Gestor/);
    expect(() => authorizePricingManagement(loja)).toThrow(/Gestor/);

    expect(() => authorizeProductManagement(gestorProducts)).not.toThrow();
    expect(() => authorizeProductManagement(gestorPricing)).toThrow(/Gestor/);

    expect(() => authorizePricingProductRead(gestorProducts)).not.toThrow();
    expect(() => authorizePricingProductRead(gestorPricing)).not.toThrow();
    expect(() => authorizePricingProductRead(comprador)).toThrow(/Gestor/);

    expect(() => authorizePricingSettingsRead(gestorProducts)).not.toThrow();
    expect(() => authorizePricingSettingsRead(gestorPricing)).not.toThrow();
    expect(() => authorizePricingSettingsRead(gestorSettings)).not.toThrow();
    expect(() => authorizePricingSettingsRead(comprador)).toThrow(/Gestor/);

    expect(() => authorizePricingSettingsManagement(gestorSettings)).not.toThrow();
    expect(() => authorizePricingSettingsManagement(gestorPricing)).toThrow(/Gestor/);
  });
});
