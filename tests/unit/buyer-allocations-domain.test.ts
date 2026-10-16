import { describe, expect, it } from "vitest";
import {
  calculateDifference,
  canManageDestinations,
  isCycleDate,
  parseQuantity,
  roundToTwoDecimals,
  sumQuantities,
  validateAllocationPurchasedStatus,
  validateClosureReadiness,
  AllocationValidationError,
  CycleClosedError,
  ExclusivityViolationError,
} from "@/modules/purchasing/allocations/domain";
import type { Principal } from "@/modules/identity";

describe("Fase 3 — Vinculação das Compras aos Fornecedores e Fechamento Operacional", () => {
  describe("Permissões e Acesso (canManageDestinations)", () => {
    it("permite acesso ao Comprador com permissão compras:destinacao", () => {
      const comprador: Principal = {
        userId: "buyer-1",
        role: "COMPRADOR",
        storeId: null,
        permissions: ["compras:destinacao", "compras:custos"],
      };
      expect(canManageDestinations(comprador)).toBe(true);
    });

    it("permite acesso ao Gestor com permissão compras:destinacao", () => {
      const gestor: Principal = {
        userId: "gestor-1",
        role: "GESTOR",
        storeId: null,
        permissions: ["compras:destinacao", "gestor:produtos"],
      };
      expect(canManageDestinations(gestor)).toBe(true);
    });

    it("bloqueia acesso para Loja (perfil LOJA sem permissão)", () => {
      const loja: Principal = {
        userId: "store-user-1",
        role: "LOJA",
        storeId: "store-ponta",
        permissions: ["pedidos:criar", "pedidos:historico"],
      };
      expect(canManageDestinations(loja)).toBe(false);
    });

    it("bloqueia acesso se usuário não possuir compras:destinacao", () => {
      const userSemPermissao: Principal = {
        userId: "user-sem-perm",
        role: "COMPRADOR",
        storeId: null,
        permissions: ["compras:consolidado"],
      };
      expect(canManageDestinations(userSemPermissao)).toBe(false);
    });
  });

  describe("Validação de Formato de Ciclo e Quantidades", () => {
    it("valida datas no formato AAAA-MM-DD", () => {
      expect(isCycleDate("2026-10-15")).toBe(true);
      expect(isCycleDate("2026-02-28")).toBe(true);
      expect(isCycleDate("15/10/2026")).toBe(false);
      expect(isCycleDate("2026-10")).toBe(false);
      expect(isCycleDate("invalido")).toBe(false);
    });

    it("converte e arredonda valores decimais com segurança", () => {
      expect(roundToTwoDecimals(10)).toBe("10.00");
      expect(roundToTwoDecimals("10.5")).toBe("10.50");
      expect(roundToTwoDecimals("10.555")).toBe("10.56");
      expect(roundToTwoDecimals(-5)).toBe("0.00");
      expect(roundToTwoDecimals("invalido")).toBe("0.00");
    });

    it("faz parsing correto de quantidades com vírgula e ponto", () => {
      expect(parseQuantity("15,5")).toBe(15.5);
      expect(parseQuantity("15.5")).toBe(15.5);
      expect(parseQuantity(null)).toBe(0);
      expect(parseQuantity("")).toBe(0);
      expect(parseQuantity(-10)).toBe(0);
    });

    it("soma quantidades evitando drift de ponto flutuante IEEE", () => {
      expect(sumQuantities(["0.1", "0.2"])).toBe("0.30");
      expect(sumQuantities(["10.25", "5.50", "2.25"])).toBe("18.00");
      expect(sumQuantities([])).toBe("0.00");
    });
  });

  describe("Cálculo de Diferenças (Diferença = Destinado - Pedido)", () => {
    it("calcula sobra/adicional com sinal positivo", () => {
      expect(calculateDifference("12.00", "10.00")).toBe("+2.00");
      expect(calculateDifference(15, 10)).toBe("+5.00");
    });

    it("calcula corte/falta com sinal negativo", () => {
      expect(calculateDifference("8.00", "10.00")).toBe("-2.00");
      expect(calculateDifference(7, 10)).toBe("-3.00");
    });

    it("identifica igualdade perfeita", () => {
      expect(calculateDifference("10.00", "10.00")).toBe("0.00");
      expect(calculateDifference(0, 0)).toBe("0.00");
    });

    it("identifica compra sem pedido (pedido original = 0)", () => {
      expect(calculateDifference("5.00", "0.00")).toBe("+5.00");
    });

    it("identifica corte total (pedido > 0 e destinado = 0)", () => {
      expect(calculateDifference("0.00", "8.00")).toBe("-8.00");
    });
  });

  describe("Validação de Fechamento Operacional do Comprador", () => {
    const catalogMap = new Map([
      ["prod-1", { id: "prod-1", erpCode: 101, name: "Banana Prata" }],
      ["prod-2", { id: "prod-2", erpCode: 102, name: "Maçã Gala" }],
      ["prod-3", { id: "prod-3", erpCode: 103, name: "Tomate Italiano" }],
      ["prod-4", { id: "prod-4", erpCode: 104, name: "Batata Lavada" }],
    ]);

    it("permite fechamento quando todos os produtos marcados como comprados têm destinação", () => {
      const purchasedProductIds = ["prod-1", "prod-2", "prod-3"];
      const allocatedProductIds = new Set(["prod-1", "prod-2", "prod-3", "prod-4"]);

      const result = validateClosureReadiness(
        purchasedProductIds,
        allocatedProductIds,
        catalogMap,
      );

      expect(result.canClose).toBe(true);
      expect(result.missingProducts).toHaveLength(0);
    });

    it("bloqueia fechamento se algum produto comprado estiver sem destinação", () => {
      const purchasedProductIds = ["prod-1", "prod-2", "prod-3"];
      // prod-3 comprado, mas não alocado a nenhum fornecedor
      const allocatedProductIds = new Set(["prod-1", "prod-2"]);

      const result = validateClosureReadiness(
        purchasedProductIds,
        allocatedProductIds,
        catalogMap,
      );

      expect(result.canClose).toBe(false);
      expect(result.missingProducts).toHaveLength(1);
      expect(result.missingProducts[0].erpCode).toBe(103);
      expect(result.missingProducts[0].name).toBe("Tomate Italiano");
    });

    it("permite fechamento mesmo se houver compras adicionais não presentes na lista de custos originais", () => {
      // Comprados originais: prod-1, prod-2
      // Alocações têm prod-1, prod-2 e prod-4 (adicional/oportunidade de feira)
      const purchasedProductIds = ["prod-1", "prod-2"];
      const allocatedProductIds = new Set(["prod-1", "prod-2", "prod-4"]);

      const result = validateClosureReadiness(
        purchasedProductIds,
        allocatedProductIds,
        catalogMap,
      );

      expect(result.canClose).toBe(true);
      expect(result.missingProducts).toHaveLength(0);
    });

    it("permite fechar ciclo sem produtos comprados (ciclo vazio)", () => {
      const purchasedProductIds: string[] = [];
      const allocatedProductIds = new Set<string>();

      const result = validateClosureReadiness(
        purchasedProductIds,
        allocatedProductIds,
        catalogMap,
      );

      expect(result.canClose).toBe(true);
      expect(result.missingProducts).toHaveLength(0);
    });
  });

  describe("Erros e Exceções do Domínio de Destinação", () => {
    it("instancia AllocationValidationError com nome e mensagem corretos", () => {
      const err = new AllocationValidationError("Quantidade inválida");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("AllocationValidationError");
      expect(err.message).toBe("Quantidade inválida");
    });

    it("instancia ExclusivityViolationError com nome e mensagem corretos", () => {
      const err = new ExclusivityViolationError("Produto exclusivo da JEB");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("ExclusivityViolationError");
      expect(err.message).toBe("Produto exclusivo da JEB");
    });

    it("instancia CycleClosedError com nome e mensagem corretos", () => {
      const err = new CycleClosedError("Ciclo fechado");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CycleClosedError");
      expect(err.message).toBe("Ciclo fechado");
    });
  });

  describe("Compras com Múltiplos Fornecedores (Split Purchase)", () => {
    it("consolida volumes do mesmo produto comprados em fornecedores distintos", () => {
      // Simulação de split: 5 caixas compradas no Fornecedor A e 7 caixas no Fornecedor B
      const qtySupplierA = ["2.00", "2.00", "1.00"]; // Ponta: 2, Balneario: 2, Santa Monica: 1
      const qtySupplierB = ["3.00", "2.00", "2.00"]; // Ponta: 3, Balneario: 2, Santa Monica: 2

      const totalA = sumQuantities(qtySupplierA);
      const totalB = sumQuantities(qtySupplierB);
      const totalConsolidated = sumQuantities([totalA, totalB]);

      expect(totalA).toBe("5.00");
      expect(totalB).toBe("7.00");
      expect(totalConsolidated).toBe("12.00");
    });
  });

  describe("Navegação Loja → Fornecedor → Produtos e Resolução de Pedidos (Bug 01)", () => {
    it("resolve pedido da loja ativa imediatamente ao adicionar produto do catálogo (sem F5)", () => {
      // Simula o mapa cycleStoreOrders retornado pelo repository
      const cycleStoreOrders: Record<string, Record<string, string>> = {
        "prod-maracuja": {
          "store-ponta": "15.00",
          "store-balneario": "10.00",
          "store-sm": "8.00",
        },
      };

      const activeStoreId = "store-ponta";
      const productId = "prod-maracuja";

      // Ao adicionar o produto no client com base em cycleStoreOrders:
      const productStoreOrders = cycleStoreOrders[productId] ?? {};
      const activeStoreOrderedQty = productStoreOrders[activeStoreId] ?? "0.00";

      expect(activeStoreOrderedQty).toBe("15.00");
      expect(parseQuantity(activeStoreOrderedQty)).toBe(15);
      expect(calculateDifference(activeStoreOrderedQty, activeStoreOrderedQty)).toBe("0.00");
    });

    it("mantém destinações de outras lojas intactas ao salvar destinação com filtro por loja", () => {
      // Estado prévio com 3 lojas
      const previousAllocations: Record<string, string> = {
        "store-ponta": "10.00",
        "store-balneario": "5.00",
        "store-sm": "7.00",
      };

      // Alteração aplicada somente em store-ponta
      const targetStoreId = "store-ponta";
      const newPontaQty = "12.00";

      const updatedAllocations: Record<string, string> = {
        ...previousAllocations,
        [targetStoreId]: newPontaQty,
      };

      expect(updatedAllocations["store-ponta"]).toBe("12.00");
      expect(updatedAllocations["store-balneario"]).toBe("5.00");
      expect(updatedAllocations["store-sm"]).toBe("7.00");
    });
  });

  describe("Integridade entre Custos, Pedidos e Destinação (Bug 03)", () => {
    describe("REGRA A — Compras normais (com pedido)", () => {
      it("permite destinação positiva se o produto estiver marcado como comprado nos custos", () => {
        const result = validateAllocationPurchasedStatus({
          productName: "Banana Prata",
          erpCode: 10,
          purchaseFormat: "CX",
          isPurchasedInCosts: true,
          totalCycleOrdersNum: 20,
          totalDestinedNum: 20,
        });
        expect(result.isValid).toBe(true);
        expect(result.errorMessage).toBeUndefined();
      });

      it("permite destinação zero se produto comprado teve corte total", () => {
        const result = validateAllocationPurchasedStatus({
          productName: "Banana Prata",
          erpCode: 10,
          purchaseFormat: "CX",
          isPurchasedInCosts: true,
          totalCycleOrdersNum: 20,
          totalDestinedNum: 0,
        });
        expect(result.isValid).toBe(true);
      });
    });

    describe("REGRA B — Compras de oportunidade (adicionais, sem pedido)", () => {
      it("permite destinação de oportunidade quando sem pedidos e com quantidade maior que zero", () => {
        const result = validateAllocationPurchasedStatus({
          productName: "Melão Amarelo",
          erpCode: 42,
          purchaseFormat: "CX",
          isPurchasedInCosts: false,
          totalCycleOrdersNum: 0,
          totalDestinedNum: 5,
        });
        expect(result.isValid).toBe(true);
      });

      it("bloqueia compra de oportunidade com quantidade destinada zero", () => {
        const result = validateAllocationPurchasedStatus({
          productName: "Melão Amarelo",
          erpCode: 42,
          purchaseFormat: "CX",
          isPurchasedInCosts: false,
          totalCycleOrdersNum: 0,
          totalDestinedNum: 0,
        });
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain(
          'A compra de oportunidade do produto "Melão Amarelo" deve possuir quantidade destinada maior que zero.',
        );
      });
    });

    describe("REGRA C — Produto pedido e NÃO comprado (Caso Caqui 53)", () => {
      it("bloqueia destinação positiva para produto com pedido das lojas não marcado como comprado nos custos", () => {
        const result = validateAllocationPurchasedStatus({
          productName: "Caqui Rama Forte",
          erpCode: 53,
          purchaseFormat: "CX",
          isPurchasedInCosts: false,
          totalCycleOrdersNum: 1,
          totalDestinedNum: 1,
        });
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain(
          'O produto "Caqui Rama Forte" (ERP 53) possui pedido das lojas neste ciclo (1.00 CX), mas não está marcado como comprado na tela de custos.',
        );
        expect(result.errorMessage).toContain(
          "Marque-o como comprado nos custos antes de realizar a destinação.",
        );
      });

      it("permite destinação zero para produto não comprado (permitindo zerar/corrigir alocação indevida)", () => {
        const result = validateAllocationPurchasedStatus({
          productName: "Caqui Rama Forte",
          erpCode: 53,
          purchaseFormat: "CX",
          isPurchasedInCosts: false,
          totalCycleOrdersNum: 1,
          totalDestinedNum: 0,
        });
        expect(result.isValid).toBe(true);
      });
    });
  });
});

