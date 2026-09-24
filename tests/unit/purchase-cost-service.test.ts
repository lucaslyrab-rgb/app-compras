import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/modules/identity";
import type { ConsolidatedData } from "@/modules/purchasing/domain";

const mocks = vi.hoisted(() => ({
  loadConsolidated: vi.fn(),
  readPurchaseCostStates: vi.fn(),
  persistPurchaseCost: vi.fn(),
}));

vi.mock("@/modules/purchasing/service", () => ({
  loadConsolidated: mocks.loadConsolidated,
}));

vi.mock("@/modules/purchasing/costs/repository", () => ({
  readPurchaseCostStates: mocks.readPurchaseCostStates,
  persistPurchaseCost: mocks.persistPurchaseCost,
}));

import {
  loadPurchaseCosts,
  savePurchaseCost,
} from "@/modules/purchasing/costs/service";

const buyer: Principal = { userId: "buyer", role: "COMPRADOR", storeId: null };
const consolidated: ConsolidatedData = {
  cycleDate: "2026-09-23",
  cycles: ["2026-09-23"],
  stores: [
    {
      id: "store",
      slug: "ponta-da-fruta",
      name: "MultiShow Ponta da Fruta",
      order: {
        id: "order",
        revision: 1,
        submittedAt: "2026-09-22T18:00:00.000Z",
        cutoffAt: "2026-09-22T22:00:00.000Z",
      },
    },
  ],
  products: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      erpCode: 1,
      name: "BANANA",
      purchaseFormat: "CX",
      active: true,
      stores: { store: { stock: "999.00", quantity: "10.00" } },
      total: "10.00",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      erpCode: 2,
      name: "SEM PEDIDO",
      purchaseFormat: "UND",
      active: true,
      stores: { store: { stock: "999.00", quantity: "0.00" } },
      total: "0.00",
    },
  ],
  loadedAt: "2026-09-22T18:00:00.000Z",
};

describe("orquestração de custos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConsolidated.mockResolvedValue(consolidated);
    mocks.readPurchaseCostStates.mockResolvedValue([
      {
        productId: consolidated.products[0].id,
        exclusiveSupplier: true,
        currentCost: null,
        purchased: false,
        version: 0,
        updatedAt: null,
        previousCost: "70.00",
        previousCycleDate: "2026-09-22",
      },
    ]);
    mocks.persistPurchaseCost.mockResolvedValue({
      productId: consolidated.products[0].id,
      cycleDate: consolidated.cycleDate,
      cost: "75.50",
      costIsUnit: false,
      purchased: true,
      version: 1,
      updatedAt: "2026-09-22T18:01:00.000Z",
    });
  });

  it("reutiliza o Consolidado e lê custos somente dos produtos pedidos", async () => {
    const result = await loadPurchaseCosts(buyer, consolidated.cycleDate);
    expect(mocks.loadConsolidated).toHaveBeenCalledWith(
      buyer,
      consolidated.cycleDate,
    );
    expect(mocks.readPurchaseCostStates).toHaveBeenCalledWith(
      buyer,
      [consolidated.products[0].id],
      consolidated.cycleDate,
    );
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      id: consolidated.products[0].id,
      currentCost: "70.00",
      previousCost: "70.00",
      exclusiveSupplier: true,
    });
  });

  it("normaliza e persiste uma alteração autorizada", async () => {
    const result = await savePurchaseCost(buyer, {
      productId: consolidated.products[0].id,
      cycleDate: consolidated.cycleDate,
      costInput: "75,5",
      purchased: true,
      expectedVersion: 0,
    });
    expect(mocks.persistPurchaseCost).toHaveBeenCalledWith(buyer, {
      productId: consolidated.products[0].id,
      cycleDate: consolidated.cycleDate,
      cost: "75.50",
      costIsUnit: false,
      purchased: true,
      expectedVersion: 0,
    });
    expect(result).toMatchObject({ cost: "75.50", purchased: true });
  });

  it("recusa Loja antes de ler ou gravar", async () => {
    const store: Principal = { userId: "store", role: "LOJA", storeId: "s" };
    await expect(loadPurchaseCosts(store)).rejects.toThrow(/restrito/);
    await expect(
      savePurchaseCost(store, {
        productId: consolidated.products[0].id,
        cycleDate: consolidated.cycleDate,
        costInput: "75",
        purchased: true,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/restrito/);
    expect(mocks.loadConsolidated).not.toHaveBeenCalled();
    expect(mocks.persistPurchaseCost).not.toHaveBeenCalled();
  });

  it("recusa data inválida, produto sem pedido e custo inválido", async () => {
    await expect(
      savePurchaseCost(buyer, {
        productId: consolidated.products[0].id,
        cycleDate: "2026-02-30",
        costInput: "75",
        purchased: true,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/Data de compra inválida/);
    await expect(
      savePurchaseCost(buyer, {
        productId: consolidated.products[1].id,
        cycleDate: consolidated.cycleDate,
        costInput: "75",
        purchased: true,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/sem pedido válido/);
    await expect(
      savePurchaseCost(buyer, {
        productId: consolidated.products[0].id,
        cycleDate: consolidated.cycleDate,
        costInput: "",
        purchased: true,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/Informe o custo antes/);
    expect(mocks.persistPurchaseCost).not.toHaveBeenCalled();
  });
});
