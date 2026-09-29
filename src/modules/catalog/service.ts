import type { Principal } from "@/modules/identity";
import { authorizeProductManagement, toIsoDateString, type ProductPhotoDto } from "./domain";
import { setProductPhoto, removeProductPhoto } from "./repository";
import {
  validateAndProcessPhoto,
  generateProductPhotoKey,
  uploadPhotoToS3,
  deletePhotoFromS3,
} from "@/lib/s3-photos";

export async function uploadProductPhotoService(
  principal: Principal,
  productId: string,
  fileBuffer: Buffer,
  expectedVersion: number
) {
  authorizeProductManagement(principal);

  // 1. Valida e processa imagem com sharp (JPEG/PNG/WebP -> WebP 600x600 q80)
  const { buffer: processedBuffer } = await validateAndProcessPhoto(fileBuffer);

  // 2. Gera chave única sob products/{productId}/{uuid}.webp
  const newPhotoKey = generateProductPhotoKey(productId);

  // 3. PutObject no S3
  await uploadPhotoToS3(newPhotoKey, processedBuffer);

  // 4. Atualiza registro no PostgreSQL com controle de concorrência
  let result: {
    updated: ProductPhotoDto;
    oldPhotoKey: string | null;
  };

  try {
    result = await setProductPhoto(principal, productId, newPhotoKey, expectedVersion);
  } catch (dbError) {
    // Se o banco falhar ou houver conflito de concorrência:
    // Remove o objeto recém-enviado para não deixar lixo órfão no S3
    try {
      await deletePhotoFromS3(newPhotoKey);
    } catch (cleanupErr) {
      console.error(
        "[S3_CLEANUP_ORPHAN_ERROR]",
        cleanupErr instanceof Error ? cleanupErr.message : cleanupErr
      );
    }
    throw dbError;
  }

  // 5. Após commit no banco, remove a foto anterior (se houver)
  if (result.oldPhotoKey && result.oldPhotoKey !== newPhotoKey) {
    try {
      await deletePhotoFromS3(result.oldPhotoKey);
    } catch (delError) {
      console.error(
        "[S3_DELETE_OLD_PHOTO_ERROR]",
        delError instanceof Error ? delError.message : delError
      );
      // Não reverte o banco: a nova foto já é válida e está persistida
    }
  }

  return {
    id: result.updated.id,
    version: result.updated.version,
    photoKey: result.updated.photoKey,
    photoUpdatedAt: toIsoDateString(result.updated.photoUpdatedAt),
  };
}

export async function removeProductPhotoService(
  principal: Principal,
  productId: string,
  expectedVersion: number
): Promise<ProductPhotoDto> {
  authorizeProductManagement(principal);

  // 1. Atualiza registro no banco para photo_key = NULL
  const result = await removeProductPhoto(principal, productId, expectedVersion);

  // 2. Após commit no banco, remove o objeto no S3
  if (result.oldPhotoKey) {
    try {
      await deletePhotoFromS3(result.oldPhotoKey);
    } catch (delError) {
      console.error(
        "[S3_DELETE_PHOTO_ERROR]",
        delError instanceof Error ? delError.message : delError
      );
      // Não reverte o banco
    }
  }

  return {
    id: result.updated.id,
    version: result.updated.version,
    photoKey: result.updated.photoKey,
    photoUpdatedAt: toIsoDateString(result.updated.photoUpdatedAt),
  };
}
