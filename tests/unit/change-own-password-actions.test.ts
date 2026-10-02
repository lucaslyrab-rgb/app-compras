import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCookieDelete = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockImplementation(async () => ({
    delete: mockCookieDelete,
  })),
}));

import { changeOwnPasswordAction } from "@/modules/identity/actions";
import * as sessionModule from "@/modules/identity/session";
import * as repositoryModule from "@/modules/identity/repository";
import { UserValidationError, type Principal } from "@/modules/identity/domain";

describe("Minha Senha - Server Action e Segurança", () => {
  const samplePrincipal: Principal = {
    userId: "user-uuid-1234",
    role: "COMPRADOR",
    storeId: null,
    permissions: ["compras:consolidado"],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockCookieDelete.mockClear();
  });

  it("rejeita chamada quando o usuário não estiver autenticado", async () => {
    vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(null);

    const res = await changeOwnPasswordAction({
      currentPassword: "SenhaAtual123",
      newPassword: "NovaSenha2026",
      passwordConfirmation: "NovaSenha2026",
    });

    expect(res.status).toBe("error");
    expect(res.message).toMatch(/não autenticado/);
    expect(mockCookieDelete).not.toHaveBeenCalled();
  });

  it("deriva a identidade estritamente de currentPrincipal() e não aceita targetUserId do client", async () => {
    vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(samplePrincipal);
    const changeRepoSpy = vi
      .spyOn(repositoryModule, "changeOwnPassword")
      .mockResolvedValue({ userId: samplePrincipal.userId, updatedAt: new Date().toISOString() });

    // Envia chamada normal
    const res = await changeOwnPasswordAction({
      currentPassword: "SenhaAtual123",
      newPassword: "NovaSenha2026",
      passwordConfirmation: "NovaSenha2026",
    });

    expect(res.status).toBe("success");
    expect(changeRepoSpy).toHaveBeenCalledTimes(1);
    // Garante que o userId passado para o repositório é exatamente o do principal autenticado
    expect(changeRepoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-uuid-1234",
        currentPassword: "SenhaAtual123",
        newPassword: "NovaSenha2026",
        passwordConfirmation: "NovaSenha2026",
      })
    );
  });

  it("remove cookie de sessão somente após alteração concluída com sucesso", async () => {
    vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(samplePrincipal);
    vi.spyOn(repositoryModule, "changeOwnPassword").mockResolvedValue({
      userId: samplePrincipal.userId,
      updatedAt: new Date().toISOString(),
    });

    const res = await changeOwnPasswordAction({
      currentPassword: "SenhaAtual123",
      newPassword: "NovaSenha2026",
      passwordConfirmation: "NovaSenha2026",
    });

    expect(res.status).toBe("success");
    expect(mockCookieDelete).toHaveBeenCalledWith(sessionModule.SESSION_COOKIE);
  });

  it("não remove cookie de sessão se a alteração falhar (ex: senha atual incorreta)", async () => {
    vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(samplePrincipal);
    vi.spyOn(repositoryModule, "changeOwnPassword").mockRejectedValue(
      new UserValidationError("A senha atual informada está incorreta.")
    );

    const res = await changeOwnPasswordAction({
      currentPassword: "SenhaErrada123",
      newPassword: "NovaSenha2026",
      passwordConfirmation: "NovaSenha2026",
    });

    expect(res.status).toBe("error");
    expect(res.message).toBe("A senha atual informada está incorreta.");
    expect(mockCookieDelete).not.toHaveBeenCalled();
  });

  it("rejeita previamente se a nova senha for idêntica à senha atual", async () => {
    vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(samplePrincipal);
    const changeRepoSpy = vi.spyOn(repositoryModule, "changeOwnPassword");

    const res = await changeOwnPasswordAction({
      currentPassword: "MesmaSenha123",
      newPassword: "MesmaSenha123",
      passwordConfirmation: "MesmaSenha123",
    });

    expect(res.status).toBe("error");
    expect(res.message).toBe("A nova senha deve ser diferente da senha atual.");
    expect(changeRepoSpy).not.toHaveBeenCalled();
    expect(mockCookieDelete).not.toHaveBeenCalled();
  });

  it("rejeita previamente se as senhas não coincidirem", async () => {
    vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(samplePrincipal);
    const changeRepoSpy = vi.spyOn(repositoryModule, "changeOwnPassword");

    const res = await changeOwnPasswordAction({
      currentPassword: "SenhaAtual123",
      newPassword: "NovaSenha2026",
      passwordConfirmation: "OutraSenha2026",
    });

    expect(res.status).toBe("error");
    expect(res.message).toBe("As senhas não coincidem.");
    expect(changeRepoSpy).not.toHaveBeenCalled();
    expect(mockCookieDelete).not.toHaveBeenCalled();
  });
});
