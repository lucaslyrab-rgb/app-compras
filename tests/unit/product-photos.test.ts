import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";
import {
  detectImageFormat,
  validateAndProcessPhoto,
  generateProductPhotoKey,
  PhotoValidationError,
  MAX_PHOTO_BYTES,
} from "@/lib/s3-photos";
import { uploadProductPhotoService, removeProductPhotoService } from "@/modules/catalog/service";
import { toIsoDateString } from "@/modules/catalog/domain";
import * as catalogRepo from "@/modules/catalog/repository";
import * as s3Photos from "@/lib/s3-photos";
import type { Principal } from "@/modules/identity";

describe("fotos de produtos - biblioteca S3 e processamento de imagem", () => {
  it("detecta formatos válidos por magic bytes", async () => {
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

  it("rejeita buffers inválidos, vazios ou com outros formatos (PDF, GIF, texto)", () => {
    expect(detectImageFormat(Buffer.alloc(0))).toBeNull();
    expect(detectImageFormat(Buffer.from("short"))).toBeNull();
    expect(detectImageFormat(Buffer.from("%PDF-1.4 header text"))).toBeNull();
    expect(detectImageFormat(Buffer.from("GIF89a1234567890"))).toBeNull();
    expect(detectImageFormat(Buffer.from("<html><body>not image</body></html>"))).toBeNull();
  });

  it("rejeita arquivos que excedem o limite de 5 MB", async () => {
    const hugeBuffer = Buffer.alloc(MAX_PHOTO_BYTES + 1);
    hugeBuffer[0] = 0xff;
    hugeBuffer[1] = 0xd8;
    hugeBuffer[2] = 0xff;

    await expect(validateAndProcessPhoto(hugeBuffer)).rejects.toThrow(
      "O tamanho da imagem excede o limite permitido de 5 MB."
    );
  });

  it("rejeita arquivos corrompidos mesmo que comecem com magic bytes válidos", async () => {
    const corruptedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x00]);
    await expect(validateAndProcessPhoto(corruptedJpeg)).rejects.toThrow(PhotoValidationError);
  });

  it("redimensiona imagens grandes mantendo proporção e limite 600x600", async () => {
    const largeJpeg = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 100, g: 150, b: 200 } },
    }).jpeg().toBuffer();

    const result = await validateAndProcessPhoto(largeJpeg);
    expect(result.width).toBe(600);
    expect(result.height).toBe(400);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(400);
  });

  it("não amplia imagens menores que 600x600 (withoutEnlargement)", async () => {
    const smallPng = await sharp({
      create: { width: 250, height: 180, channels: 3, background: { r: 50, g: 100, b: 150 } },
    }).png().toBuffer();

    const result = await validateAndProcessPhoto(smallPng);
    expect(result.width).toBe(250);
    expect(result.height).toBe(180);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(250);
    expect(meta.height).toBe(180);
  });

  it("remove metadados EXIF/ICC e converte para WebP qualidade 80", async () => {
    const withExif = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const result = await validateAndProcessPhoto(withExif);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
  });

  it("gera chaves no padrão seguro products/{productId}/{uuid}.webp", () => {
    const productId = "123e4567-e89b-12d3-a456-426614174000";
    const key = generateProductPhotoKey(productId);

    expect(key).toMatch(
      /^products\/123e4567-e89b-12d3-a456-426614174000\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/
    );
  });
});

