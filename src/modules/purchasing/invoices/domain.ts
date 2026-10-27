export interface InvoiceRecord {
  id: string;
  purchaseCycleDate: string;
  storeId: string;
  supplierId: string;
  invoiceNumber: string;
  imageS3Key: string;
  contentType: string;
  fileSizeBytes: number;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  itemProductIds?: string[];
}

export interface SupplierInvoiceSummary {
  supplierId: string;
  storeId: string;
  invoices: InvoiceRecord[];
  hasInvoices: boolean;
  status: "NO_ALLOCATION" | "REGISTERED" | "MISSING";
}

export class InvoiceValidationError extends Error {
  override name = "InvoiceValidationError";
}

export function validateInvoiceNumber(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new InvoiceValidationError("Número da nota fiscal deve ser um texto.");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvoiceValidationError("Número da nota fiscal é obrigatório.");
  }
  if (trimmed.length > 100) {
    throw new InvoiceValidationError("Número da nota fiscal não pode exceder 100 caracteres.");
  }
  return trimmed;
}
