import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createUserAction,
  updateUserAction,
  toggleUserActiveAction,
  resetUserPasswordAction,
} from "@/modules/identity/actions";
import * as sessionModule from "@/modules/identity/session";
import * as repositoryModule from "@/modules/identity/repository";
import { LastAdminProtectionError, UserConflictError, type Principal } from "@/modules/identity/domain";

describe("Gestão de Usuários - Server Actions e Autorização Server-Side", () => {
  const adminPrincipal: Principal = {
    userId: "admin-uuid",
    role: "GESTOR",
    storeId: null,
    permissions: ["gestor:usuarios"],
  };

  const buyerPrincipalWithAdmin: Principal = {
    userId: "buyer-admin-uuid",
    role: "COMPRADOR",
    storeId: null,
    permissions: ["compras:consolidado", "gestor:usuarios"],
  };

  const unprivilegedPrincipal: Principal = {
    userId: "unprivileged-uuid",
    role: "GESTOR",
    storeId: null,
    permissions: ["gestor:produtos", "gestor:precificacao"],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Bloqueio de usuário sem gestor:usuarios", () => {
    it("nega createUserAction se não possuir gestor:usuarios", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(unprivilegedPrincipal);

      const res = await createUserAction({
        name: "Teste",
        email: "teste@example.com",
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaValida1",
        passwordConfirmation: "senhaValida1",
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/Acesso negado/);
    });

    it("nega updateUserAction se não possuir gestor:usuarios", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(unprivilegedPrincipal);

      const res = await updateUserAction({
        id: "target-id",
        name: "Teste",
        email: "teste@example.com",
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        active: true,
        expectedUpdatedAt: new Date().toISOString(),
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/Acesso negado/);
    });

    it("nega toggleUserActiveAction se não possuir gestor:usuarios", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(unprivilegedPrincipal);

      const res = await toggleUserActiveAction({
        id: "target-id",
        active: false,
        expectedUpdatedAt: new Date().toISOString(),
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/Acesso negado/);
    });

    it("nega resetUserPasswordAction se não possuir gestor:usuarios", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(unprivilegedPrincipal);

      const res = await resetUserPasswordAction({
        targetUserId: "target-id",
        newPassword: "novaSenhaValida1",
        passwordConfirmation: "novaSenhaValida1",
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/Acesso negado/);
    });
  });

  describe("Permissão concedida via gestor:usuarios (independente de role)", () => {
    it("permite COMPRADOR com permissão gestor:usuarios executar criação propagando actorId", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(buyerPrincipalWithAdmin);
      const createSpy = vi.spyOn(repositoryModule, "createUser").mockResolvedValue({
        id: "created-id",
        email: "novo@example.com",
        name: "Novo Usuário",
        role: "LOJA",
        storeId: "store-id",
        storeName: "Loja Teste",
        permissions: ["pedidos:criar", "pedidos:historico"],
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const res = await createUserAction({
        name: "Novo Usuário",
        email: "novo@example.com",
        role: "LOJA",
        storeId: "store-id",
        permissions: ["pedidos:criar", "pedidos:historico"],
        password: "senhaValida1",
        passwordConfirmation: "senhaValida1",
      });

      expect(res.status).toBe("success");
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Novo Usuário",
          email: "novo@example.com",
          actorId: "buyer-admin-uuid",
        })
      );
    });

    it("trata conflito de concorrência e retorna dados frescos", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(adminPrincipal);
      vi.spyOn(repositoryModule, "updateUser").mockRejectedValue(
        new UserConflictError("Este usuário foi alterado por outro administrador.")
      );
      vi.spyOn(repositoryModule, "listUsersForManagement").mockResolvedValue([
        {
          id: "fresh-id",
          email: "fresco@example.com",
          name: "Dados Frescos",
          role: "GESTOR",
          storeId: null,
          storeName: null,
          permissions: ["gestor:usuarios"],
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const res = await updateUserAction({
        id: "fresh-id",
        name: "Tentativa Velha",
        email: "velho@example.com",
        role: "GESTOR",
        permissions: ["gestor:usuarios"],
        active: true,
        expectedUpdatedAt: new Date().toISOString(),
      });

      expect(res.status).toBe("conflict");
      if (res.status === "conflict") {
        expect(res.freshUsers.length).toBe(1);
        expect(res.message).toMatch(/outro administrador/);
      }
    });

    it("trata erro de proteção do último administrador amigavelmente", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(adminPrincipal);
      vi.spyOn(repositoryModule, "toggleUserActive").mockRejectedValue(
        new LastAdminProtectionError(
          "Não é possível concluir esta alteração porque o sistema precisa manter pelo menos um administrador ativo com acesso à Gestão de Usuários."
        )
      );

      const res = await toggleUserActiveAction({
        id: adminPrincipal.userId,
        active: false,
        expectedUpdatedAt: new Date().toISOString(),
      });

      expect(res.status).toBe("error");
      expect(res.message).toMatch(/manter pelo menos um administrador ativo/);
    });

    it("executa reset de senha propagando actorId e expectedUpdatedAt", async () => {
      vi.spyOn(sessionModule, "currentPrincipal").mockResolvedValue(adminPrincipal);
      const resetSpy = vi.spyOn(repositoryModule, "resetUserPassword").mockResolvedValue({
        targetUserId: "target-user-id",
        targetEmail: "target@example.com",
      });

      const res = await resetUserPasswordAction({
        targetUserId: "target-user-id",
        newPassword: "novaSenhaSegura1",
        passwordConfirmation: "novaSenhaSegura1",
        expectedUpdatedAt: "2026-10-01T12:00:00.000Z",
      });

      expect(res.status).toBe("success");
      expect(resetSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserId: "target-user-id",
          actorId: adminPrincipal.userId,
          expectedUpdatedAt: "2026-10-01T12:00:00.000Z",
        })
      );
    });
  });
});
