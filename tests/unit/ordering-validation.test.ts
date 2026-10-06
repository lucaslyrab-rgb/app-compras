import { describe, expect, it } from "vitest";
import {
  formatOrderQuantity,
  getPurchaseFormatLabel,
  isDiscretePurchaseFormat,
  OrderValidationError,
  parseQuantityInput,
  validateOrderQuantity,
} from "@/modules/ordering/domain";

describe("ordering quantity validation and normalization", () => {
  describe("parseQuantityInput", () => {
    it("trata campos vazios, nulos e indefinidos como 0", () => {
      expect(parseQuantityInput("")).toBe(0);
      expect(parseQuantityInput("   ")).toBe(0);
      expect(parseQuantityInput(null)).toBe(0);
      expect(parseQuantityInput(undefined)).toBe(0);
    });

    it("converte inteiros e floats numéricos", () => {
      expect(parseQuantityInput(0)).toBe(0);
      expect(parseQuantityInput(5)).toBe(5);
      expect(parseQuantityInput(1.5)).toBe(1.5);
    });

    it("normaliza strings com vírgula pt-BR", () => {
      expect(parseQuantityInput("0,5")).toBe(0.5);
      expect(parseQuantityInput("1,5")).toBe(1.5);
      expect(parseQuantityInput("2,25")).toBe(2.25);
      expect(parseQuantityInput("  10,75  ")).toBe(10.75);
    });

    it("normaliza strings com ponto decimal", () => {
      expect(parseQuantityInput("0.5")).toBe(0.5);
      expect(parseQuantityInput("1.5")).toBe(1.5);
      expect(parseQuantityInput("2.25")).toBe(2.25);
    });

    it("rejeita strings com caracteres inválidos sem gerar NaN silencioso", () => {
      expect(parseQuantityInput("abc")).toBeNull();
      expect(parseQuantityInput("1.2.3")).toBeNull();
      expect(parseQuantityInput("0,5,5")).toBeNull();
      expect(parseQuantityInput("1e5")).toBeNull();
      expect(parseQuantityInput("Infinity")).toBeNull();
      expect(parseQuantityInput(NaN)).toBeNull();
    });

    it("rejeita valores negativos", () => {
      expect(parseQuantityInput("-1")).toBeNull();
      expect(parseQuantityInput("-0.5")).toBeNull();
      expect(parseQuantityInput("-2,5")).toBeNull();
      expect(parseQuantityInput(-5)).toBeNull();
    });
  });

  describe("isDiscretePurchaseFormat", () => {
    it("identifica embalagens discretas/fechadas com variações em maiúsculas e espaços", () => {
      expect(isDiscretePurchaseFormat("CX")).toBe(true);
      expect(isDiscretePurchaseFormat("cx")).toBe(true);
      expect(isDiscretePurchaseFormat("Cx")).toBe(true);
      expect(isDiscretePurchaseFormat("  CX  ")).toBe(true);
      expect(isDiscretePurchaseFormat("CAIXA")).toBe(true);
      expect(isDiscretePurchaseFormat("caixa")).toBe(true);

      expect(isDiscretePurchaseFormat("SC")).toBe(true);
      expect(isDiscretePurchaseFormat("sc")).toBe(true);
      expect(isDiscretePurchaseFormat("SACO")).toBe(true);

      expect(isDiscretePurchaseFormat("UND")).toBe(true);
      expect(isDiscretePurchaseFormat("und")).toBe(true);
      expect(isDiscretePurchaseFormat("UN")).toBe(true);
      expect(isDiscretePurchaseFormat("UNIDADE")).toBe(true);

      expect(isDiscretePurchaseFormat("PCT")).toBe(true);
      expect(isDiscretePurchaseFormat("pct")).toBe(true);
      expect(isDiscretePurchaseFormat("PACOTE")).toBe(true);

      expect(isDiscretePurchaseFormat("BDJ")).toBe(true);
      expect(isDiscretePurchaseFormat("bdj")).toBe(true);
      expect(isDiscretePurchaseFormat("BANDEJA")).toBe(true);

      expect(isDiscretePurchaseFormat("DZ")).toBe(true);
      expect(isDiscretePurchaseFormat("dúzia")).toBe(true);
      expect(isDiscretePurchaseFormat("FD")).toBe(true);
      expect(isDiscretePurchaseFormat("FARDO")).toBe(true);
      expect(isDiscretePurchaseFormat("maço")).toBe(true);
    });

    it("não considera formatos contínuos/pesáveis como discretos", () => {
      expect(isDiscretePurchaseFormat("KG")).toBe(false);
      expect(isDiscretePurchaseFormat("kg")).toBe(false);
      expect(isDiscretePurchaseFormat("G")).toBe(false);
      expect(isDiscretePurchaseFormat("L")).toBe(false);
      expect(isDiscretePurchaseFormat("ML")).toBe(false);
      expect(isDiscretePurchaseFormat("")).toBe(false);
      expect(isDiscretePurchaseFormat(null)).toBe(false);
      expect(isDiscretePurchaseFormat(undefined)).toBe(false);
    });
  });

  describe("getPurchaseFormatLabel", () => {
    it("retorna o rótulo amigável em minúsculas para mensagens", () => {
      expect(getPurchaseFormatLabel("CX")).toBe("caixa");
      expect(getPurchaseFormatLabel("CAIXA")).toBe("caixa");
      expect(getPurchaseFormatLabel("SC")).toBe("saco");
      expect(getPurchaseFormatLabel("SACO")).toBe("saco");
      expect(getPurchaseFormatLabel("UND")).toBe("unidade");
      expect(getPurchaseFormatLabel("UN")).toBe("unidade");
      expect(getPurchaseFormatLabel("UNIDADE")).toBe("unidade");
      expect(getPurchaseFormatLabel("PCT")).toBe("pacote");
      expect(getPurchaseFormatLabel("BDJ")).toBe("bandeja");
      expect(getPurchaseFormatLabel("DZ")).toBe("dúzia");
      expect(getPurchaseFormatLabel("FD")).toBe("fardo");
      expect(getPurchaseFormatLabel("KG")).toBe("kg");
      expect(getPurchaseFormatLabel(null)).toBe("unidade");
    });
  });

  describe("validateOrderQuantity", () => {
    describe("formatos discretos (CX, SC, UND, PCT, BDJ)", () => {
      it("aceita valores inteiros e vazios", () => {
        expect(validateOrderQuantity("", "CX")).toEqual({ valid: true, parsedValue: 0 });
        expect(validateOrderQuantity("0", "CX")).toEqual({ valid: true, parsedValue: 0 });
        expect(validateOrderQuantity("1", "CX")).toEqual({ valid: true, parsedValue: 1 });
        expect(validateOrderQuantity("15", "CX")).toEqual({ valid: true, parsedValue: 15 });
      });

      it("rejeita valores fracionados em caixa (CX) com mensagem contextualizada", () => {
        const result05 = validateOrderQuantity("0,5", "CX");
        expect(result05.valid).toBe(false);
        expect(result05.error).toBe("Informe uma quantidade inteira. Para este produto não é permitido 0,5 caixa.");

        const result15 = validateOrderQuantity("1,5", "CX");
        expect(result15.valid).toBe(false);
        expect(result15.error).toBe("Informe uma quantidade inteira. Para este produto não é permitido 1,5 caixa.");

        const result225 = validateOrderQuantity("2,25", "CX");
        expect(result225.valid).toBe(false);
        expect(result225.error).toBe("Informe uma quantidade inteira. Para este produto não é permitido 2,25 caixa.");

        const resultDot = validateOrderQuantity("0.5", "CX");
        expect(resultDot.valid).toBe(false);
        expect(resultDot.error).toBe("Informe uma quantidade inteira. Para este produto não é permitido 0.5 caixa.");
      });

      it("rejeita valores fracionados em saco (SC)", () => {
        const result = validateOrderQuantity("1,5", "SC");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Informe uma quantidade inteira. Para este produto não é permitido 1,5 saco.");
      });

      it("rejeita valores fracionados em unidade (UND)", () => {
        const result = validateOrderQuantity("0,5", "UND");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Informe uma quantidade inteira. Para este produto não é permitido 0,5 unidade.");
      });

      it("rejeita valores fracionados em pacote (PCT)", () => {
        const result = validateOrderQuantity("0,5", "PCT");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Informe uma quantidade inteira. Para este produto não é permitido 0,5 pacote.");
      });

      it("rejeita valores fracionados em bandeja (BDJ)", () => {
        const result = validateOrderQuantity("0,5", "BDJ");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Informe uma quantidade inteira. Para este produto não é permitido 0,5 bandeja.");
      });

      it("rejeita entrada em edição terminada em vírgula", () => {
        const result = validateOrderQuantity("1,", "CX");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Informe uma quantidade inteira. Para este produto não é permitido 1, caixa.");
      });

      it("rejeita texto não numérico", () => {
        const result = validateOrderQuantity("abc", "CX");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Informe uma quantidade válida.");
      });
    });

    describe("formatos contínuos (KG, etc.)", () => {
      it("aceita quantidades fracionadas normalmente", () => {
        expect(validateOrderQuantity("0,5", "KG")).toEqual({ valid: true, parsedValue: 0.5 });
        expect(validateOrderQuantity("1,5", "KG")).toEqual({ valid: true, parsedValue: 1.5 });
        expect(validateOrderQuantity("2.25", "KG")).toEqual({ valid: true, parsedValue: 2.25 });
        expect(validateOrderQuantity("", "KG")).toEqual({ valid: true, parsedValue: 0 });
        expect(validateOrderQuantity("10", "KG")).toEqual({ valid: true, parsedValue: 10 });
      });

      it("rejeita valores não numéricos em KG", () => {
        const result = validateOrderQuantity("abc", "KG");
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Informe uma quantidade válida.");
      });
    });

    describe("diferenciação rigorosa: Estoque vs Pedido", () => {
      it("campo Estoque aceita fracionado para produtos em formato discreto", () => {
        // parseQuantityInput é usado para validar o estoque
        expect(parseQuantityInput("0,5")).toBe(0.5);
        expect(parseQuantityInput("1,5")).toBe(1.5);
        expect(parseQuantityInput("2,25")).toBe(2.25);
      });
    });
  });

  describe("formatOrderQuantity", () => {
    it("formata números e strings normalizadas em pt-BR", () => {
      expect(formatOrderQuantity(0)).toBe("0");
      expect(formatOrderQuantity(1)).toBe("1");
      expect(formatOrderQuantity(0.5)).toBe("0,5");
      expect(formatOrderQuantity("0,5")).toBe("0,5");
      expect(formatOrderQuantity("1,5")).toBe("1,5");
      expect(formatOrderQuantity("2.25")).toBe("2,25");
    });
  });

  describe("OrderValidationError", () => {
    it("instancia com nome correto e mensagem", () => {
      const err = new OrderValidationError("Erro de validação de pedido");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("OrderValidationError");
      expect(err.message).toBe("Erro de validação de pedido");
    });
  });
});
