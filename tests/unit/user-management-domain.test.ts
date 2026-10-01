import { describe, expect, it } from "vitest";
import {
  ROLE_DEFAULT_PERMISSIONS,
  PERMISSION_GROUPS,
  resolveOperationalRoute,
  hasOperationalRoute,
  validatePassword,
  assertPassword,
  validatePasswordConfirmation,
  hashPassword,
  verifyPassword,
  normalizeEmail,
  isValidEmail,
  assertStoreUserInvariant,
  validateStoreUserInvariant,
  UserValidationError,
  LastAdminProtectionError,
  UserConflictError,
  type Principal,
} from "@/modules/identity/domain";

describe("Gestão de Usuários - Domínio e Validações V1", () => {
  describe("Política de Senhas V1 (mínimo 8 caracteres, 1 letra, 1 número)", () => {
    it("rejeita senha com menos de 8 caracteres (7 caracteres)", () => {
      const res = validatePassword("Abc1234");
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/8 caracteres/);
      expect(() => assertPassword("Abc1234")).toThrow(UserValidationError);
    });

    it("rejeita senha de 8+ caracteres contendo somente letras", () => {
      const res = validatePassword("abcdefgh");
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/uma letra e um número/);
      expect(() => assertPassword("abcdefgh")).toThrow(UserValidationError);
    });

    it("rejeita senha de 8+ caracteres contendo somente números", () => {
      const res = validatePassword("12345678");
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/uma letra e um número/);
      expect(() => assertPassword("12345678")).toThrow(UserValidationError);
    });

    it("aceita senha de 8+ caracteres contendo letra e número (exemplos do prompt)", () => {
      expect(validatePassword("maria2026").valid).toBe(true);
      expect(validatePassword("Loja1234").valid).toBe(true);
      expect(validatePassword("compras9").valid).toBe(true);
    });

    it("permite símbolos sem torná-los obrigatórios", () => {
      expect(validatePassword("maria@2026").valid).toBe(true);
      expect(validatePassword("loja-1234").valid).toBe(true);
      expect(validatePassword("compras_9!").valid).toBe(true);
    });

    it("permite maiúsculas sem torná-las obrigatórias", () => {
      // somente minúsculas com número: válido
      expect(validatePassword("minusc2026").valid).toBe(true);
      // maiúsculas e minúsculas com número: válido
      expect(validatePassword("Maiusc2026").valid).toBe(true);
      // somente maiúsculas com número: válido
      expect(validatePassword("MAIUSC2026").valid).toBe(true);
    });

    it("valida confirmação de senha", () => {
      expect(validatePasswordConfirmation("maria2026", "maria2026").valid).toBe(true);
      const diff = validatePasswordConfirmation("maria2026", "outra2026");
      expect(diff.valid).toBe(false);
      expect(diff.reason).toBe("As senhas não coincidem.");
    });

    it("gera hash scrypt diferente da senha e verifica corretamente", async () => {
      const pwd = "minhasenha123";
      const hash = await hashPassword(pwd);
      expect(hash).not.toBe(pwd);
      expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
      await expect(verifyPassword(pwd, hash)).resolves.toBe(true);
      await expect(verifyPassword("errada123", hash)).resolves.toBe(false);
    });

    it("senhas longas de usuários existentes continuam verificáveis pelo algoritmo", async () => {
      // Usuário existente com senha longa de 24 caracteres
      const longPwd = "senha-super-segura-1234-longa";
      const hash = await hashPassword(longPwd);
      await expect(verifyPassword(longPwd, hash)).resolves.toBe(true);
    });
  });

  describe("Normalização e Validação de E-mail", () => {
    it("normaliza e-mail com trim e lowercase", () => {
      expect(normalizeEmail("  Comprador.Master@MuitoMaisAtacado.com  ")).toBe(
        "comprador.master@muitomaisatacado.com"
      );
    });

    it("valida formatos de e-mail válidos e inválidos", () => {
      expect(isValidEmail("gestor@muitomais.com")).toBe(true);
      expect(isValidEmail("invalido")).toBe(false);
      expect(isValidEmail("@semusuario.com")).toBe(false);
      expect(isValidEmail("usuario@semdominio")).toBe(false);
    });
  });

  describe("Templates de Perfil e Agrupamentos", () => {
    it("fornece templates padrão corretos para cada perfil", () => {
      expect(ROLE_DEFAULT_PERMISSIONS.LOJA).toEqual(["pedidos:criar", "pedidos:historico"]);
      expect(ROLE_DEFAULT_PERMISSIONS.COMPRADOR).toEqual(["compras:consolidado", "compras:custos"]);
      expect(ROLE_DEFAULT_PERMISSIONS.GESTOR).toEqual([
        "compras:consolidado",
        "compras:custos",
        "gestor:produtos",
        "gestor:precificacao",
        "gestor:configuracoes",
        "gestor:usuarios",
      ]);
    });

    it("agrupa permissões de forma compreensível para a interface", () => {
      expect(PERMISSION_GROUPS.map((g) => g.group)).toEqual(["Loja", "Comprador", "Gestor"]);
      const flatIds = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.id));
      expect(flatIds).toEqual([
        "pedidos:criar",
        "pedidos:historico",
        "compras:consolidado",
        "compras:custos",
        "gestor:produtos",
        "gestor:precificacao",
        "gestor:configuracoes",
        "gestor:usuarios",
      ]);
    });
  });

  describe("Resolução de Rotas Operacionais", () => {
    it("usuário com somente gestor:usuarios é direcionado para /gestor/usuarios", () => {
      const principal: Principal = {
        userId: "u-admin-only",
        role: "GESTOR",
        storeId: null,
        permissions: ["gestor:usuarios"],
      };
      expect(resolveOperationalRoute(principal)).toBe("/gestor/usuarios");
      expect(hasOperationalRoute(principal)).toBe(true);
    });

    it("preserva precedência das demais rotas quando presentes", () => {
      const principalGestorFull: Principal = {
        userId: "u-gestor-full",
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
      // gestor:produtos tem precedência sobre gestor:usuarios
      expect(resolveOperationalRoute(principalGestorFull)).toBe("/gestor/produtos");
    });
  });

  describe("Invariantes de Loja vs Permissões", () => {
    it("exige loja quando possuir pedidos:criar ou pedidos:historico", () => {
      const validUuid = "11111111-1111-4111-8111-111111111111";
      expect(validateStoreUserInvariant(["pedidos:criar"], validUuid).valid).toBe(true);
      expect(validateStoreUserInvariant(["pedidos:historico"], validUuid).valid).toBe(true);
      expect(validateStoreUserInvariant(["pedidos:criar", "pedidos:historico"], validUuid).valid).toBe(true);

      const invalidNoStore = validateStoreUserInvariant(["pedidos:criar"], null);
      expect(invalidNoStore.valid).toBe(false);
      expect(invalidNoStore.reason).toMatch(/loja vinculada/);
      expect(() => assertStoreUserInvariant(["pedidos:criar"], null)).toThrow(UserValidationError);
    });

    it("proíbe loja quando não possuir permissão de loja", () => {
      const validUuid = "11111111-1111-4111-8111-111111111111";
      const invalidWithStore = validateStoreUserInvariant(["compras:consolidado"], validUuid);
      expect(invalidWithStore.valid).toBe(false);
      expect(invalidWithStore.reason).toMatch(/não pode possuir loja vinculada/);

      expect(validateStoreUserInvariant(["compras:consolidado"], null).valid).toBe(true);
      expect(validateStoreUserInvariant(["gestor:usuarios"], null).valid).toBe(true);
    });
  });

  describe("Classes de Erro de Domínio", () => {
    it("instancia erros especializados", () => {
      const e1 = new LastAdminProtectionError("Último admin");
      expect(e1.name).toBe("LastAdminProtectionError");
      expect(e1.message).toBe("Último admin");

      const e2 = new UserConflictError("Conflito otimista");
      expect(e2.name).toBe("UserConflictError");
      expect(e2.message).toBe("Conflito otimista");
    });
  });
});
