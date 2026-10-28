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

import StartPage from "@/app/inicio/page";
import { StoreNavigation } from "@/components/store-navigation";
import { requirePrincipal } from "@/modules/identity/session";
import { getStoreName } from "@/modules/ordering/repository";

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

  it("abre um único modal com as três atividades antes de montar o formulário de pedido", async () => {
    const container = await renderPage();
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(Array.from(dialog.querySelectorAll("a")).map((link) => link.getAttribute("href")))
      .toEqual(["/", "/conferencia", "/perdas"]);
    expect(document.activeElement).toBe(dialog);
    expect(container.querySelector(".order-workspace")).toBeNull();
    expect(getStoreName).toHaveBeenCalledWith("store-1");
  });

  it("mostra somente os módulos autorizados para a loja autenticada", async () => {
    vi.mocked(requirePrincipal).mockResolvedValue({ ...principal, permissions: ["loja:perdas"] });
    const container = await renderPage();
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(Array.from(dialog.querySelectorAll("a")).map((link) => link.getAttribute("href")))
      .toEqual(["/perdas"]);
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

  it("mantém o foco no modal e permite fechar e reabrir pelo teclado e botão Módulos", async () => {
    const container = await renderPage();
    const dialog = container.querySelector('[role="dialog"]')!;
    const controls = dialog.querySelectorAll<HTMLElement>("button, a");
    controls[controls.length - 1].focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => document.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls[0]);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const menu = container.querySelector<HTMLButtonElement>('button[title="Abrir Menu de Atividades da Loja"]')!;
    menu.focus();
    await act(async () => menu.click());
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Fechar menu de módulos"]')!.click());
    expect(document.activeElement).toBe(menu);
  });

  it("nos módulos o menu continua fechado até o usuário pedir para abri-lo", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(React.createElement(StoreNavigation, {
      storeName: "Ponta da Fruta", hasOrderPermission: true, hasConferencePermission: true, hasLossPermission: true,
    })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
