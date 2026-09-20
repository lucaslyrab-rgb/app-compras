"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/modules/identity/session";
import { cancelOrder, saveDraft, submitDraft } from "./repository";
import { DraftConflictError } from "./domain";
import { recordAudit } from "@/modules/identity/audit";

type State = { status?: "success" | "error"; message?: string; version?: number };

function parseDraft(formData: FormData) {
  const productIds = formData.getAll("productId").map(String);
  const stocks = formData.getAll("stock").map(Number);
  const quantities = formData.getAll("quantity").map(Number);
  return productIds.map((productId, index) => ({ productId, stock: stocks[index] ?? 0, quantity: quantities[index] ?? 0 }));
}

export async function saveDraftAction(_state: State, formData: FormData): Promise<State> {
  const principal = await requirePrincipal();
  const storeId = String(formData.get("storeId"));
  const date = String(formData.get("orderDate"));
  const version = Number(formData.get("version") ?? 0);
  try {
    const result = await saveDraft(principal, storeId, date, version, parseDraft(formData));
    revalidatePath("/");
    return { status: "success", message: "Rascunho salvo.", version: result.version };
  } catch (error) {
    return { status: "error", message: error instanceof DraftConflictError ? error.message : "Não foi possível salvar o rascunho." };
  }
}

export async function submitOrderAction(_state: State, formData: FormData): Promise<State> {
  const principal = await requirePrincipal();
  const storeId = String(formData.get("storeId"));
  const date = String(formData.get("orderDate"));
  try {
    const saved = await saveDraft(principal, storeId, date, Number(formData.get("version") ?? 0), parseDraft(formData));
    const order = await submitDraft(principal, storeId, date);
    await recordAudit({ actorId: principal.userId, action: "ORDER_SUBMITTED", entityType: "order", entityId: order.id, metadata: { storeId, date, revision: order.revision } });
    revalidatePath("/");
    return { status: "success", message: `Pedido enviado — revisão ${order.revision}.`, version: saved.version };
  } catch (error) {
    return { status: "error", message: error instanceof DraftConflictError ? error.message : "Não foi possível enviar o pedido." };
  }
}

export async function cancelOrderAction(_state: State, formData: FormData): Promise<State> {
  const principal = await requirePrincipal();
  try {
    await cancelOrder(principal, String(formData.get("orderId")), String(formData.get("reason") ?? ""));
    revalidatePath("/historico");
    revalidatePath("/");
    return { status: "success", message: "Pedido cancelado." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Não foi possível cancelar o pedido." };
  }
}