describe("serviço de catálogo - upload e remoção de foto", () => {
  const gestorPrincipal: Principal = {
    userId: "00000000-0000-0000-0000-000000000001",
    role: "GESTOR",
    storeId: null,
  };

  const compradorPrincipal: Principal = {
    userId: "00000000-0000-0000-0000-000000000002",
    role: "COMPRADOR",
    storeId: null,
  };

  const lojaPrincipal: Principal = {
    userId: "00000000-0000-0000-0000-000000000003",
    role: "LOJA",
    storeId: "store-1",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("restringe upload e remoção exclusivamente ao perfil GESTOR", async () => {
    const fakeBuffer = Buffer.from("dummy");

    await expect(
      uploadProductPhotoService(compradorPrincipal, "prod-1", fakeBuffer, 1)
    ).rejects.toThrow(/Gestor/);

    await expect(
      uploadProductPhotoService(lojaPrincipal, "prod-1", fakeBuffer, 1)
    ).rejects.toThrow(/Gestor/);

    await expect(
      removeProductPhotoService(compradorPrincipal, "prod-1", 1)
    ).rejects.toThrow(/Gestor/);

    await expect(
      removeProductPhotoService(lojaPrincipal, "prod-1", 1)
    ).rejects.toThrow(/Gestor/);
  });

  it("executa fluxo completo de upload com sucesso", async () => {
    const validImage = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).png().toBuffer();

    const uploadSpy = vi.spyOn(s3Photos, "uploadPhotoToS3").mockResolvedValue(undefined);
    const deleteSpy = vi.spyOn(s3Photos, "deletePhotoFromS3").mockResolvedValue(undefined);

    const fixedDate = "2026-09-29T17:00:00.000Z";
    const repoSpy = vi.spyOn(catalogRepo, "setProductPhoto").mockResolvedValue({
      updated: {
        id: "prod-10",
        photoKey: "products/prod-10/new-uuid.webp",
        photoUpdatedAt: fixedDate,
        version: 2,
      },
      oldPhotoKey: null,
    });

    const result = await uploadProductPhotoService(gestorPrincipal, "prod-10", validImage, 1);

    expect(uploadSpy).toHaveBeenCalledOnce();
    expect(repoSpy).toHaveBeenCalledWith(gestorPrincipal, "prod-10", expect.stringContaining("products/prod-10/"), 1);
    expect(deleteSpy).not.toHaveBeenCalled(); // Não tinha foto antiga
    expect(result.version).toBe(2);
    expect(result.photoUpdatedAt).toBe("2026-09-29T17:00:00.000Z");
  });

  it("substitui foto existente e remove a chave antiga do S3 após commit no banco", async () => {
    const validImage = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).jpeg().toBuffer();

    const uploadSpy = vi.spyOn(s3Photos, "uploadPhotoToS3").mockResolvedValue(undefined);
    const deleteSpy = vi.spyOn(s3Photos, "deletePhotoFromS3").mockResolvedValue(undefined);

    const oldKey = "products/prod-10/old-uuid.webp";
    vi.spyOn(catalogRepo, "setProductPhoto").mockResolvedValue({
      updated: {
        id: "prod-10",
        photoKey: "products/prod-10/new-uuid.webp",
        photoUpdatedAt: "2026-09-29T17:10:00.000Z",
        version: 3,
      },
      oldPhotoKey: oldKey,
    });

    const result = await uploadProductPhotoService(gestorPrincipal, "prod-10", validImage, 2);

    expect(uploadSpy).toHaveBeenCalledOnce();
    expect(deleteSpy).toHaveBeenCalledWith(oldKey);
    expect(result.version).toBe(3);
  });

  it("limpa objeto recém-enviado ao S3 se a atualização do banco falhar (evita órfãos)", async () => {
    const validImage = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).jpeg().toBuffer();

    const uploadSpy = vi.spyOn(s3Photos, "uploadPhotoToS3").mockResolvedValue(undefined);
    const deleteSpy = vi.spyOn(s3Photos, "deletePhotoFromS3").mockResolvedValue(undefined);

    vi.spyOn(catalogRepo, "setProductPhoto").mockRejectedValue(new Error("Erro de banco / concorrência"));

    await expect(
      uploadProductPhotoService(gestorPrincipal, "prod-10", validImage, 1)
    ).rejects.toThrow("Erro de banco / concorrência");

    expect(uploadSpy).toHaveBeenCalledOnce();
    // Confirma que a nova chave enviada ao S3 foi deletada para não deixar lixo órfão
    expect(deleteSpy).toHaveBeenCalledOnce();
    const deletedKey = deleteSpy.mock.calls[0][0];
    expect(deletedKey).toMatch(/^products\/prod-10\/.*\.webp$/);
  });

  it("executa remoção de foto com atualização no banco e exclusão no S3", async () => {
    const deleteSpy = vi.spyOn(s3Photos, "deletePhotoFromS3").mockResolvedValue(undefined);

    const oldKey = "products/prod-10/to-delete.webp";
    const repoSpy = vi.spyOn(catalogRepo, "removeProductPhoto").mockResolvedValue({
      updated: {
        id: "prod-10",
        photoKey: null,
        photoUpdatedAt: "2026-09-29T17:20:00.000Z",
        version: 4,
      },
      oldPhotoKey: oldKey,
    });

    const result = await removeProductPhotoService(gestorPrincipal, "prod-10", 3);

    expect(repoSpy).toHaveBeenCalledWith(gestorPrincipal, "prod-10", 3);
    expect(deleteSpy).toHaveBeenCalledWith(oldKey);
    expect(result.photoKey).toBeNull();
    expect(result.version).toBe(4);
  });

  it("não falha a operação de remoção no serviço se DeleteObject no S3 falhar após commit no banco", async () => {
    vi.spyOn(catalogRepo, "removeProductPhoto").mockResolvedValue({
      updated: {
        id: "prod-10",
        photoKey: null,
        photoUpdatedAt: "2026-09-29T17:30:00.000Z",
        version: 5,
      },
      oldPhotoKey: "products/prod-10/cannot-delete.webp",
    });

    vi.spyOn(s3Photos, "deletePhotoFromS3").mockRejectedValue(new Error("S3 Delete Network Error"));

    const result = await removeProductPhotoService(gestorPrincipal, "prod-10", 4);
    expect(result.photoKey).toBeNull();
    expect(result.version).toBe(5);
  });

  it("regressão: trata photoUpdatedAt retornado como string pelo banco sem lançar toISOString is not a function", async () => {
    const validImage = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).png().toBuffer();

    vi.spyOn(s3Photos, "uploadPhotoToS3").mockResolvedValue(undefined);
    vi.spyOn(s3Photos, "deletePhotoFromS3").mockResolvedValue(undefined);

    // Simula o comportamento exato ocorrido em produção: o driver PostgreSQL
    // retorna photo_updated_at como string (ex: "2026-09-29 18:00:00.123+00")
    // em vez de uma instância de Date.
    const pgTimestampString = "2026-09-29 18:00:00.123+00";
    vi.spyOn(catalogRepo, "setProductPhoto").mockResolvedValue({
      updated: {
        id: "prod-abacate",
        photoKey: "products/prod-abacate/uuid-abacate.webp",
        photoUpdatedAt: pgTimestampString,
        version: 2,
      },
      oldPhotoKey: null,
    });

    const result = await uploadProductPhotoService(gestorPrincipal, "prod-abacate", validImage, 1);

    expect(result.id).toBe("prod-abacate");
    expect(result.version).toBe(2);
    expect(result.photoKey).toBe("products/prod-abacate/uuid-abacate.webp");
    expect(typeof result.photoUpdatedAt).toBe("string");
    expect(result.photoUpdatedAt).toBe("2026-09-29T18:00:00.123Z");
  });

  it("regressão: trata photoUpdatedAt retornado como string na remoção de foto sem lançar toISOString is not a function", async () => {
    vi.spyOn(s3Photos, "deletePhotoFromS3").mockResolvedValue(undefined);

    const pgTimestampString = "2026-09-29 18:30:00.456+00";
    vi.spyOn(catalogRepo, "removeProductPhoto").mockResolvedValue({
      updated: {
        id: "prod-abacate",
        photoKey: null,
        photoUpdatedAt: pgTimestampString,
        version: 3,
      },
      oldPhotoKey: "products/prod-abacate/uuid-abacate.webp",
    });

    const result = await removeProductPhotoService(gestorPrincipal, "prod-abacate", 2);

    expect(result.id).toBe("prod-abacate");
    expect(result.version).toBe(3);
    expect(result.photoKey).toBeNull();
    expect(typeof result.photoUpdatedAt).toBe("string");
    expect(result.photoUpdatedAt).toBe("2026-09-29T18:30:00.456Z");
  });

  it("regressão: trata photoUpdatedAt nulo ou indefinido sem lançar exceção", async () => {
    vi.spyOn(s3Photos, "deletePhotoFromS3").mockResolvedValue(undefined);

    vi.spyOn(catalogRepo, "removeProductPhoto").mockResolvedValue({
      updated: {
        id: "prod-abacate",
        photoKey: null,
        photoUpdatedAt: null,
        version: 4,
      },
      oldPhotoKey: null,
    });

    const result = await removeProductPhotoService(gestorPrincipal, "prod-abacate", 3);
    expect(result.photoUpdatedAt).toBeNull();
  });
});

