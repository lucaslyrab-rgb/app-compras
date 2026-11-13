"use server";

import { z } from "zod";
import { requirePrincipal } from "@/modules/identity/session";
import { hasPermission } from "@/modules/identity";
import {
  InvoiceEntryError,
  informInvoiceNumber,
  removeInformedInvoiceNumber,
  setInvoiceEntryConfirmed,
} from "@/modules/purchasing/invoices/entries";
import { InvoiceValidationError } from "@/modules/purchasing/invoices/domain";

/**
 * Notas no Fechamento integrado. Quem vê o Fechamento (Gestor e CPD,
 * permissão `fechamento:consultar`) marca a entrada e informa números.
 */
const keySchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ciclo inválido."),
  storeId: z.string().uuid("Loja inválida."),
  supplierId: z.string().uuid("Fornecedor inválido."),
  invoiceNumber: z.string().trim().min(1, "Informe o número da nota.").max(100, "Número da nota muito longo."),
});

export type ClosingInvoiceResult = { status: "success"; message?: string } | { status: "error"; message: string };

async function authorize() {
  const principal = await requirePrincipal();
  if (!hasPermission(principal, "fechamento:consultar")) return null;
  return principal;
}

function failure(error: unknown): ClosingInvoiceResult {
  if (error instanceof InvoiceEntryError || error instanceof InvoiceValidationError) {
    return { status: "error", message: error.message };
  }
  return { status: "error", message: "Não foi possível salvar. Tente novamente." };
}

export async function setInvoiceEntryAction(input: unknown): Promise<ClosingInvoiceResult> {
  const principal = await authorize();
  if (!principal) return { status: "error", message: "Acesso não autorizado." };
  const parsed = keySchema.extend({ confirmed: z.boolean() }).safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  try {
    await setInvoiceEntryConfirmed({ ...parsed.data, actorId: principal.userId });
    return { status: "success" };
  } catch (error) {
    return failure(error);
  }
}

export async function informInvoiceNumberAction(input: unknown): Promise<ClosingInvoiceResult> {
  const principal = await authorize();
  if (!principal) return { status: "error", message: "Acesso não autorizado." };
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  try {
    const result = await informInvoiceNumber({ ...parsed.data, actorId: principal.userId });
    return result.status === "already-registered"
      ? { status: "success", message: "Esta nota já foi anexada na Destinação." }
      : { status: "success" };
  } catch (error) {
    return failure(error);
  }
}

export async function removeInformedInvoiceNumberAction(input: unknown): Promise<ClosingInvoiceResult> {
  const principal = await authorize();
  if (!principal) return { status: "error", message: "Acesso não autorizado." };
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  try {
    await removeInformedInvoiceNumber({ ...parsed.data, actorId: principal.userId });
    return { status: "success" };
  } catch (error) {
    return failure(error);
  }
}
