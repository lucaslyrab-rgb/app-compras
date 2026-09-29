import fs from "node:fs";
import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import sharp, { type Metadata } from "sharp";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

export class PhotoValidationError extends Error {
  override name = "PhotoValidationError";
}

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

export function getS3PhotosClient(): S3Client {
  if (!s3ClientInstance) {
    const accessKeyId =
      readSecret(
        "S3_PHOTOS_ACCESS_KEY_ID_FILE",
        "/run/secrets/app_compras_s3_photos_access_key_id",
        "S3_PHOTOS_ACCESS_KEY_ID"
      ) || process.env.AWS_ACCESS_KEY_ID;

    const secretAccessKey =
      readSecret(
        "S3_PHOTOS_SECRET_ACCESS_KEY_FILE",
        "/run/secrets/app_compras_s3_photos_secret_access_key",
        "S3_PHOTOS_SECRET_ACCESS_KEY"
      ) || process.env.AWS_SECRET_ACCESS_KEY;

    const region = process.env.S3_PHOTOS_REGION || "us-east-1";

    if (!accessKeyId || !secretAccessKey) {
      throw new Error("Credenciais S3 de fotos não configuradas.");
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

export function setS3PhotosClientForTesting(client: S3Client | null) {
  s3ClientInstance = client;
}

export function getS3PhotosBucket(): string {
  return process.env.S3_PHOTOS_BUCKET || "compras-img";
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

export async function validateAndProcessPhoto(buffer: Buffer): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  if (!buffer || buffer.length === 0) {
    throw new PhotoValidationError("Arquivo de imagem vazio.");
  }

  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new PhotoValidationError("O tamanho da imagem excede o limite permitido de 5 MB.");
  }

  const detected = detectImageFormat(buffer);
  if (!detected) {
    throw new PhotoValidationError("Formato de imagem não suportado. Envie um arquivo JPEG, PNG ou WebP válido.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch {
    throw new PhotoValidationError("Arquivo de imagem corrompido ou inválido.");
  }

  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new PhotoValidationError("Formato interno da imagem não suportado.");
  }

  if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
    throw new PhotoValidationError("Dimensões da imagem inválidas.");
  }

  try {
    // Pipeline com sharp:
    // 1. .rotate(): auto-orienta baseado em EXIF Orientation
    // 2. .resize(): no máximo 600x600 px, mantendo proporção, sem ampliar pequenas
    // 3. .webp({ quality: 80 }): converte para WebP e descarta metadados EXIF/ICC
    const processedBuffer = await sharp(buffer)
      .rotate()
      .resize({
        width: 600,
        height: 600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();

    const processedMetadata = await sharp(processedBuffer).metadata();
    if (processedMetadata.format !== "webp") {
      throw new PhotoValidationError("Falha ao converter a imagem para WebP.");
    }

    return {
      buffer: processedBuffer,
      width: processedMetadata.width ?? 0,
      height: processedMetadata.height ?? 0,
    };
  } catch (err) {
    if (err instanceof PhotoValidationError) throw err;
    throw new PhotoValidationError("Falha ao processar a imagem do produto.");
  }
}

export function generateProductPhotoKey(productId: string): string {
  const uniqueId = crypto.randomUUID();
  return `products/${productId}/${uniqueId}.webp`;
}

export async function uploadPhotoToS3(key: string, buffer: Buffer): Promise<void> {
  const client = getS3PhotosClient();
  const bucket = getS3PhotosBucket();

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

export async function deletePhotoFromS3(key: string): Promise<void> {
  const client = getS3PhotosClient();
  const bucket = getS3PhotosBucket();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

export async function getPhotoFromS3(key: string) {
  const client = getS3PhotosClient();
  const bucket = getS3PhotosBucket();

  return client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}
