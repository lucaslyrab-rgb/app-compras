// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/modules/identity/domain";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/inicio",
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", { href, ...props }, children),
}));
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) =>
    React.createElement("img", { ...props, priority: undefined }),
}));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/modules/identity/session", () => ({ requirePrincipal: vi.fn() }));
vi.mock("@/modules/ordering/repository", () => ({ getStoreName: vi.fn() }));
vi.mock("@/modules/ordering/calendar/service", () => ({
  currentPurchaseCycle: vi.fn(async () => ({
    localDate: "2026-11-02",
    cycleDate: "2026-11-03",
    cutoffAt: new Date("2099-11-02T23:00:00.000Z"),
  })),
}));
vi.mock("@/modules/store-home/repository", () => ({ readStoreHomeSummary: vi.fn() }));

import StartPage from "@/app/inicio/page";
import { StoreNavigation, currentStoreModule } from "@/components/store-navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { getStoreName } from "@/modules/ordering/repository";
import { readStoreHomeSummary } from "@/modules/store-home/repository";

describe("Entrada operacional após o login", () => {
  let root: Root | undefined;
  const principal: Principal = {
    userId: "operator", role: "LOJA", storeId: "store-1",
    permissions: ["pedidos:criar", "loja:conferencia", "loja:perdas"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePrincipal).mockResolvedValue(principal);
    vi.mocked(getStoreName).mockResolvedValue("Ponta da Fruta");
    vi.mocked(readStoreHomeSummary).mockResolvedValue({
      order: {
        submittedAt: null,
        submittedItems: 0,
        draftItems: 12,
        cutoffAt: "2099-11-02T23:00:00.000Z",
        cycleDate: "2026-11-03",
      },
      conference: { cycleDate: "2026-10-31", status: "IN_PROGRESS", totalItems: 34, verifiedItems: 21 },
      losses: { count: 3, kg: 4.5, und: 0 },
    });
  });
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
  });

  async function renderPage() {
    const page = await StartPage();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(page));
    return container;
  }

  function cardLinks(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLAnchorElement>("main a")).map((link) => link.getAttribute("href"));
  }

  it("mostra os cartões das atividades com a situação do dia, sem abrir o menu", async () => {
    const container = await renderPage();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(cardLinks(container)).toEqual(["/", "/conferencia", "/perdas"]);
    expect(container.textContent).toContain("Rascunho · 12 produtos");
    expect(container.textContent).toContain("13 para pesar");
    expect(container.textContent).toContain("4,5 kg");
    expect(container.textContent).toContain("A chegada de 31/10 ainda tem 13 itens para pesar.");
    expect(container.querySelector(".order-workspace")).toBeNull();
    expect(getStoreName).toHaveBeenCalledWith("store-1");
  });

  it("mostra somente os módulos autorizados para a loja autenticada", async () => {
    vi.mocked(requirePrincipal).mockResolvedValue({ ...principal, permissions: ["loja:perdas", "pedidos:historico"] });
    const container = await renderPage();
    expect(cardLinks(container)).toEqual(["/perdas", "/historico"]);
  });

  it("continua mostrando os atalhos se a situação do dia não puder ser lida", async () => {
    vi.mocked(readStoreHomeSummary).mockRejectedValue(new Error("falha"));
    const container = await renderPage();
    expect(cardLinks(container)).toEqual(["/", "/conferencia", "/perdas"]);
  });

  it.each([
    { role: "COMPRADOR", storeId: null, permissions: ["perdas:consultar"], destination: "/comprador/perdas" },
    { role: "GESTOR", storeId: null, permissions: ["gestor:produtos"], destination: "/gestor/produtos" },
    { role: "LOJA", storeId: "store-1", permissions: ["pedidos:historico"], destination: "/historico" },
    { role: "LOJA", storeId: null, permissions: [], destination: "/sem-acesso" },
  ] as const)("preserva o destino autorizado $destination sem abrir o menu da loja", async (scenario) => {
    vi.mocked(requirePrincipal).mockResolvedValue({
      ...principal, role: scenario.role, storeId: scenario.storeId, permissions: [...scenario.permissions],
    });
    await expect(StartPage()).rejects.toThrow(`REDIRECT:${scenario.destination}`);
    expect(getStoreName).not.toHaveBeenCalled();
  });

  it("não tem mais o menu de módulos: o topo leva de volta ao Início", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(React.createElement(StoreNavigation, { storeName: "MultiShow Ponta da Fruta" })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("Módulos");
    expect(container.textContent).toContain("Ponta da Fruta");
  });

  it("abre o menu da conta com Minha senha e Sair", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(React.createElement(StoreNavigation, { storeName: "MultiShow Ponta da Fruta" })));
    const account = container.querySelector<HTMLButtonElement>('button[aria-label="Conta"]')!;
    expect(account.getAttribute("aria-expanded")).toBe("false");
    await act(async () => account.click());
    expect(account.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('a[href="/minha-senha"]')).not.toBeNull();
    expect(container.textContent).toContain("Sair");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(account.getAttribute("aria-expanded")).toBe("false");
  });

  it("não mostra atalhos de módulos no topo, apenas o indicador da tela atual", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(React.createElement(StoreNavigation, {
      storeName: "Ponta da Fruta", hasOrderPermission: true, hasConferencePermission: true, hasLossPermission: true,
    })));
    const header = container.querySelector("header")!;
    const headerLinks = Array.from(header.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(headerLinks).not.toContain("/conferencia");
    expect(headerLinks).not.toContain("/perdas");
    expect(header.textContent).toContain("Tela atual:");
    expect(header.textContent).toContain("Início");
  });

  it.each([
    ["/", "Pedido da Loja"],
    ["/pedidos/abc/detalhes", "Pedido da Loja"],
    ["/conferencia", "Conferência de Entrega"],
    ["/perdas", "Lançamento de Perdas"],
    ["/historico", "Histórico de Pedidos"],
    ["/inicio", "Início"],
  ])("identifica %s como %s", (pathname, label) => {
    expect(currentStoreModule(pathname).label).toBe(label);
  });
});
