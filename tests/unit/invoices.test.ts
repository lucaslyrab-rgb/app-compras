import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  detectImageFormat,
  validateAndProcessInvoiceImage,
  generateInvoiceKey,
  InvoiceValidationError,
  MAX_INVOICE_BYTES,
} from "@/lib/s3-invoices";
import { validateInvoiceNumber } from "@/modules/purchasing/invoices/domain";

describe("Fase 4 - Registro de Notas Fiscais e Processamento S3", () => {
  describe("validateInvoiceNumber", () => {
    it("aceita números de nota válidos com espaços removidos", () => {
      expect(validateInvoiceNumber("12345")).toBe("12345");
      expect(validateInvoiceNumber("  NF-e 00982-A  ")).toBe("NF-e 00982-A");
      expect(validateInvoiceNumber("000123/2026")).toBe("000123/2026");
    });

    it("rejeita número de nota vazio ou apenas espaços", () => {
      expect(() => validateInvoiceNumber("")).toThrow("Número da nota fiscal é obrigatório.");
      expect(() => validateInvoiceNumber("   ")).toThrow("Número da nota fiscal é obrigatório.");
    });

    it("rejeita tipos inválidos", () => {
      expect(() => validateInvoiceNumber(null)).toThrow("Número da nota fiscal deve ser um texto.");
      expect(() => validateInvoiceNumber(12345)).toThrow("Número da nota fiscal deve ser um texto.");
      expect(() => validateInvoiceNumber(undefined)).toThrow("Número da nota fiscal deve ser um texto.");
    });

    it("rejeita strings muito longas (> 100 caracteres)", () => {
      const longNumber = "A".repeat(101);
      expect(() => validateInvoiceNumber(longNumber)).toThrow("Número da nota fiscal não pode exceder 100 caracteres.");
    });
  });

  describe("detectImageFormat", () => {
    it("detecta formatos válidos por magic bytes (JPEG, PNG, WebP)", async () => {
      const jpegBuffer = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
      }).jpeg().toBuffer();
      expect(detectImageFormat(jpegBuffer)).toBe("jpeg");

      const pngBuffer = await sharp({
        create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
      }).png().toBuffer();
      expect(detectImageFormat(pngBuffer)).toBe("png");

      const webpBuffer = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } },
      }).webp().toBuffer();
      expect(detectImageFormat(webpBuffer)).toBe("webp");
    });

    it("rejeita buffers inválidos, vazios ou formatos incompatíveis", () => {
      expect(detectImageFormat(Buffer.alloc(0))).toBeNull();
      expect(detectImageFormat(Buffer.from("short"))).toBeNull();
      expect(detectImageFormat(Buffer.from("%PDF-1.4 header text"))).toBeNull();
      expect(detectImageFormat(Buffer.from("<html><body>not image</body></html>"))).toBeNull();
    });
  });

  describe("validateAndProcessInvoiceImage", () => {
    it("rejeita arquivo vazio", async () => {
      await expect(validateAndProcessInvoiceImage(Buffer.alloc(0))).rejects.toThrow(
        "Arquivo de imagem vazio."
      );
    });

    it("rejeita arquivos que excedem o limite de 10 MB", async () => {
      const hugeBuffer = Buffer.alloc(MAX_INVOICE_BYTES + 1);
      hugeBuffer[0] = 0xff;
      hugeBuffer[1] = 0xd8;
      hugeBuffer[2] = 0xff;

      await expect(validateAndProcessInvoiceImage(hugeBuffer)).rejects.toThrow(
        "O tamanho da imagem excede o limite permitido de 10 MB."
      );
    });

    it("rejeita arquivos corrompidos", async () => {
      const corruptedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x00]);
      await expect(validateAndProcessInvoiceImage(corruptedJpeg)).rejects.toThrow(
        InvoiceValidationError
      );
    });

    it("processa imagem válida convertendo para WebP mantendo proporção e limite legível de até 1600x1600", async () => {
      const highResBuffer = await sharp({
        create: { width: 2400, height: 1800, channels: 3, background: { r: 250, g: 250, b: 250 } },
      }).jpeg().toBuffer();

      const result = await validateAndProcessInvoiceImage(highResBuffer);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.width).toBeLessThanOrEqual(1600);
      expect(result.height).toBeLessThanOrEqual(1600);

      // Confirma que a saída é um WebP legível
      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(1600);
      expect(metadata.height).toBe(1200);
    });
  });

  describe("generateInvoiceKey", () => {
    it("gera caminho seguro com ciclo, loja e fornecedor", () => {
      const key = generateInvoiceKey("2026-10-27", "store-123", "supp-456");
      expect(key).toMatch(/^invoices\/2026-10-27\/store-123\/supp-456\/[a-f0-9-]+\.webp$/);
    });

    it("sanitiza caracteres inválidos na data do ciclo", () => {
      const key = generateInvoiceKey("2026/10/27;rm", "store-1", "supp-2");
      expect(key).toMatch(/^invoices\/20261027\/store-1\/supp-2\/[a-f0-9-]+\.webp$/);
    });
  });
});
