import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), setCookie: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: mocks.setCookie }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));
vi.mock("@/modules/identity/repository", () => ({ authenticate: mocks.authenticate, revokeSession: vi.fn() }));
vi.mock("@/modules/identity/session", () => ({ SESSION_COOKIE: "multishow_session" }));
vi.mock("@/modules/identity/audit", () => ({ recordAudit: mocks.audit }));

import { loginAction } from "@/app/login/actions";

describe("Destino após autenticação", () => {
  beforeEach(() => vi.clearAllMocks());

  function credentials() {
    const form = new FormData();
    form.set("email", "operator@example.com");
    form.set("password", "senha-apenas-do-teste");
    return form;
  }

  it("cria a sessão e encaminha para a escolha de atividades após login válido", async () => {
    mocks.authenticate.mockResolvedValue({ token: "session-only-for-test", absoluteExpiresAt: new Date("2027-01-01") });
    await expect(loginAction({ error: undefined }, credentials())).rejects.toThrow("REDIRECT:/inicio");
    expect(mocks.setCookie).toHaveBeenCalledWith("multishow_session", "session-only-for-test", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });

  it("não encaminha para os módulos nem cria cookie quando a credencial é inválida", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const result = await loginAction({ error: undefined }, credentials());
    expect(result.error).toBe("E-mail ou senha inválidos.");
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});
