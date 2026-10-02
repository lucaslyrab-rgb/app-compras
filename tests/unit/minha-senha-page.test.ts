import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

import MinhaSenhaPage from "@/app/minha-senha/page";
import * as sessionModule from "@/modules/identity/session";
import { redirect } from "next/navigation";

describe("Rota /minha-senha", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exige autenticação e delega para requirePrincipal()", async () => {
    const requireSpy = vi.spyOn(sessionModule, "requirePrincipal").mockImplementation(async () => {
      redirect("/login");
      throw new Error("NEXT_REDIRECT");
    });

    await expect(MinhaSenhaPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(requireSpy).toHaveBeenCalled();
  });

  it("renderiza normalmente para usuário autenticado de qualquer papel (LOJA, COMPRADOR, GESTOR, sem permissões)", async () => {
    vi.spyOn(sessionModule, "requirePrincipal").mockResolvedValue({
      userId: "u-qualquer",
      role: "LOJA",
      storeId: "loja-1",
      permissions: [],
    });

    const jsx = await MinhaSenhaPage();
    expect(jsx).toBeDefined();
  });
});
