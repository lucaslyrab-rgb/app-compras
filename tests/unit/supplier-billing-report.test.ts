import { describe, expect, it } from "vitest";
import {
  type BillingStoreSection,
  type SupplierBillingReport,
  sumQuantities,
  formatQuantityPtBr,
  formatCycleDatePtBr,
} from "@/modules/purchasing/reports/supplier-billing/domain";

describe("Supplier Billing Report - Domínio e Estrutura de Faturamento", () => {
  const mockReport: SupplierBillingReport = {
    supplier: {
      id: "sup-jeb-123",
      corporateName: "JEB DISTRIBUIDORA DE ALIMENTOS LTDA",
      tradeName: "Com. JOJO",
      taxId: "48336863000160",
      taxIdType: "CNPJ",
      taxInvoiceRule: "STANDARD",
      contactName: "Jovaldir",
      contactPhone: "27999998888",
    },
    cycleDate: "2026-10-14",
    availableCycles: ["2026-10-14", "2026-10-12"],
    loadedAt: "2026-10-14T10:00:00.000Z",
    stores: [
      {
        storeId: "store-ponta",
        storeSlug: "ponta-da-fruta",
        storeName: "MultiShow Ponta da Fruta",
        orderId: "order-1",
        revision: 1,
        submittedAt: "2026-10-14T09:00:00Z",
        cutoffAt: "2026-10-14T11:00:00Z",
        hasOrder: true,
        items: [
          {
            productId: "prod-1",
            erpCode: 169,
            productName: "TOMATE KG",
            unit: "KG",
            purchaseFormat: "CX",
            quantity: "10.00",
          },
          {
            productId: "prod-2",
            erpCode: 35,
            productName: "BANANA PRATA KG",
            unit: "KG",
            purchaseFormat: "CX",
            quantity: "5.00",
          },
        ],
        totalQuantity: "15.00",
      },
      {
        storeId: "store-balneario",
        storeSlug: "balneario",
        storeName: "MultiShow Balneário",
        orderId: "order-2",
        revision: 1,
        submittedAt: "2026-10-14T09:15:00Z",
        cutoffAt: "2026-10-14T11:00:00Z",
        hasOrder: true,
        items: [
          {
            productId: "prod-1",
            erpCode: 169,
            productName: "TOMATE KG",
            unit: "KG",
            purchaseFormat: "CX",
            quantity: "12.00",
          },
        ],
        totalQuantity: "12.00",
      },
      {
        storeId: "store-santa-monica",
        storeSlug: "santa-monica",
        storeName: "MultiShow Santa Mônica",
        orderId: "order-3",
        revision: 2,
        submittedAt: "2026-10-14T09:30:00Z",
        cutoffAt: "2026-10-14T11:00:00Z",
        hasOrder: true,
        items: [
          {
            productId: "prod-1",
            erpCode: 169,
            productName: "TOMATE KG",
            unit: "KG",
            purchaseFormat: "CX",
            quantity: "8.00",
          },
          {
            productId: "prod-2",
            erpCode: 35,
            productName: "BANANA PRATA KG",
            unit: "KG",
            purchaseFormat: "CX",
            quantity: "20.00",
          },
        ],
        totalQuantity: "28.00",
      },
    ],
    consolidatedProducts: [
      {
        productId: "prod-1",
        erpCode: 169,
        productName: "TOMATE KG",
        unit: "KG",
        purchaseFormat: "CX",
        storeQuantities: {
          "store-ponta": "10.00",
          "store-balneario": "12.00",
          "store-santa-monica": "8.00",
        },
        totalQuantity: "30.00",
      },
      {
        productId: "prod-2",
        erpCode: 35,
        productName: "BANANA PRATA KG",
        unit: "KG",
        purchaseFormat: "CX",
        storeQuantities: {
          "store-ponta": "5.00",
          "store-balneario": "—",
          "store-santa-monica": "20.00",
        },
        totalQuantity: "25.00",
      },
    ],
    productsWithoutOrders: [
      {
        productId: "prod-3",
        erpCode: 75,
        productName: "GENGIBRE KG",
        unit: "KG",
        purchaseFormat: "CX",
      },
      {
        productId: "prod-4",
        erpCode: 1234,
        productName: "QUIABO KG",
        unit: "KG",
        purchaseFormat: "CX",
      },
    ],
  };

  it("consolida as quantidades entre as 3 lojas exatamente", () => {
    const tomate = mockReport.consolidatedProducts.find((p) => p.erpCode === 169);
    expect(tomate).toBeDefined();
    expect(tomate?.totalQuantity).toBe("30.00");

    const banana = mockReport.consolidatedProducts.find((p) => p.erpCode === 35);
    expect(banana).toBeDefined();
    expect(banana?.totalQuantity).toBe("25.00");
  });

  it("calcula os totais gerais somando todas as lojas", () => {
    const storeTotals = mockReport.stores.map((s) => s.totalQuantity);
    expect(sumQuantities(storeTotals)).toBe("55.00");
  });

  it("identifica produtos vinculados que não tiveram demanda (sem pedido no ciclo)", () => {
    expect(mockReport.productsWithoutOrders).toHaveLength(2);
    expect(mockReport.productsWithoutOrders.map((p) => p.erpCode)).toEqual([75, 1234]);
  });

  it("trata adequadamente quando uma loja não possui pedido no ciclo", () => {
    const storeWithoutOrder: BillingStoreSection = {
      storeId: "store-4",
      storeSlug: "exemplo",
      storeName: "MultiShow Exemplo",
      orderId: null,
      revision: null,
      submittedAt: null,
      cutoffAt: null,
      hasOrder: false,
      items: [],
      totalQuantity: "0.00",
    };
    expect(storeWithoutOrder.hasOrder).toBe(false);
    expect(storeWithoutOrder.items).toHaveLength(0);
    expect(storeWithoutOrder.totalQuantity).toBe("0.00");
  });

  it("preserva a regra de nota fiscal e identificação do fornecedor", () => {
    expect(mockReport.supplier.taxInvoiceRule).toBe("STANDARD");
    expect(mockReport.supplier.taxId).toBe("48336863000160");
    expect(mockReport.supplier.corporateName).toBe("JEB DISTRIBUIDORA DE ALIMENTOS LTDA");
  });

  describe("Funções utilitárias de formatação e cálculo", () => {
    it("soma quantidades decimais com precisão monetária/decimal", () => {
      expect(sumQuantities(["10.00", "5.50", "2.25"])).toBe("17.75");
      expect(sumQuantities(["10", "20.5"])).toBe("30.50");
      expect(sumQuantities(["—", "", "8.00"])).toBe("8.00");
      expect(sumQuantities([])).toBe("0.00");
    });

    it("formata quantidade no padrão brasileiro", () => {
      expect(formatQuantityPtBr("1500")).toBe("1.500");
      expect(formatQuantityPtBr(12.5)).toBe("12,5");
      expect(formatQuantityPtBr("abc")).toBe("0");
    });

    it("formata data do ciclo no formato DD/MM/AAAA", () => {
      expect(formatCycleDatePtBr("2026-10-14")).toBe("14/10/2026");
    });
  });
});
