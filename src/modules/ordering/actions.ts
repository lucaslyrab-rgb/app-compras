"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/modules/identity/session";
import { cancelOrder, ExistingOrderError, saveDraft, submitDraft } from "./repository";
import { DraftConflictError, OrderValidationError, parseQuantityInput } from "./domain";
import { recordAudit } from "@/modules/identity/audit";

export type State = { status?: "success" | "error" | "confirm"; message?: string; version?: number; existingSubmittedAt?: string; purchaseCycleDate?: string };

function parseDraft(formData: FormData) {
  const productIds = formData.getAll("productId").map(String);
  const rawStocks = formData.getAll("stock");
  const rawQuantities = formData.getAll("quantity");
  return productIds.map((productId, index) => {
    const rawStock = rawStocks[index];
    const rawQuantity = rawQuantities[index];
    const stock = parseQuantityInput(rawStock);
    if (stock === null) {
      throw new OrderValidationError("Valor de estoque inválido.");
    }
    const quantity = parseQuantityInput(rawQuantity);
    if (quantity === null) {
      throw new OrderValidationError("Valor de quantidade de pedido inválido.");
    }
    return { productId, stock, quantity };
  });
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
    if (error instanceof DraftConflictError || error instanceof OrderValidationError) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: "Não foi possível salvar o rascunho." };
  }
}

export async function submitOrderAction(_state: State, formData: FormData): Promise<State> {
  const principal = await requirePrincipal();
  const storeId = String(formData.get("storeId"));
  const date = String(formData.get("orderDate"));
  let savedVersion = Number(formData.get("version") ?? 0);
  try {
    const saved = await saveDraft(principal, storeId, date, savedVersion, parseDraft(formData));
    savedVersion = saved.version;
    const order = await submitDraft(principal, storeId, date, String(formData.get("allowRevision")) === "1");
    await recordAudit({ actorId: principal.userId, action: "ORDER_SUBMITTED", entityType: "order", entityId: order.id, metadata: { storeId, date, revision: order.revision } });
    revalidatePath("/");
    return { status: "success", message: `Pedido enviado — revisão ${order.revision}.`, version: saved.version };
  } catch (error) {
    if (error instanceof ExistingOrderError) return { status: "confirm", message: error.message, existingSubmittedAt: error.submittedAt.toISOString(), purchaseCycleDate: error.purchaseCycleDate, version: savedVersion };
    if (error instanceof DraftConflictError || error instanceof OrderValidationError) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: "Não foi possível enviar o pedido." };
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
