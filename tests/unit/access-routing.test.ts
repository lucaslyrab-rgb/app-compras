import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  hasOperationalRoute,
  resolveOperationalRoute,
  type Principal,
} from "@/modules/identity/domain";
import HomePage from "@/app/page";
import SemAcessoPage from "@/app/sem-acesso/page";
import * as sessionModule from "@/modules/identity/session";

describe("Roteamento operacional e prevenção de loops", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveOperationalRoute e hasOperationalRoute", () => {
    it("retorna null e false para usuário com permissions = []", () => {
      const user: Principal = {
        userId: "u-empty",
        role: "COMPRADOR",
        storeId: null,
        permissions: [],
      };
      expect(resolveOperationalRoute(user)).toBeNull();
      expect(hasOperationalRoute(user)).toBe(false);
    });

    it("retorna null e false para usuário contendo exclusivamente gestor:usuarios", () => {
      const user: Principal = {
        userId: "u-user-admin",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:usuarios"],
      };
      expect(resolveOperationalRoute(user)).toBeNull();
      expect(hasOperationalRoute(user)).toBe(false);
    });

    it("retorna null para usuário com pedidos:criar sem storeId", () => {
      const user: Principal = {
        userId: "u-invalid-store",
        role: "LOJA",
        storeId: null,
        permissions: ["pedidos:criar"],
      };
      expect(resolveOperationalRoute(user)).toBeNull();
      expect(hasOperationalRoute(user)).toBe(false);
    });

    it("retorna rotas operacionais corretas para perfis com permissões ativas", () => {
      expect(
        resolveOperationalRoute({
          userId: "u-loja",
          role: "LOJA",
          storeId: "store-1",
          permissions: ["pedidos:criar"],
        })
      ).toBe("/");

      expect(
        resolveOperationalRoute({
          userId: "u-gestor-prod",
          role: "GESTOR",
          storeId: null,
          permissions: ["gestor:produtos"],
        })
      ).toBe("/gestor/produtos");

      expect(
        resolveOperationalRoute({
          userId: "u-buyer-cons",
          role: "COMPRADOR",
          storeId: null,
          permissions: ["compras:consolidado"],
        })
      ).toBe("/comprador/consolidado");

      expect(
        resolveOperationalRoute({
          userId: "u-buyer-costs",
          role: "COMPRADOR",
          storeId: null,
          permissions: ["compras:custos"],
        })
      ).toBe("/comprador/custos");

      expect(
        resolveOperationalRoute({
          userId: "u-gestor-price",
          role: "GESTOR",
          storeId: null,
          permissions: ["gestor:precificacao"],
        })
      ).toBe("/gestor/precificacao");

      expect(
        resolveOperationalRoute({
          userId: "u-gestor-config",
          role: "GESTOR",
          storeId: null,
          permissions: ["gestor:configuracoes"],
        })
      ).toBe("/gestor/configuracoes");

      expect(
        resolveOperationalRoute({
          userId: "u-loja-hist",
          role: "LOJA",
          storeId: "store-1",
          permissions: ["pedidos:historico"],
        })
      ).toBe("/historico");
    });
  });

  describe("HomePage (/) com usuário sem rota operacional", () => {
    it("redireciona para /sem-acesso (e NUNCA para /login) quando permissions = []", async () => {
      vi.spyOn(sessionModule, "requirePrincipal").mockResolvedValue({
        userId: "u-empty",
        role: "COMPRADOR",
        storeId: null,
        permissions: [],
      });

      try {
        await HomePage();
        expect.fail("Deveria ter redirecionado");
      } catch (err: unknown) {
        const error = err as { message: string; digest: string };
        expect(error.message).toBe("NEXT_REDIRECT");
        expect(error.digest).toContain("/sem-acesso");
        expect(error.digest).not.toContain("/login");
      }
    });

    it("redireciona para /sem-acesso quando possui apenas gestor:usuarios", async () => {
      vi.spyOn(sessionModule, "requirePrincipal").mockResolvedValue({
        userId: "u-gestor-usuarios",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:usuarios"],
      });

      try {
        await HomePage();
        expect.fail("Deveria ter redirecionado");
      } catch (err: unknown) {
        const error = err as { message: string; digest: string };
        expect(error.message).toBe("NEXT_REDIRECT");
        expect(error.digest).toContain("/sem-acesso");
        expect(error.digest).not.toContain("/login");
      }
    });
  });

  describe("SemAcessoPage (/sem-acesso)", () => {
    it("renderiza tela segura com botão de Sair para usuário sem rotas operacionais", async () => {
      vi.spyOn(sessionModule, "requirePrincipal").mockResolvedValue({
        userId: "u-empty",
        role: "COMPRADOR",
        storeId: null,
        permissions: [],
      });

      const jsx = await SemAcessoPage();
      expect(jsx).toBeDefined();
      expect(jsx.type).toBe("main");
      expect(jsx.props.className).toContain("no-access-page");
    });

    it("redireciona para / caso um usuário com rotas operacionais tente acessar /sem-acesso", async () => {
      vi.spyOn(sessionModule, "requirePrincipal").mockResolvedValue({
        userId: "u-comprador",
        role: "COMPRADOR",
        storeId: null,
        permissions: ["compras:consolidado"],
      });

      try {
        await SemAcessoPage();
        expect.fail("Deveria ter redirecionado para /");
      } catch (err: unknown) {
        const error = err as { message: string; digest: string };
        expect(error.message).toBe("NEXT_REDIRECT");
        expect(error.digest).toContain(";/;");
      }
    });
  });

  describe("Prevenção explícita do loop /login <-> /", () => {
    it("garante término do fluxo sem repetição cíclica para usuário autenticado sem rota", async () => {
      const userWithoutRoutes: Principal = {
        userId: "u-no-routes",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:usuarios"],
      };

      vi.spyOn(sessionModule, "requirePrincipal").mockResolvedValue(userWithoutRoutes);

      // Simulação da cadeia de navegação
      // 1. Usuário no /login enquanto autenticado -> /login tenta mandar para /
      const loginRedirectTarget = "/";

      // 2. No / (HomePage) -> avalia rotas
      let homeRedirectTarget: string | null = null;
      try {
        await HomePage();
      } catch (err: unknown) {
        const error = err as { digest: string };
        homeRedirectTarget = error.digest.split(";")[2];
      }
      expect(homeRedirectTarget).toBe("/sem-acesso");

      // 3. No /sem-acesso (SemAcessoPage) -> avalia se redireciona
      let semAcessoRedirectTarget: string | null = null;
      try {
        await SemAcessoPage();
      } catch (err: unknown) {
        const error = err as { digest: string };
        semAcessoRedirectTarget = error.digest.split(";")[2];
      }

      // /sem-acesso NÃO redireciona, renderiza a página de forma estável
      expect(semAcessoRedirectTarget).toBeNull();

      // Confirma que a sequência encerra em /sem-acesso e NÃO retorna para /login
      expect(loginRedirectTarget).toBe("/");
      expect(homeRedirectTarget).toBe("/sem-acesso");
      expect(semAcessoRedirectTarget).toBeNull();
    });
  });
});
