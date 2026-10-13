import { describe, expect, it } from "vitest";
import {
  createSupplierInputSchema,
  formatPhone,
  formatTaxId,
  isValidCnpj,
  isValidCpf,
  normalizePhone,
  normalizeTaxId,
  SupplierConflictError,
  SupplierNotFoundError,
  SupplierValidationError,
  toggleSupplierActiveInputSchema,
  updateSupplierInputSchema,
  validateTaxId,
  TAX_ID_TYPE_LABELS,
  TAX_INVOICE_RULE_LABELS,
} from "@/modules/suppliers/domain";

describe("Fornecedores - Domínio e Validações", () => {
  describe("Validação de CPF", () => {
    // CPFs válidos conhecidos (algoritmo Módulo 11)
    const validCpfs = [
      "52998224725",
      "12345678909",
      "00000000191",
    ];

    for (const cpf of validCpfs) {
      it(`reconhece CPF válido: ${cpf}`, () => {
        expect(isValidCpf(cpf)).toBe(true);
      });
    }

    it("rejeita CPF com comprimento diferente de 11", () => {
      expect(isValidCpf("1234567890")).toBe(false);
      expect(isValidCpf("123456789012")).toBe(false);
      expect(isValidCpf("")).toBe(false);
    });

    it("rejeita CPFs com todos os dígitos repetidos", () => {
      const repeated = [
        "00000000000",
        "11111111111",
        "22222222222",
        "33333333333",
        "44444444444",
        "55555555555",
        "66666666666",
        "77777777777",
        "88888888888",
        "99999999999",
      ];
      for (const cpf of repeated) {
        expect(isValidCpf(cpf)).toBe(false);
      }
    });

    it("rejeita CPF com dígito verificador incorreto", () => {
      expect(isValidCpf("52998224726")).toBe(false);
      expect(isValidCpf("08316335440")).toBe(false);
    });
  });

  describe("Validação de CNPJ", () => {
    // CNPJs válidos conhecidos (algoritmo Módulo 11)
    const validCnpjs = [
      "04252011000110",
      "11222333000181",
      "00000000000191", // Banco do Brasil sede
    ];

    for (const cnpj of validCnpjs) {
      it(`reconhece CNPJ válido: ${cnpj}`, () => {
        expect(isValidCnpj(cnpj)).toBe(true);
      });
    }

    it("rejeita CNPJ com comprimento diferente de 14", () => {
      expect(isValidCnpj("1234567890123")).toBe(false);
      expect(isValidCnpj("123456789012345")).toBe(false);
      expect(isValidCnpj("")).toBe(false);
    });

    it("rejeita CNPJs com dígitos repetidos", () => {
      expect(isValidCnpj("00000000000000")).toBe(false);
      expect(isValidCnpj("11111111111111")).toBe(false);
    });

    it("rejeita CNPJ com dígito verificador incorreto", () => {
      expect(isValidCnpj("04252011000111")).toBe(false);
      expect(isValidCnpj("11222333000182")).toBe(false);
    });
  });

  describe("Normalização e Validação Integrada de Documento Fiscal", () => {
    it("normalizeTaxId extrai apenas dígitos ou retorna null", () => {
      expect(normalizeTaxId("04.252.011/0001-10")).toBe("04252011000110");
      expect(normalizeTaxId(" 529.982.247-25 ")).toBe("52998224725");
      expect(normalizeTaxId("")).toBeNull();
      expect(normalizeTaxId("   ")).toBeNull();
      expect(normalizeTaxId(null)).toBeNull();
      expect(normalizeTaxId(undefined)).toBeNull();
    });

    it("validateTaxId aceita documento vazio como NOT_INFORMED", () => {
      expect(validateTaxId(null)).toEqual({
        valid: true,
        type: "NOT_INFORMED",
        normalized: null,
      });
      expect(validateTaxId("")).toEqual({
        valid: true,
        type: "NOT_INFORMED",
        normalized: null,
      });
      expect(validateTaxId("   ")).toEqual({
        valid: true,
        type: "NOT_INFORMED",
        normalized: null,
      });
    });

    it("validateTaxId valida CPF válido", () => {
      const res = validateTaxId("529.982.247-25");
      expect(res.valid).toBe(true);
      expect(res.type).toBe("CPF");
      expect(res.normalized).toBe("52998224725");
    });

    it("validateTaxId rejeita CPF com dígito verificador inválido", () => {
      const res = validateTaxId("529.982.247-26");
      expect(res.valid).toBe(false);
      expect(res.type).toBe("CPF");
      expect(res.reason).toMatch(/CPF inválido/);
    });

    it("validateTaxId valida CNPJ válido", () => {
      const res = validateTaxId("04.252.011/0001-10");
      expect(res.valid).toBe(true);
      expect(res.type).toBe("CNPJ");
      expect(res.normalized).toBe("04252011000110");
    });

    it("validateTaxId rejeita CNPJ com dígito verificador inválido", () => {
      const res = validateTaxId("04.252.011/0001-99");
      expect(res.valid).toBe(false);
      expect(res.type).toBe("CNPJ");
      expect(res.reason).toMatch(/CNPJ inválido/);
    });

    it("validateTaxId rejeita tamanho incompatível com CPF ou CNPJ", () => {
      const res = validateTaxId("123456");
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/11 dígitos \(CPF\) ou 14 dígitos \(CNPJ\)/);
    });

    it("formatTaxId formata CPF e CNPJ", () => {
      expect(formatTaxId("52998224725")).toBe("529.982.247-25");
      expect(formatTaxId("04252011000110")).toBe("04.252.011/0001-10");
      expect(formatTaxId(null)).toBe("");
      expect(formatTaxId("")).toBe("");
    });
  });

  describe("Normalização e Formatação de Telefone", () => {
    it("normalizePhone extrai dígitos ou retorna null", () => {
      expect(normalizePhone("(27) 99999-8888")).toBe("27999998888");
      expect(normalizePhone("(27) 3333-2222")).toBe("2733332222");
      expect(normalizePhone("")).toBeNull();
      expect(normalizePhone(null)).toBeNull();
    });

    it("formatPhone formata números de 10 e 11 dígitos", () => {
      expect(formatPhone("27999998888")).toBe("(27) 99999-8888");
      expect(formatPhone("2733332222")).toBe("(27) 3333-2222");
      expect(formatPhone(null)).toBe("");
      expect(formatPhone("")).toBe("");
    });
  });

  describe("Schemas Zod de Entrada", () => {
    it("createSupplierInputSchema aceita dados válidos com valores padrão", () => {
      const parsed = createSupplierInputSchema.parse({
        corporateName: "  Distribuidora Exemplo Ltda  ",
        tradeName: " Exemplo Hortifruti ",
        taxId: "04.252.011/0001-10",
        taxInvoiceRule: "AFTER_WEIGHING",
        contactName: " Marcos ",
        contactPhone: " (27) 99999-0000 ",
        notes: " Entregar pela manhã ",
      });

      expect(parsed.corporateName).toBe("Distribuidora Exemplo Ltda");
      expect(parsed.tradeName).toBe("Exemplo Hortifruti");
      expect(parsed.taxId).toBe("04252011000110");
      expect(parsed.taxInvoiceRule).toBe("AFTER_WEIGHING");
      expect(parsed.contactName).toBe("Marcos");
      expect(parsed.contactPhone).toBe("27999990000");
      expect(parsed.notes).toBe("Entregar pela manhã");
    });

    it("createSupplierInputSchema rejeita razão social vazia", () => {
      const res = createSupplierInputSchema.safeParse({
        corporateName: "   ",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/razão social é obrigatória/i);
      }
    });

    it("updateSupplierInputSchema exige id e expectedVersion válidos", () => {
      const valid = updateSupplierInputSchema.safeParse({
        id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        corporateName: "Fornecedor Atualizado",
        expectedVersion: 2,
        taxInvoiceRule: "STANDARD",
      });
      expect(valid.success).toBe(true);

      const invalidVersion = updateSupplierInputSchema.safeParse({
        id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        corporateName: "Fornecedor Atualizado",
        expectedVersion: 0,
      });
      expect(invalidVersion.success).toBe(false);

      const invalidId = updateSupplierInputSchema.safeParse({
        id: "not-a-uuid",
        corporateName: "Fornecedor",
        expectedVersion: 1,
      });
      expect(invalidId.success).toBe(false);
    });

    it("toggleSupplierActiveInputSchema valida parâmetros de alternância de status", () => {
      const valid = toggleSupplierActiveInputSchema.safeParse({
        id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        active: false,
        expectedVersion: 1,
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("Classes de Erro Especializadas", () => {
    it("instancia corretamente SupplierValidationError, SupplierConflictError e SupplierNotFoundError", () => {
      const valErr = new SupplierValidationError("Dado inválido");
      expect(valErr.name).toBe("SupplierValidationError");
      expect(valErr.message).toBe("Dado inválido");

      const confErr = new SupplierConflictError("Conflito de versão");
      expect(confErr.name).toBe("SupplierConflictError");
      expect(confErr.message).toBe("Conflito de versão");

      const notFoundErr = new SupplierNotFoundError("Não encontrado");
      expect(notFoundErr.name).toBe("SupplierNotFoundError");
      expect(notFoundErr.message).toBe("Não encontrado");
    });
  });

  describe("Labels e Constantes", () => {
    it("possui descrições amigáveis de tipos de documento e regras de emissão de NF", () => {
      expect(TAX_ID_TYPE_LABELS.CNPJ).toBe("CNPJ");
      expect(TAX_ID_TYPE_LABELS.CPF).toBe("CPF");
      expect(TAX_ID_TYPE_LABELS.NOT_INFORMED).toBe("Não informado");

      expect(TAX_INVOICE_RULE_LABELS.STANDARD).toBe("Emissão normal");
      expect(TAX_INVOICE_RULE_LABELS.AFTER_WEIGHING).toBe("Após pesagem (banana)");
      expect(TAX_INVOICE_RULE_LABELS.SPECIAL_REGIME).toBe("Regime especial / produtor rural");
    });
  });
});
