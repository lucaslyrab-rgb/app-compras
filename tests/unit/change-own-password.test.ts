import { describe, expect, it } from "vitest";
import {
  validateChangeOwnPasswordInput,
  assertChangeOwnPasswordInput,
  UserValidationError,
  PASSWORD_POLICY_MESSAGE,
} from "@/modules/identity/domain";

describe("Minha Senha - Validações de Domínio V1", () => {
  describe("Validação de Política e Confirmação", () => {
    it("rejeita nova senha com menos de 8 caracteres (7 caracteres)", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "SenhaAtual123",
        newPassword: "Abc1234",
        passwordConfirmation: "Abc1234",
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe(PASSWORD_POLICY_MESSAGE);
      expect(() =>
        assertChangeOwnPasswordInput({
          currentPassword: "SenhaAtual123",
          newPassword: "Abc1234",
          passwordConfirmation: "Abc1234",
        })
      ).toThrow(UserValidationError);
    });

    it("rejeita nova senha de 8+ caracteres contendo somente letras", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "SenhaAtual123",
        newPassword: "abcdefghij",
        passwordConfirmation: "abcdefghij",
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe(PASSWORD_POLICY_MESSAGE);
      expect(() =>
        assertChangeOwnPasswordInput({
          currentPassword: "SenhaAtual123",
          newPassword: "abcdefghij",
          passwordConfirmation: "abcdefghij",
        })
      ).toThrow(UserValidationError);
    });

    it("rejeita nova senha de 8+ caracteres contendo somente números", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "SenhaAtual123",
        newPassword: "1234567890",
        passwordConfirmation: "1234567890",
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe(PASSWORD_POLICY_MESSAGE);
      expect(() =>
        assertChangeOwnPasswordInput({
          currentPassword: "SenhaAtual123",
          newPassword: "1234567890",
          passwordConfirmation: "1234567890",
        })
      ).toThrow(UserValidationError);
    });

    it("rejeita quando confirmação for divergente da nova senha", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "SenhaAtual123",
        newPassword: "NovaSenha2026",
        passwordConfirmation: "OutraSenha2026",
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("As senhas não coincidem.");
      expect(() =>
        assertChangeOwnPasswordInput({
          currentPassword: "SenhaAtual123",
          newPassword: "NovaSenha2026",
          passwordConfirmation: "OutraSenha2026",
        })
      ).toThrow(UserValidationError);
    });

    it("rejeita quando a nova senha for idêntica à senha atual", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "MesmaSenha123",
        newPassword: "MesmaSenha123",
        passwordConfirmation: "MesmaSenha123",
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("A nova senha deve ser diferente da senha atual.");
      expect(() =>
        assertChangeOwnPasswordInput({
          currentPassword: "MesmaSenha123",
          newPassword: "MesmaSenha123",
          passwordConfirmation: "MesmaSenha123",
        })
      ).toThrow(UserValidationError);
    });

    it("aceita senha válida contendo letras e números", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "SenhaAntiga123",
        newPassword: "NovaSenha2026",
        passwordConfirmation: "NovaSenha2026",
      });
      expect(res.valid).toBe(true);
      expect(res.reason).toBeUndefined();
      expect(() =>
        assertChangeOwnPasswordInput({
          currentPassword: "SenhaAntiga123",
          newPassword: "NovaSenha2026",
          passwordConfirmation: "NovaSenha2026",
        })
      ).not.toThrow();
    });

    it("permite símbolos na nova senha sem torná-los obrigatórios", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "SenhaAntiga123",
        newPassword: "Nova@Senha_2026!",
        passwordConfirmation: "Nova@Senha_2026!",
      });
      expect(res.valid).toBe(true);
    });

    it("permite maiúsculas na nova senha sem torná-las obrigatórias", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "SenhaAntiga123",
        newPassword: "novasenha2026",
        passwordConfirmation: "novasenha2026",
      });
      expect(res.valid).toBe(true);
    });

    it("rejeita se a senha atual não for informada", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "",
        newPassword: "NovaSenha2026",
        passwordConfirmation: "NovaSenha2026",
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("Informe a senha atual.");
    });

    it("rejeita se a nova senha não for informada", () => {
      const res = validateChangeOwnPasswordInput({
        currentPassword: "SenhaAntiga123",
        newPassword: "",
        passwordConfirmation: "",
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("Informe a nova senha.");
    });
  });
});
