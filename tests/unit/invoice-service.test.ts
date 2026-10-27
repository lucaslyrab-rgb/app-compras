import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerInvoiceService, deleteInvoiceService } from "@/modules/purchasing/invoices/service";
import { CycleClosedError, InvoiceValidationError, type InvoiceRecord } from "@/modules/purchasing/invoices/domain";
import * as repository from "@/modules/purchasing/invoices/repository";
import * as storage from "@/lib/s3-invoices";
import { log } from "@/shared/logging";

vi.mock("@/modules/purchasing/invoices/repository", () => ({
  createInvoiceRecord: vi.fn(),
  deleteInvoiceRecord: vi.fn(),
}));
vi.mock("@/lib/s3-invoices", () => ({
  generateInvoiceKey: vi.fn(),
  uploadInvoiceToS3: vi.fn(),
  deleteInvoiceFromS3: vi.fn(),
  validateAndProcessInvoiceImage: vi.fn(),
}));
vi.mock("@/shared/logging", () => ({ log: vi.fn() }));

const input = {
  cycleDate: "2026-10-27",
  storeId: "store-1",
  supplierId: "supplier-1",
  invoiceNumber: "  NF-100  ",
  imageBuffer: Buffer.from("original-image"),
  createdBy: "buyer-1",
  productIds: ["product-1"],
};
const processed = Buffer.from("processed-image");
const invoice: InvoiceRecord = {
  id: "invoice-1",
  purchaseCycleDate: input.cycleDate,
  storeId: input.storeId,
  supplierId: input.supplierId,
  invoiceNumber: "NF-100",
  imageS3Key: "invoices/private.webp",
  contentType: "image/webp",
  fileSizeBytes: processed.length,
  createdAt: "2026-10-27T12:00:00Z",
  updatedAt: "2026-10-27T12:00:00Z",
  itemProductIds: input.productIds,
};

describe("serviço de notas — falhas de banco e armazenamento", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(storage.validateAndProcessInvoiceImage).mockResolvedValue({ buffer: processed, width: 80, height: 60 });
    vi.mocked(storage.generateInvoiceKey).mockReturnValue(invoice.imageS3Key);
    vi.mocked(storage.uploadInvoiceToS3).mockResolvedValue(undefined);
    vi.mocked(storage.deleteInvoiceFromS3).mockResolvedValue(undefined);
    vi.mocked(repository.createInvoiceRecord).mockResolvedValue(invoice);
    vi.mocked(repository.deleteInvoiceRecord).mockResolvedValue({ id: invoice.id, imageS3Key: invoice.imageS3Key });
  });

  it("registra a imagem processada e vincula os produtos com número sanitizado", async () => {
    expect(await registerInvoiceService(input)).toEqual(invoice);
    expect(storage.uploadInvoiceToS3).toHaveBeenCalledWith(invoice.imageS3Key, processed);
    expect(repository.createInvoiceRecord).toHaveBeenCalledWith(expect.objectContaining({
      invoiceNumber: "NF-100", fileSizeBytes: processed.length, productIds: input.productIds,
    }));
    expect(storage.deleteInvoiceFromS3).not.toHaveBeenCalled();
  });

  it("rejeita número vazio antes de processar ou enviar a imagem", async () => {
    await expect(registerInvoiceService({ ...input, invoiceNumber: " " })).rejects.toThrow(InvoiceValidationError);
    expect(storage.validateAndProcessInvoiceImage).not.toHaveBeenCalled();
    expect(storage.uploadInvoiceToS3).not.toHaveBeenCalled();
  });

  it("não grava a nota se o envio da imagem falhar", async () => {
    vi.mocked(storage.uploadInvoiceToS3).mockRejectedValue(new Error("upload failed"));
    await expect(registerInvoiceService(input)).rejects.toThrow("upload failed");
    expect(repository.createInvoiceRecord).not.toHaveBeenCalled();
  });

  it("remove a imagem enviada quando a transação de gravação e auditoria falha", async () => {
    const failure = new Error("audit transaction failed");
    vi.mocked(repository.createInvoiceRecord).mockRejectedValue(failure);
    await expect(registerInvoiceService(input)).rejects.toBe(failure);
    expect(storage.deleteInvoiceFromS3).toHaveBeenCalledWith(invoice.imageS3Key);
  });

  it("preserva o erro do banco e registra a falha de limpeza da imagem órfã", async () => {
    const failure = new Error("database failed");
    vi.mocked(repository.createInvoiceRecord).mockRejectedValue(failure);
    vi.mocked(storage.deleteInvoiceFromS3).mockRejectedValue(new Error("cleanup failed"));
    await expect(registerInvoiceService(input)).rejects.toBe(failure);
    expect(log).toHaveBeenCalledWith("error", expect.any(String), expect.objectContaining({
      event: "INVOICE_S3_CLEANUP_ORPHAN_ERROR", s3Key: invoice.imageS3Key,
    }));
  });

  it("remove a imagem após a confirmação de exclusão no banco", async () => {
    expect(await deleteInvoiceService(invoice.id, input.createdBy)).toBe(true);
    expect(repository.deleteInvoiceRecord).toHaveBeenCalledWith(invoice.id, input.createdBy);
    expect(storage.deleteInvoiceFromS3).toHaveBeenCalledWith(invoice.imageS3Key);
  });

  it("preserva a imagem quando o banco rejeita a exclusão de ciclo fechado", async () => {
    vi.mocked(repository.deleteInvoiceRecord).mockRejectedValue(new CycleClosedError("ciclo fechado"));
    await expect(deleteInvoiceService(invoice.id, input.createdBy)).rejects.toThrow("ciclo fechado");
    expect(storage.deleteInvoiceFromS3).not.toHaveBeenCalled();
  });

  it("retorna não encontrada sem tocar no S3 quando a nota não existe", async () => {
    vi.mocked(repository.deleteInvoiceRecord).mockResolvedValue(null);
    expect(await deleteInvoiceService(invoice.id, input.createdBy)).toBe(false);
    expect(storage.deleteInvoiceFromS3).not.toHaveBeenCalled();
  });

  it("mantém o sucesso confirmado no banco e registra falha posterior de remoção no S3", async () => {
    vi.mocked(storage.deleteInvoiceFromS3).mockRejectedValue(new Error("delete failed"));
    expect(await deleteInvoiceService(invoice.id, input.createdBy)).toBe(true);
    expect(log).toHaveBeenCalledWith("error", expect.any(String), expect.objectContaining({
      event: "INVOICE_S3_DELETE_ERROR", s3Key: invoice.imageS3Key,
    }));
  });
});
