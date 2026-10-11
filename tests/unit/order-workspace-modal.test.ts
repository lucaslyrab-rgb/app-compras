// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act, startTransition } from "react";
import { createRoot } from "react-dom/client";
import type { State } from "@/modules/ordering/actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
process.env.TZ = "Asia/Tokyo";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) =>
    React.createElement("img", { ...props, priority: undefined }),
}));

vi.mock("@/components/product-photo", () => ({
  ProductPhoto: () => React.createElement("div", { "data-testid": "photo" }),
}));

vi.mock("@/app/login/actions", () => ({
  logoutAction: vi.fn(),
}));

let mockSubmitOrderImpl: (state: State, formData: FormData) => Promise<State>;

vi.mock("@/modules/ordering/actions", () => ({
  saveDraftAction: vi.fn(),
  submitOrderAction: (state: State, formData: FormData) => mockSubmitOrderImpl(state, formData),
}));

import { OrderWorkspace } from "@/modules/ordering/order-workspace";

describe("OrderWorkspace Modal de Revisão — Padronização de Horário", () => {
  const controlledSubmittedAt = "2026-10-07T19:42:14.671Z";
  const expectedSaoPauloText = "Pedido enviado em: 07/10/2026, 16:42";
  const forbiddenTokyoTime = "04:42";
  const forbiddenTokyoDate = "08/10/2026";

  const mockProducts = [
    {
      id: "prod-1",
      erpCode: 101,
      name: "BANANA PRATA",
      unit: "CX",
      purchaseFormat: "CX",
    },
  ];

  beforeEach(() => {
    mockSubmitOrderImpl = vi.fn().mockImplementation(async () => ({
      status: "confirm" as const,
      message: "Já existe um pedido para esta compra",
      existingSubmittedAt: controlledSubmittedAt,
      purchaseCycleDate: "2026-10-08",
      version: 1,
    }));
  });

  it("exibe o horário exato de São Paulo (16:42) no modal mesmo com ambiente configurado para Asia/Tokyo", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(OrderWorkspace, {
          products: mockProducts,
          storeId: "store-uuid-1",
          storeName: "MultiShow Balneário",
          initialDraft: { version: 0, items: [] },
          date: "2026-10-07",
          cycleDate: "2026-10-08",
          cutoffAt: "2026-10-07T21:00:00.000Z",
        })
      );
    });

    // 1. Aciona "Enviar pedido" para abrir o modal de revisão
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Enviar pedido")
    );
    expect(submitBtn).toBeDefined();

    await act(async () => {
      startTransition(() => {
        submitBtn!.click();
      });
    });

    // 2. Valida abertura do diálogo e conteúdo exato do horário
    let dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    let paragraph = Array.from(dialog!.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Pedido enviado em:")
    );
    expect(paragraph).toBeDefined();
    // Exige exatamente o texto em America/Sao_Paulo
    expect(paragraph!.textContent).toContain(expectedSaoPauloText);
    // Garante que o horário do navegador (Asia/Tokyo = 08/10/2026, 04:42) NÃO é exibido
    expect(paragraph!.textContent).not.toContain(forbiddenTokyoTime);
    expect(paragraph!.textContent).not.toContain(forbiddenTokyoDate);

    // 3. Testa o cenário "Voltar" (fechar o modal)
    const backBtn = Array.from(dialog!.querySelectorAll("button")).find(
      (b) => b.textContent === "Voltar"
    );
    expect(backBtn).toBeDefined();

    await act(async () => {
      backBtn!.click();
    });

    dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();

    root.unmount();
    container.remove();

    // 4. Testa reabertura após recarregar a página (comportamento verificado no E2E)
    const newContainer = document.createElement("div");
    document.body.appendChild(newContainer);
    const newRoot = createRoot(newContainer);

    await act(async () => {
      newRoot.render(
        React.createElement(OrderWorkspace, {
          products: mockProducts,
          storeId: "store-uuid-1",
          storeName: "MultiShow Balneário",
          initialDraft: { version: 0, items: [] },
          date: "2026-10-07",
          cycleDate: "2026-10-08",
          cutoffAt: "2026-10-07T21:00:00.000Z",
        })
      );
    });

    const newSubmitBtn = Array.from(newContainer.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Enviar pedido")
    );
    await act(async () => {
      startTransition(() => {
        newSubmitBtn!.click();
      });
    });

    dialog = newContainer.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    paragraph = Array.from(dialog!.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Pedido enviado em:")
    );
    expect(paragraph!.textContent).toContain(expectedSaoPauloText);

    // 5. Testa confirmar a revisão ("Alterar pedido")
    let submittedFormData: FormData | null = null;
    mockSubmitOrderImpl = vi.fn().mockImplementation(async (_state: State, formData: FormData) => {
      submittedFormData = formData;
      return {
        status: "success" as const,
        message: "Pedido enviado — revisão 2.",
        version: 2,
      };
    });

    const confirmBtn = Array.from(dialog!.querySelectorAll("button")).find(
      (b) => b.textContent === "Alterar pedido"
    );
    expect(confirmBtn).toBeDefined();

    await act(async () => {
      startTransition(() => {
        confirmBtn!.click();
      });
    });

    // O modal fecha após confirmação bem-sucedida
    dialog = newContainer.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();

    // Confirma envio de allowRevision = 1
    expect(submittedFormData).not.toBeNull();
    expect((submittedFormData as unknown as FormData).get("allowRevision")).toBe("1");
    expect((submittedFormData as unknown as FormData).get("storeId")).toBe("store-uuid-1");

    // Feedback de sucesso renderizado
    expect(newContainer.textContent).toContain("Pedido enviado — revisão 2.");

    newRoot.unmount();
    newContainer.remove();
  });
});
