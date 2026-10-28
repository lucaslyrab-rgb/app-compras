"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/modules/identity/session";
import { assertPermission, AuthorizationError } from "@/modules/identity/domain";
import { parseLossQuantity, LossValidationError } from "./domain";
import { recordStoreLoss, cancelStoreLoss } from "./repository";

export type LossActionState = {
  status?: "success" | "error";
  message?: string;
  lossId?: string;
};

export async function recordStoreLossAction(
  _prevState: LossActionState,
  formData: FormData
): Promise<LossActionState> {
  try {
    const principal = await requirePrincipal();
    assertPermission(principal, "loja:perdas", "Você não tem permissão para lançamento de perdas.");

    const storeId = String(formData.get("storeId") ?? "");
    const productId = String(formData.get("productId") ?? "");
    const rawQuantity = String(formData.get("quantity") ?? "");
    const unit = String(formData.get("unit") ?? "KG").trim().toUpperCase();
    const reason = String(formData.get("reason") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    if (!principal.storeId || principal.storeId !== storeId) {
      throw new AuthorizationError("Operação permitida apenas para a sua loja vinculada.");
    }

    if (!productId) {
      throw new LossValidationError("Selecione um produto para lançar a perda.");
    }

    if (!reason) {
      throw new LossValidationError("Informe o motivo da perda.");
    }

    const quantity = parseLossQuantity(rawQuantity);

    const record = await recordStoreLoss({
      storeId,
      productId,
      quantity,
      unit: unit === "UND" ? "UND" : "KG",
      reason,
      notes: notes || null,
      userId: principal.userId,
    });

    revalidatePath("/perdas");
    revalidatePath("/gestor/perdas");
    revalidatePath("/comprador/perdas");

    return {
      status: "success",
      message: `Perda de ${quantity} ${unit} registrada com sucesso.`,
      lossId: record.id,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao registrar perda.",
    };
  }
}

export async function cancelStoreLossAction(
  _prevState: LossActionState,
  formData: FormData
): Promise<LossActionState> {
  try {
    const principal = await requirePrincipal();
    assertPermission(principal, "loja:perdas", "Você não tem permissão para cancelar perdas.");

    const storeId = String(formData.get("storeId") ?? "");
    const lossId = String(formData.get("lossId") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();

    if (!principal.storeId || principal.storeId !== storeId) {
      throw new AuthorizationError("Operação permitida apenas para a sua loja vinculada.");
    }

    if (!lossId) {
      throw new LossValidationError("Identificador do registro de perda não informado.");
    }

    await cancelStoreLoss({
      lossId,
      storeId,
      userId: principal.userId,
      reason: reason || undefined,
    });

    revalidatePath("/perdas");
    revalidatePath("/gestor/perdas");
    revalidatePath("/comprador/perdas");

    return {
      status: "success",
      message: "Registro de perda excluído com sucesso.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao excluir registro de perda.",
    };
  }
}
