"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePrincipal } from "@/modules/identity/session";
import { assertPermission } from "@/modules/identity";
import { MAX_INVOICE_BYTES } from "@/lib/s3-invoices";
import { CycleClosedError, InvoiceValidationError } from "./domain";
import { registerInvoiceService, deleteInvoiceService } from "./service";

const registerInvoiceSchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data do ciclo inválida."),
  storeId: z.string().uuid("Loja inválida."),
  supplierId: z.string().uuid("Fornecedor inválido."),
  invoiceNumber: z.string().min(1, "Número da nota fiscal obrigatório.").max(100, "Número da nota fiscal muito longo."),
  notes: z.string().max(500, "Observação muito longa.").optional().nullable(),
  productIds: z.array(z.string().uuid()).optional(),
});

export async function registerInvoiceAction(formData: FormData) {
  const principal = await requirePrincipal();
  try {
    assertPermission(principal, "compras:destinacao");
  } catch {
    return { status: "error" as const, message: "Acesso não autorizado para operação de notas fiscais na destinação." };
  }

  const cycleDate = formData.get("cycleDate") as string;
  const storeId = formData.get("storeId") as string;
  const supplierId = formData.get("supplierId") as string;
  const invoiceNumber = formData.get("invoiceNumber") as string;
  const notesRaw = formData.get("notes") as string | null;
  const productIdsRaw = formData.get("productIds") as string | null;
  const file = formData.get("file") as File | null;

  let productIds: string[] = [];
  if (productIdsRaw) {
    try {
      const parsed = JSON.parse(productIdsRaw);
      if (Array.isArray(parsed)) productIds = parsed;
    } catch {
      // Ignora erro de JSON
    }
  }

  const parsed = registerInvoiceSchema.safeParse({
    cycleDate,
    storeId,
    supplierId,
    invoiceNumber,
    notes: notesRaw || undefined,
    productIds: productIds.length > 0 ? productIds : undefined,
  });

  if (!parsed.success) {
    return {
      status: "error" as const,
      message: parsed.error.issues[0]?.message || "Dados da nota fiscal inválidos.",
    };
  }

  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) {
    return { status: "error" as const, message: "A fotografia da nota fiscal é obrigatória." };
  }

  if (file.size > MAX_INVOICE_BYTES) {
    return { status: "error" as const, message: "O tamanho da imagem excede o limite permitido de 10 MB." };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const invoice = await registerInvoiceService({
      cycleDate: parsed.data.cycleDate,
      storeId: parsed.data.storeId,
      supplierId: parsed.data.supplierId,
      invoiceNumber: parsed.data.invoiceNumber,
      imageBuffer,
      notes: parsed.data.notes,
      createdBy: principal.userId,
      productIds: parsed.data.productIds,
    });

    revalidatePath("/comprador/destinacao");
    return { status: "success" as const, invoice };
  } catch (err: unknown) {
    if (err instanceof InvoiceValidationError || err instanceof CycleClosedError) {
      return { status: "error" as const, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("purchase_cycle_invoices_unique") || message.includes("duplicate key")) {
      return {
        status: "error" as const,
        message: `A nota fiscal ${parsed.data.invoiceNumber} já está cadastrada para esta loja e fornecedor neste ciclo.`,
      };
    }
    return {
      status: "error" as const,
      message: message || "Não foi possível registrar a nota fiscal. Tente novamente.",
    };
  }
}

export async function deleteInvoiceAction(invoiceId: string) {
  const principal = await requirePrincipal();
  try {
    assertPermission(principal, "compras:destinacao");
  } catch {
    return { status: "error" as const, message: "Acesso não autorizado para remoção de notas fiscais na destinação." };
  }

  if (!invoiceId || !z.string().uuid().safeParse(invoiceId).success) {
    return { status: "error" as const, message: "ID da nota fiscal inválido." };
  }

  try {
    const success = await deleteInvoiceService(invoiceId, principal.userId);
    if (!success) {
      return { status: "error" as const, message: "Nota fiscal não encontrada para remoção." };
    }

    revalidatePath("/comprador/destinacao");
    return { status: "success" as const };
  } catch (err: unknown) {
    if (err instanceof CycleClosedError || err instanceof InvoiceValidationError) {
      return { status: "error" as const, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "error" as const,
      message: message || "Não foi possível remover a nota fiscal. Tente novamente.",
    };
  }
}
