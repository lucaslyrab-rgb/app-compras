import {
  generateInvoiceKey,
  uploadInvoiceToS3,
  deleteInvoiceFromS3,
  validateAndProcessInvoiceImage,
} from "@/lib/s3-invoices";
import { log } from "@/shared/logging";
import { validateInvoiceNumber, type InvoiceRecord } from "./domain";
import { createInvoiceRecord, deleteInvoiceRecord } from "./repository";

export async function registerInvoiceService(data: {
  cycleDate: string;
  storeId: string;
  supplierId: string;
  invoiceNumber: string;
  imageBuffer: Buffer;
  notes?: string | null;
  createdBy?: string | null;
  productIds?: string[];
}): Promise<InvoiceRecord> {
  const sanitizedInvoiceNumber = validateInvoiceNumber(data.invoiceNumber);

  // 1. Valida e processa imagem com Sharp (auto-orientação e max 1600px para nitidez de texto)
  const processed = await validateAndProcessInvoiceImage(data.imageBuffer);

  // 2. Gera chave única no S3
  const s3Key = generateInvoiceKey(data.cycleDate, data.storeId, data.supplierId);

  // 3. Envia para o S3
  await uploadInvoiceToS3(s3Key, processed.buffer);

  try {
    // 4. Persiste no banco de dados com auditoria atômica e vinculação validada dos produtos destinados
    const invoice = await createInvoiceRecord({
      cycleDate: data.cycleDate,
      storeId: data.storeId,
      supplierId: data.supplierId,
      invoiceNumber: sanitizedInvoiceNumber,
      imageS3Key: s3Key,
      contentType: "image/webp",
      fileSizeBytes: processed.buffer.length,
      notes: data.notes,
      createdBy: data.createdBy,
      productIds: data.productIds,
    });

    return invoice;
  } catch (dbError) {
    // 5. Em caso de falha no banco (ex: ciclo fechado, nota duplicada, validação de produtos), remove imagem órfã do S3
    try {
      await deleteInvoiceFromS3(s3Key);
    } catch (cleanupError) {
      log("error", "Falha ao remover imagem órfã de nota fiscal", {
        event: "INVOICE_S3_CLEANUP_ORPHAN_ERROR",
        s3Key,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    throw dbError;
  }
}

export async function deleteInvoiceService(
  invoiceId: string,
  actorId: string | null
): Promise<boolean> {
  // 1. Executa a exclusão com auditoria no banco dentro de transação com verificação de ciclo fechado
  const deleted = await deleteInvoiceRecord(invoiceId, actorId);
  if (!deleted) return false;

  // 2. Somente após a confirmação transacional no banco e auditoria, exclui o objeto no S3
  try {
    await deleteInvoiceFromS3(deleted.imageS3Key);
  } catch (s3Error) {
    log("error", "Falha ao remover fotografia de nota fiscal do S3", {
      event: "INVOICE_S3_DELETE_ERROR",
      s3Key: deleted.imageS3Key,
      error: s3Error instanceof Error ? s3Error.message : String(s3Error),
    });
  }

  return true;
}
