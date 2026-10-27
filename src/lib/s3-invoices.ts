import fs from "node:fs";
import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import sharp, { type Metadata } from "sharp";
import { InvoiceValidationError } from "@/modules/purchasing/invoices/domain";

export { InvoiceValidationError };

export const MAX_INVOICE_BYTES = 10 * 1024 * 1024; // 10 MB

let s3ClientInstance: S3Client | null = null;

function readSecret(fileEnvVar: string, defaultFilePath: string, directEnvVar?: string): string | undefined {
  const filePath = process.env[fileEnvVar] || defaultFilePath;
  if (filePath && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (content) return content;
    } catch {
      // Ignora erro de leitura e tenta fallback
    }
  }
  if (directEnvVar && process.env[directEnvVar]) {
    return process.env[directEnvVar]?.trim();
  }
  return undefined;
}

export function getS3InvoicesClient(): S3Client {
  if (!s3ClientInstance) {
    const accessKeyId =
      readSecret(
        "S3_INVOICES_ACCESS_KEY_ID_FILE",
        "/run/secrets/app_compras_s3_invoices_access_key_id",
        "S3_INVOICES_ACCESS_KEY_ID"
      ) ||
      readSecret(
        "S3_PHOTOS_ACCESS_KEY_ID_FILE",
        "/run/secrets/app_compras_s3_photos_access_key_id",
        "S3_PHOTOS_ACCESS_KEY_ID"
      ) ||
      process.env.AWS_ACCESS_KEY_ID;

    const secretAccessKey =
      readSecret(
        "S3_INVOICES_SECRET_ACCESS_KEY_FILE",
        "/run/secrets/app_compras_s3_invoices_secret_access_key",
        "S3_INVOICES_SECRET_ACCESS_KEY"
      ) ||
      readSecret(
        "S3_PHOTOS_SECRET_ACCESS_KEY_FILE",
        "/run/secrets/app_compras_s3_photos_secret_access_key",
        "S3_PHOTOS_SECRET_ACCESS_KEY"
      ) ||
      process.env.AWS_SECRET_ACCESS_KEY;

    const region = process.env.S3_INVOICES_REGION || process.env.S3_PHOTOS_REGION || "us-east-1";

    if (!accessKeyId || !secretAccessKey) {
      throw new Error("Credenciais S3 de notas fiscais não configuradas.");
    }

    s3ClientInstance = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }
  return s3ClientInstance;
}

export function setS3InvoicesClientForTesting(client: S3Client | null) {
  s3ClientInstance = client;
}

export function getS3InvoicesBucket(): string {
  return process.env.S3_INVOICES_BUCKET || "compras-notas";
}

export function detectImageFormat(buffer: Buffer): "jpeg" | "png" | "webp" | null {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  // WebP: RIFF .... WEBP
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

export async function validateAndProcessInvoiceImage(buffer: Buffer): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  if (!buffer || buffer.length === 0) {
    throw new InvoiceValidationError("Arquivo de imagem vazio.");
  }

  if (buffer.length > MAX_INVOICE_BYTES) {
    throw new InvoiceValidationError("O tamanho da imagem excede o limite permitido de 10 MB.");
  }

  const detected = detectImageFormat(buffer);
  if (!detected) {
    throw new InvoiceValidationError("Formato de imagem não suportado. Envie um arquivo JPEG, PNG ou WebP válido.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch {
    throw new InvoiceValidationError("Arquivo de imagem corrompido ou inválido.");
  }

  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new InvoiceValidationError("Formato interno da imagem não suportado.");
  }

  if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
    throw new InvoiceValidationError("Dimensões da imagem inválidas.");
  }

  try {
    // Pipeline com sharp para documentos/notas fiscais:
    // 1. .rotate(): auto-orienta baseado em EXIF Orientation (crítico para celulares)
    // 2. .resize(): max 1600x1600 px mantendo legibilidade de textos e números fiscais
    // 3. .webp({ quality: 85 }): converte para WebP preservando nitidez
    const processedBuffer = await sharp(buffer)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();

    const processedMetadata = await sharp(processedBuffer).metadata();
    if (processedMetadata.format !== "webp") {
      throw new InvoiceValidationError("Falha ao converter a imagem para WebP.");
    }

    return {
      buffer: processedBuffer,
      width: processedMetadata.width ?? 0,
      height: processedMetadata.height ?? 0,
    };
  } catch (err) {
    if (err instanceof InvoiceValidationError) throw err;
    throw new InvoiceValidationError("Falha ao processar a fotografia da nota fiscal.");
  }
}

export function generateInvoiceKey(
  cycleDate: string,
  storeId: string,
  supplierId: string
): string {
  const uniqueId = crypto.randomUUID();
  const sanitizedCycle = cycleDate.replace(/[^0-9-]/g, "");
  return `invoices/${sanitizedCycle}/${storeId}/${supplierId}/${uniqueId}.webp`;
}

export async function uploadInvoiceToS3(key: string, buffer: Buffer): Promise<void> {
  const client = getS3InvoicesClient();
  const bucket = getS3InvoicesBucket();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/webp",
      CacheControl: "private, max-age=31536000, immutable",
    })
  );
}

export async function deleteInvoiceFromS3(key: string): Promise<void> {
  const client = getS3InvoicesClient();
  const bucket = getS3InvoicesBucket();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

export async function getInvoiceFromS3(key: string) {
  const client = getS3InvoicesClient();
  const bucket = getS3InvoicesBucket();

  return client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}
