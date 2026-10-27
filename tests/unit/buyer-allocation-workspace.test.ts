// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { BuyerAllocationWorkspaceData } from "@/modules/purchasing/allocations/domain";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/modules/purchasing/allocations/actions", () => ({
  closeBuyerCycleAction: vi.fn(),
  reopenBuyerCycleAction: vi.fn(),
  saveSupplierAllocationsAction: vi.fn(),
}));

vi.mock("@/modules/purchasing/invoices/actions", () => ({
  registerInvoiceAction: vi.fn(),
  deleteInvoiceAction: vi.fn(),
}));

import { BuyerAllocationWorkspace } from "@/modules/purchasing/allocations/buyer-allocation-workspace";

const storePonta = {
  id: "store-ponta",
  slug: "ponta-da-fruta",
  name: "MultiShow Ponta da Fruta",
};
const storeBalneario = {
  id: "store-balneario",
  slug: "balneario",
  name: "MultiShow Balneário",
};

function workspaceData(
  selectedStoreId = storePonta.id,
  selectedSupplierId = "supplier-uniao",
): BuyerAllocationWorkspaceData {
  const orderedQuantities = {
    [storePonta.id]: "0.00",
    [storeBalneario.id]: "5.00",
  };
  return {
    cycleDate: "2026-10-20",
    cycles: ["2026-10-20"],
    selectedStoreId,
    selectedSupplierId,
    closure: {
      cycleDate: "2026-10-20",
      status: "OPEN",
      closedAt: null,
      closedByName: null,
      reopenedAt: null,
      reopenedByName: null,
      reopenReason: null,
      totalPurchasedInCosts: 1,
      totalAllocatedProducts: 0,
      missingProducts: [],
      canClose: false,
    },
    suppliers: [
      {
        id: "supplier-uniao",
        corporateName: "União Frutas",
        tradeName: null,
        taxId: null,
        active: true,
        hasAllocationsInCycle: false,
        totalDestinedQuantity: "0.00",
        destinedByStore: {},
      },
      {
        id: "supplier-outro",
        corporateName: "Outro Fornecedor",
        tradeName: null,
        taxId: null,
        active: true,
        hasAllocationsInCycle: false,
        totalDestinedQuantity: "0.00",
        destinedByStore: {},
      },
    ],
    stores: [storePonta, storeBalneario],
    destinationData: null,
    unassignedPurchasedProducts: [],
    catalogSearchList: [
      {
        id: "product-uva-vitoria",
        erpCode: 180,
        name: "UVA VITORIA 500G BANDEJA",
        purchaseFormat: "CX",
        isExclusive: false,
        exclusiveSupplierId: null,
        exclusiveSupplierName: null,
        purchasedInCosts: true,
        orderedQuantities,
        totalCycleOrders: "5.00",
      },
    ],
    cycleStoreOrders: {
      "product-uva-vitoria": orderedQuantities,
    },
    storeSummary: {},
    storeClosures: {},
    supplierStoreReviews: {},
    loadedAt: "2026-10-19T12:00:00.000Z",
  };
}

describe("BuyerAllocationWorkspace — contexto Loja → Fornecedor → Produtos", () => {
  beforeEach(() => {
    routerPush.mockReset();
  });

  it("preserva a loja recém-selecionada se o fornecedor for trocado antes da navegação terminar", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(BuyerAllocationWorkspace, { data: workspaceData() }));
    });

    const changeStoreButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Trocar Loja"),
    );
    expect(changeStoreButton).toBeDefined();
    await act(async () => changeStoreButton!.click());

    const balnearioButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Balneário"),
    );
    expect(balnearioButton).toBeDefined();

    await act(async () => {
      balnearioButton!.click();
    });

    const supplierSelect = container.querySelector<HTMLSelectElement>("#supplier-selector");
    expect(supplierSelect).not.toBeNull();
    await act(async () => {
      supplierSelect!.value = "supplier-outro";
      supplierSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(routerPush).toHaveBeenNthCalledWith(
      1,
      "/comprador/destinacao?ciclo=2026-10-20&loja=store-balneario&fornecedor=supplier-uniao",
    );
    expect(routerPush).toHaveBeenNthCalledWith(
      2,
      "/comprador/destinacao?ciclo=2026-10-20&loja=store-balneario&fornecedor=supplier-outro",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("exibe e sugere imediatamente o pedido canônico da loja ativa ao adicionar a Uva Vitória", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(BuyerAllocationWorkspace, {
          data: workspaceData(storeBalneario.id, "supplier-uniao"),
        }),
      );
    });

    const openCatalogButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Adicionar Produto Comprado"),
    );
    expect(openCatalogButton).toBeDefined();
    await act(async () => openCatalogButton!.click());

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "+ Adicionar",
    );
    expect(addButton).toBeDefined();
    await act(async () => addButton!.click());

    expect(container.textContent).toContain("Pedido da loja: 5.00 CX");
    const quantityInput = container.querySelector<HTMLInputElement>(".alloc-stepper-input");
    expect(quantityInput?.value).toBe("5.00");
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Salvar Destinações desta Loja"),
    );
    expect(saveButton?.disabled).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });
});
