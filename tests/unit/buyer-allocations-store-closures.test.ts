import { describe, expect, it } from "vitest";
import {
  calculateStoreCutSummary,
  computeStoreAllocationsHash,
  validateCycleClosureReadinessStoreFirst,
  type StoreClosureSummary,
  type StoreInfo,
} from "@/modules/purchasing/allocations/domain";

describe("Fase 3 — Store-First Closures & Cut Summary Domain Tests", () => {
  const stores: StoreInfo[] = [
    { id: "store-ponta", slug: "ponta-da-fruta", name: "MultiShow Ponta da Fruta" },
    { id: "store-balneario", slug: "balneario", name: "MultiShow Balneário" },
    { id: "store-santa-monica", slug: "santa-monica", name: "MultiShow Santa Mônica" },
  ];

  describe("computeStoreAllocationsHash", () => {
    it("gera hash determinístico independente da ordem dos itens", () => {
      const allocsA = [
        { productId: "p1", supplierId: "s1", destinedQuantity: "10.00" },
        { productId: "p2", supplierId: "s2", destinedQuantity: "5.50" },
      ];
      const allocsB = [
        { productId: "p2", supplierId: "s2", destinedQuantity: "5.50" },
        { productId: "p1", supplierId: "s1", destinedQuantity: "10.00" },
      ];

      expect(computeStoreAllocationsHash(allocsA)).toBe(computeStoreAllocationsHash(allocsB));
    });

    it("altera o hash quando a quantidade destinada muda", () => {
      const allocsBefore = [{ productId: "p1", supplierId: "s1", destinedQuantity: "10.00" }];
      const allocsAfter = [{ productId: "p1", supplierId: "s1", destinedQuantity: "8.00" }];

      expect(computeStoreAllocationsHash(allocsBefore)).not.toBe(
        computeStoreAllocationsHash(allocsAfter),
      );
    });

    it("altera o hash quando o fornecedor muda", () => {
      const allocsBefore = [{ productId: "p1", supplierId: "s1", destinedQuantity: "10.00" }];
      const allocsAfter = [{ productId: "p1", supplierId: "s2", destinedQuantity: "10.00" }];

      expect(computeStoreAllocationsHash(allocsBefore)).not.toBe(
        computeStoreAllocationsHash(allocsAfter),
      );
    });
  });

  describe("calculateStoreCutSummary", () => {
    it("calcula corte parcial de Cenoura e corte total de Banana Prata conforme especificação da Fase 3", () => {
      const orderedItems = [
        {
          productId: "prod-cenoura",
          erpCode: 42,
          productName: "CENOURA",
          purchaseFormat: "CX",
          orderedQuantity: "4.00",
        },
        {
          productId: "prod-banana-prata",
          erpCode: 35,
          productName: "BANANA PRATA",
          purchaseFormat: "CX",
          orderedQuantity: "8.00",
        },
        {
          productId: "prod-tomate",
          erpCode: 10,
          productName: "TOMATE",
          purchaseFormat: "CX",
          orderedQuantity: "10.00",
        },
      ];

      // Balneário: 2 CX de Cenoura (de 4), 0 CX de Banana Prata (de 8), 10 CX de Tomate (de 10)
      const storeAllocationsByProduct = new Map<string, string>([
        ["prod-cenoura", "2.00"],
        ["prod-banana-prata", "0.00"],
        ["prod-tomate", "10.00"],
      ]);

      const result = calculateStoreCutSummary({
        orderedItems,
        storeAllocationsByProduct,
      });

      expect(result.totalOrderedItems).toBe(3);
      expect(result.totalDestinedItems).toBe(2); // Cenoura e Tomate têm > 0
      expect(result.totalCutItems).toBe(2); // Cenoura (parcial) e Banana Prata (total)

      const cenoura = result.cuts.find((c) => c.productId === "prod-cenoura");
      expect(cenoura).toBeDefined();
      expect(cenoura?.status).toBe("PARTIAL_CUT");
      expect(cenoura?.cutQuantity).toBe("2.00");
      expect(cenoura?.destinedQuantity).toBe("2.00");

      const banana = result.cuts.find((c) => c.productId === "prod-banana-prata");
      expect(banana).toBeDefined();
      expect(banana?.status).toBe("TOTAL_CUT");
      expect(banana?.cutQuantity).toBe("8.00");
      expect(banana?.destinedQuantity).toBe("0.00");

      const tomate = result.cuts.find((c) => c.productId === "prod-tomate");
      expect(tomate).toBeDefined();
      expect(tomate?.status).toBe("FULFILLED");
      expect(tomate?.cutQuantity).toBe("0.00");
      expect(tomate?.destinedQuantity).toBe("10.00");
    });

    it("inclui compra de oportunidade / adicional destinada à loja sem pedido original", () => {
      const orderedItems = [
        {
          productId: "prod-uva",
          erpCode: 180,
          productName: "UVA VITORIA",
          purchaseFormat: "CX",
          orderedQuantity: "5.00",
        },
      ];

      const storeAllocationsByProduct = new Map<string, string>([
        ["prod-uva", "5.00"],
        ["prod-manga-palmer", "3.00"], // Não solicitada no pedido original
      ]);

      const catalogMap = new Map([
        [
          "prod-manga-palmer",
          { erpCode: 99, name: "MANGA PALMER", purchaseFormat: "CX" },
        ],
      ]);

      const result = calculateStoreCutSummary({
        orderedItems,
        storeAllocationsByProduct,
        catalogMap,
      });

      expect(result.cuts).toHaveLength(2);
      const opp = result.cuts.find((c) => c.productId === "prod-manga-palmer");
      expect(opp).toBeDefined();
      expect(opp?.status).toBe("ADDITIONAL");
      expect(opp?.orderedQuantity).toBe("0.00");
      expect(opp?.destinedQuantity).toBe("3.00");
      expect(opp?.cutQuantity).toBe("0.00");
    });
  });

  describe("validateCycleClosureReadinessStoreFirst — Regra Estrita Store-First", () => {
    const catalogMap = new Map([
      ["prod-banana-prata", { id: "prod-banana-prata", erpCode: 35, name: "BANANA PRATA" }],
      ["prod-cenoura", { id: "prod-cenoura", erpCode: 42, name: "CENOURA" }],
    ]);

    it("CENÁRIO DA AUDITORIA CODEX: Banana Prata destinada apenas para Ponta da Fruta bloqueia fechamento geral se Balneário e Santa Mônica não conferirem", () => {
      // Banana Prata comprada e alocada globalmente (em Ponta da Fruta)
      const purchasedProductIds = ["prod-banana-prata"];
      const globallyAllocatedProductIds = new Set(["prod-banana-prata"]);

      // Apenas Ponta da Fruta conferiu e finalizou
      const storeClosures: Record<string, StoreClosureSummary> = {
        "store-ponta": {
          cycleDate: "2026-10-20",
          storeId: "store-ponta",
          storeName: "MultiShow Ponta da Fruta",
          status: "CLOSED",
          orderId: "ord-ponta",
          orderRevision: 1,
          totalOrderedItems: 1,
          totalDestinedItems: 1,
          totalCutItems: 0,
          cuts: [],
          allocationsHash: "hash-ponta",
          closedAt: "2026-10-20T12:00:00Z",
          closedByName: "Comprador",
          reopenedAt: null,
          reopenedByName: null,
          reopenReason: null,
          isStale: false,
        },
        // Balneário e Santa Mônica estão OPEN
        "store-balneario": {
          cycleDate: "2026-10-20",
          storeId: "store-balneario",
          storeName: "MultiShow Balneário",
          status: "OPEN",
          orderId: "ord-balneario",
          orderRevision: 1,
          totalOrderedItems: 1,
          totalDestinedItems: 0,
          totalCutItems: 1,
          cuts: [],
          allocationsHash: "hash-empty",
          closedAt: null,
          closedByName: null,
          reopenedAt: null,
          reopenedByName: null,
          reopenReason: null,
          isStale: false,
        },
        "store-santa-monica": {
          cycleDate: "2026-10-20",
          storeId: "store-santa-monica",
          storeName: "MultiShow Santa Mônica",
          status: "OPEN",
          orderId: "ord-santa-monica",
          orderRevision: 1,
          totalOrderedItems: 1,
          totalDestinedItems: 0,
          totalCutItems: 1,
          cuts: [],
          allocationsHash: "hash-empty",
          closedAt: null,
          closedByName: null,
          reopenedAt: null,
          reopenedByName: null,
          reopenReason: null,
          isStale: false,
        },
      };

      const result = validateCycleClosureReadinessStoreFirst({
        stores,
        storeClosures,
        purchasedProductIds,
        globallyAllocatedProductIds,
        catalogMap,
      });

      // NÃO PODE FECHAR! (Falha corrigida do Codex)
      expect(result.canClose).toBe(false);
      expect(result.missingStores).toHaveLength(2);
      expect(result.missingStores.map((s) => s.id)).toEqual([
        "store-balneario",
        "store-santa-monica",
      ]);
    });

    it("permite fechamento geral somente quando todas as 3 lojas finalizarem seus cortes e não estiverem stale", () => {
      const purchasedProductIds = ["prod-banana-prata"];
      const globallyAllocatedProductIds = new Set(["prod-banana-prata"]);

      const storeClosures: Record<string, StoreClosureSummary> = {
        "store-ponta": {
          cycleDate: "2026-10-20",
          storeId: "store-ponta",
          storeName: "MultiShow Ponta da Fruta",
          status: "CLOSED",
          orderId: "ord-ponta",
          orderRevision: 1,
          totalOrderedItems: 1,
          totalDestinedItems: 1,
          totalCutItems: 0,
          cuts: [],
          allocationsHash: "hash-ponta",
          closedAt: "2026-10-20T12:00:00Z",
          closedByName: "Comprador",
          reopenedAt: null,
          reopenedByName: null,
          reopenReason: null,
          isStale: false,
        },
        "store-balneario": {
          cycleDate: "2026-10-20",
          storeId: "store-balneario",
          storeName: "MultiShow Balneário",
          status: "CLOSED",
          orderId: "ord-balneario",
          orderRevision: 1,
          totalOrderedItems: 1,
          totalDestinedItems: 0,
          totalCutItems: 1,
          cuts: [],
          allocationsHash: "hash-balneario",
          closedAt: "2026-10-20T12:05:00Z",
          closedByName: "Comprador",
          reopenedAt: null,
          reopenedByName: null,
          reopenReason: null,
          isStale: false,
        },
        "store-santa-monica": {
          cycleDate: "2026-10-20",
          storeId: "store-santa-monica",
          storeName: "MultiShow Santa Mônica",
          status: "CLOSED",
          orderId: "ord-santa-monica",
          orderRevision: 1,
          totalOrderedItems: 1,
          totalDestinedItems: 0,
          totalCutItems: 1,
          cuts: [],
          allocationsHash: "hash-sm",
          closedAt: "2026-10-20T12:10:00Z",
          closedByName: "Comprador",
          reopenedAt: null,
          reopenedByName: null,
          reopenReason: null,
          isStale: false,
        },
      };

      const result = validateCycleClosureReadinessStoreFirst({
        stores,
        storeClosures,
        purchasedProductIds,
        globallyAllocatedProductIds,
        catalogMap,
      });

      expect(result.canClose).toBe(true);
      expect(result.missingStores).toHaveLength(0);
      expect(result.missingProducts).toHaveLength(0);
    });

    it("bloqueia fechamento geral se alguma loja estiver stale após alteração de pedido ou destinação", () => {
      const purchasedProductIds = ["prod-banana-prata"];
      const globallyAllocatedProductIds = new Set(["prod-banana-prata"]);

      const storeClosures: Record<string, StoreClosureSummary> = {
        "store-ponta": {
          cycleDate: "2026-10-20",
          storeId: "store-ponta",
          storeName: "MultiShow Ponta da Fruta",
          status: "CLOSED",
          orderId: "ord-ponta",
          orderRevision: 1,
          totalOrderedItems: 1,
          totalDestinedItems: 1,
          totalCutItems: 0,
          cuts: [],
          allocationsHash: "hash-ponta",
          closedAt: "2026-10-20T12:00:00Z",
          closedByName: "Comprador",
          reopenedAt: null,
          reopenedByName: null,
          reopenReason: null,
          isStale: true,
          staleReason: "Destinações da loja foram alteradas após a conferência.",
        },
        "store-balneario": {
          cycleDate: "2026-10-20",
          storeId: "store-balneario",
          storeName: "MultiShow Balneário",
          status: "CLOSED",
          orderId: "ord-balneario",
          orderRevision: 1,
          totalOrderedItems: 1,
          totalDestinedItems: 0,
          totalCutItems: 1,
          cuts: [],
          allocationsHash: "hash-balneario",
          closedAt: "2026-10-20T12:05:00Z",
          closedByName: "Comprador",
          reopenedAt: null,
          reopenedByName: null,
          reopenReason: null,
          isStale: false,
        },
        "store-santa-monica": {
          cycleDate: "2026-10-20",
          storeId: "store-santa-monica",
          storeName: "MultiShow Santa Mônica",
          status: "CLOSED",
          orderId: "ord-santa-monica",
          orderRevision: 1,
          totalOrderedItems: 1,
          totalDestinedItems: 0,
          totalCutItems: 1,
          cuts: [],
          allocationsHash: "hash-sm",
          closedAt: "2026-10-20T12:10:00Z",
          closedByName: "Comprador",
          reopenedAt: null,
          reopenedByName: null,
          reopenReason: null,
          isStale: false,
        },
      };

      const result = validateCycleClosureReadinessStoreFirst({
        stores,
        storeClosures,
        purchasedProductIds,
        globallyAllocatedProductIds,
        catalogMap,
      });

      expect(result.canClose).toBe(false);
      expect(result.missingStores).toHaveLength(1);
      expect(result.missingStores[0].id).toBe("store-ponta");
      expect(result.missingStores[0].reason).toContain("Destinações da loja foram alteradas");
    });
  });
});