describe("normalização de datas (toIsoDateString)", () => {
  it("converte objeto Date válido para string ISO", () => {
    const date = new Date("2026-09-29T18:00:00.000Z");
    expect(toIsoDateString(date)).toBe("2026-09-29T18:00:00.000Z");
  });

  it("converte string ISO para string ISO normalizada", () => {
    expect(toIsoDateString("2026-09-29T18:00:00.000Z")).toBe("2026-09-29T18:00:00.000Z");
  });

  it("converte string de timestamp do PostgreSQL para string ISO", () => {
    const pgTimestamp = "2026-09-29 18:00:00.123+00";
    expect(toIsoDateString(pgTimestamp)).toBe("2026-09-29T18:00:00.123Z");
  });

  it("retorna null para Date inválida", () => {
    const invalidDate = new Date("invalid-date-string");
    expect(toIsoDateString(invalidDate)).toBeNull();
  });

  it("retorna null para string inválida, vazia ou apenas espaços", () => {
    expect(toIsoDateString("not-a-date")).toBeNull();
    expect(toIsoDateString("")).toBeNull();
    expect(toIsoDateString("   ")).toBeNull();
  });

  it("retorna null para null ou undefined", () => {
    expect(toIsoDateString(null)).toBeNull();
    expect(toIsoDateString(undefined)).toBeNull();
  });
});
