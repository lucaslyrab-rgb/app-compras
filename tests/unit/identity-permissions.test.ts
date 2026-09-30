import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  STORE_PERMISSIONS,
  assertPermission,
  assertStoreAccess,
  canManageGestor,
  canManagePricing,
  canManageProducts,
  canManageSettings,
  canManageUsers,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  AuthorizationError,
  UserValidationError,
  validateStoreUserInvariant,
  assertStoreUserInvariant,
  type Principal,
} from "@/modules/identity/domain";

describe("Fundação de Permissões V1", () => {
  it("contém exatamente as 8 permissões oficiais V1", () => {
    expect(PERMISSIONS).toEqual([
      "pedidos:criar",
      "pedidos:historico",
      "compras:consolidado",
      "compras:custos",
      "gestor:produtos",
      "gestor:precificacao",
      "gestor:configuracoes",
      "gestor:usuarios",
    ]);
    expect(STORE_PERMISSIONS).toEqual(["pedidos:criar", "pedidos:historico"]);
  });

  describe("helpers de verificação de permissões", () => {
    const compradorPrincipal: Principal = {
      userId: "u-buyer",
      role: "COMPRADOR",
      storeId: null,
      permissions: ["compras:consolidado", "compras:custos"],
    };

    const gestorPrincipal: Principal = {
      userId: "u-gestor",
      role: "GESTOR",
      storeId: null,
      permissions: [
        "compras:consolidado",
        "compras:custos",
        "gestor:produtos",
        "gestor:precificacao",
        "gestor:configuracoes",
        "gestor:usuarios",
      ],
    };

    const lojaPrincipal: Principal = {
      userId: "u-loja",
      role: "LOJA",
      storeId: "store-1",
      permissions: ["pedidos:criar", "pedidos:historico"],
    };

    it("hasPermission avalia permissão individual corretamente", () => {
      expect(hasPermission(compradorPrincipal, "compras:consolidado")).toBe(true);
      expect(hasPermission(compradorPrincipal, "compras:custos")).toBe(true);
      expect(hasPermission(compradorPrincipal, "gestor:produtos")).toBe(false);
      expect(hasPermission(compradorPrincipal, "pedidos:criar")).toBe(false);

      expect(hasPermission(gestorPrincipal, "gestor:produtos")).toBe(true);
      expect(hasPermission(gestorPrincipal, "gestor:precificacao")).toBe(true);
      expect(hasPermission(gestorPrincipal, "gestor:configuracoes")).toBe(true);
      expect(hasPermission(gestorPrincipal, "gestor:usuarios")).toBe(true);
      // GESTOR NÃO tem permissões de Loja
      expect(hasPermission(gestorPrincipal, "pedidos:criar")).toBe(false);
      expect(hasPermission(gestorPrincipal, "pedidos:historico")).toBe(false);

      expect(hasPermission(lojaPrincipal, "pedidos:criar")).toBe(true);
      expect(hasPermission(lojaPrincipal, "pedidos:historico")).toBe(true);
      expect(hasPermission(lojaPrincipal, "compras:consolidado")).toBe(false);
      expect(hasPermission(lojaPrincipal, "gestor:produtos")).toBe(false);
    });

    it("hasAnyPermission avalia conjunto de permissões (OR)", () => {
      expect(hasAnyPermission(compradorPrincipal, ["compras:consolidado", "gestor:produtos"])).toBe(true);
      expect(hasAnyPermission(compradorPrincipal, ["gestor:produtos", "gestor:precificacao"])).toBe(false);
      expect(hasAnyPermission(compradorPrincipal, [])).toBe(false);
    });

    it("hasAllPermissions avalia conjunto de permissões (AND)", () => {
      expect(hasAllPermissions(compradorPrincipal, ["compras:consolidado", "compras:custos"])).toBe(true);
      expect(hasAllPermissions(compradorPrincipal, ["compras:consolidado", "gestor:produtos"])).toBe(false);
      expect(hasAllPermissions(gestorPrincipal, [
        "compras:consolidado",
        "gestor:produtos",
        "gestor:precificacao",
        "gestor:configuracoes",
        "gestor:usuarios",
      ])).toBe(true);
    });

    it("assertPermission lança AuthorizationError quando ausente", () => {
      expect(() => assertPermission(compradorPrincipal, "compras:custos")).not.toThrow();
      expect(() => assertPermission(compradorPrincipal, "gestor:produtos")).toThrow(AuthorizationError);
      expect(() => assertPermission(lojaPrincipal, "compras:consolidado")).toThrow(AuthorizationError);
      expect(() => assertPermission(gestorPrincipal, "pedidos:criar")).toThrow(AuthorizationError);
    });

    it("helpers canManage* checam permissões específicas", () => {
      const produtosOnly: Principal = {
        userId: "p1",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:produtos"],
      };
      expect(canManageProducts(produtosOnly)).toBe(true);
      expect(canManagePricing(produtosOnly)).toBe(false);
      expect(canManageSettings(produtosOnly)).toBe(false);
      expect(canManageUsers(produtosOnly)).toBe(false);
      expect(canManageGestor(produtosOnly)).toBe(true);

      const precificacaoOnly: Principal = {
        userId: "p2",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:precificacao"],
      };
      expect(canManageProducts(precificacaoOnly)).toBe(false);
      expect(canManagePricing(precificacaoOnly)).toBe(true);
      expect(canManageSettings(precificacaoOnly)).toBe(false);
      expect(canManageUsers(precificacaoOnly)).toBe(false);
      expect(canManageGestor(precificacaoOnly)).toBe(true);

      const settingsOnly: Principal = {
        userId: "p3",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:configuracoes"],
      };
      expect(canManageSettings(settingsOnly)).toBe(true);
      expect(canManageGestor(settingsOnly)).toBe(true);

      const usersOnly: Principal = {
        userId: "p4",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:usuarios"],
      };
      expect(canManageUsers(usersOnly)).toBe(true);
      expect(canManageGestor(usersOnly)).toBe(true);

      expect(canManageGestor(compradorPrincipal)).toBe(false);
      expect(canManageGestor(lojaPrincipal)).toBe(false);
    });

    it("assertStoreAccess isola loja e bloqueia quem não tem permissão de loja", () => {
      // Loja com permissão e loja correta -> OK
      expect(() => assertStoreAccess(lojaPrincipal, "store-1")).not.toThrow();

      // Loja com permissão mas loja diferente -> nega
      expect(() => assertStoreAccess(lojaPrincipal, "store-2")).toThrow(AuthorizationError);

      // Comprador sem permissão de loja -> nega sempre
      expect(() => assertStoreAccess(compradorPrincipal, "store-1")).toThrow(AuthorizationError);

      // Gestor sem permissão de loja -> nega sempre
      expect(() => assertStoreAccess(gestorPrincipal, "store-1")).toThrow(AuthorizationError);
    });
  });

  describe("compatibilidade de papéis e granularidade", () => {
    it("permite compor usuário misto com permissões de comprador e parte de gestor", () => {
      const misto: Principal = {
        userId: "u-misto",
        role: "COMPRADOR",
        storeId: null,
        permissions: ["compras:consolidado", "compras:custos", "gestor:produtos"],
      };

      expect(hasPermission(misto, "compras:consolidado")).toBe(true);
      expect(hasPermission(misto, "compras:custos")).toBe(true);
      expect(canManageProducts(misto)).toBe(true);
      expect(canManagePricing(misto)).toBe(false);
      expect(canManageSettings(misto)).toBe(false);
      expect(canManageUsers(misto)).toBe(false);
    });

    it("permite gestor apenas de precificação sem acesso a configurações nem produtos", () => {
      const precificador: Principal = {
        userId: "u-price",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:precificacao"],
      };

      expect(canManageProducts(precificador)).toBe(false);
      expect(canManagePricing(precificador)).toBe(true);
      expect(canManageSettings(precificador)).toBe(false);
      expect(canManageUsers(precificador)).toBe(false);
    });
  });

  describe("invariante Loja / storeId no domínio", () => {
    const validStoreId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    const testMatrix: Array<{
      desc: string;
      permissions: Principal["permissions"];
      storeId: string | null | undefined;
      expectedValid: boolean;
    }> = [
      // Combinações válidas de Loja (tem permissão e tem loja)
      { desc: "pedidos:criar com storeId válido", permissions: ["pedidos:criar"], storeId: validStoreId, expectedValid: true },
      { desc: "pedidos:historico com storeId válido", permissions: ["pedidos:historico"], storeId: validStoreId, expectedValid: true },
      { desc: "ambas permissões de loja com storeId válido", permissions: ["pedidos:criar", "pedidos:historico"], storeId: validStoreId, expectedValid: true },

      // Combinações inválidas de Loja (tem permissão mas não tem loja)
      { desc: "pedidos:criar com storeId null", permissions: ["pedidos:criar"], storeId: null, expectedValid: false },
      { desc: "pedidos:criar com storeId undefined", permissions: ["pedidos:criar"], storeId: undefined, expectedValid: false },
      { desc: "pedidos:criar com storeId vazio", permissions: ["pedidos:criar"], storeId: "", expectedValid: false },
      { desc: "pedidos:historico com storeId null", permissions: ["pedidos:historico"], storeId: null, expectedValid: false },
      { desc: "ambas permissões de loja com storeId null", permissions: ["pedidos:criar", "pedidos:historico"], storeId: null, expectedValid: false },

      // Combinações válidas não-Loja (não tem permissão de loja e storeId é null/undefined)
      { desc: "comprador padrão com storeId null", permissions: ["compras:consolidado", "compras:custos"], storeId: null, expectedValid: true },
      { desc: "comprador padrão com storeId undefined", permissions: ["compras:consolidado", "compras:custos"], storeId: undefined, expectedValid: true },
      { desc: "gestor completo com storeId null", permissions: ["compras:consolidado", "compras:custos", "gestor:produtos", "gestor:precificacao", "gestor:configuracoes", "gestor:usuarios"], storeId: null, expectedValid: true },
      { desc: "gestor apenas de usuários com storeId null", permissions: ["gestor:usuarios"], storeId: null, expectedValid: true },
      { desc: "usuário com permissions = [] e storeId null", permissions: [], storeId: null, expectedValid: true },
      { desc: "usuário com permissions = [] e storeId undefined", permissions: [], storeId: undefined, expectedValid: true },

      // Combinações inválidas não-Loja (não tem permissão de loja mas tem storeId associado)
      { desc: "comprador com storeId associado", permissions: ["compras:consolidado", "compras:custos"], storeId: validStoreId, expectedValid: false },
      { desc: "gestor completo com storeId associado", permissions: ["compras:consolidado", "compras:custos", "gestor:produtos", "gestor:precificacao", "gestor:configuracoes", "gestor:usuarios"], storeId: validStoreId, expectedValid: false },
      { desc: "gestor de usuários com storeId associado", permissions: ["gestor:usuarios"], storeId: validStoreId, expectedValid: false },
      { desc: "usuário com permissions = [] com storeId associado", permissions: [], storeId: validStoreId, expectedValid: false },
    ];

    for (const { desc, permissions, storeId, expectedValid } of testMatrix) {
      it(`matriz: ${desc} -> ${expectedValid ? "VÁLIDO" : "INVÁLIDO"}`, () => {
        const result = validateStoreUserInvariant(permissions, storeId);
        expect(result.valid).toBe(expectedValid);
        if (!expectedValid) {
          expect(result.reason).toBeDefined();
          expect(() => assertStoreUserInvariant(permissions, storeId)).toThrow(UserValidationError);
        } else {
          expect(() => assertStoreUserInvariant(permissions, storeId)).not.toThrow();
        }
      });
    }
  });
});
