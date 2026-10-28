"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/modules/identity/session";
import { assertPermission, AuthorizationError } from "@/modules/identity/domain";
import { parseWeightInput, ConferenceValidationError } from "./domain";
import { saveConferenceDraft, finalizeConference } from "./repository";

export type ConferenceActionState = {
  status?: "success" | "error";
  message?: string;
  progress?: { total: number; verified: number; pending: number; percent: number };
};

export async function saveConferenceDraftAction(
  _prevState: ConferenceActionState,
  formData: FormData
): Promise<ConferenceActionState> {
  try {
    const principal = await requirePrincipal();
    assertPermission(principal, "loja:conferencia", "Você não tem permissão para conferência de entrega.");

    const storeId = String(formData.get("storeId") ?? "");
    const conferenceId = String(formData.get("conferenceId") ?? "");
    const rawItems = String(formData.get("items") ?? "");

    if (!principal.storeId || principal.storeId !== storeId) {
      throw new AuthorizationError("Operação permitida apenas para a sua loja vinculada.");
    }

    if (!conferenceId) {
      throw new ConferenceValidationError("Identificador de conferência não informado.");
    }

    let parsedItemsList: Array<{ productId: string; receivedWeightKg: number | null; isUnreceived: boolean }> = [];
    try {
      const parsed = JSON.parse(rawItems);
      if (!Array.isArray(parsed)) throw new Error();
      parsedItemsList = parsed.map((it) => ({
        productId: String(it.productId),
        receivedWeightKg: parseWeightInput(it.receivedWeightKg),
        isUnreceived: Boolean(it.isUnreceived),
      }));
    } catch {
      throw new ConferenceValidationError("Dados de itens da conferência inválidos.");
    }

    const progress = await saveConferenceDraft({
      conferenceId,
      storeId,
      userId: principal.userId,
      items: parsedItemsList,
    });

    revalidatePath("/conferencia");
    return {
      status: "success",
      message: "Conferência salva parcialmente com sucesso.",
      progress,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao salvar conferência.",
    };
  }
}

export async function finalizeConferenceAction(
  _prevState: ConferenceActionState,
  formData: FormData
): Promise<ConferenceActionState> {
  try {
    const principal = await requirePrincipal();
    assertPermission(principal, "loja:conferencia", "Você não tem permissão para conferência de entrega.");

    const storeId = String(formData.get("storeId") ?? "");
    const conferenceId = String(formData.get("conferenceId") ?? "");
    const rawItems = String(formData.get("items") ?? "");

    if (!principal.storeId || principal.storeId !== storeId) {
      throw new AuthorizationError("Operação permitida apenas para a sua loja vinculada.");
    }

    if (!conferenceId) {
      throw new ConferenceValidationError("Identificador de conferência não informado.");
    }

    let parsedItemsList: Array<{ productId: string; receivedWeightKg: number | null; isUnreceived: boolean }> = [];
    try {
      const parsed = JSON.parse(rawItems);
      if (!Array.isArray(parsed)) throw new Error();
      parsedItemsList = parsed.map((it) => ({
        productId: String(it.productId),
        receivedWeightKg: parseWeightInput(it.receivedWeightKg),
        isUnreceived: Boolean(it.isUnreceived),
      }));
    } catch {
      throw new ConferenceValidationError("Dados de itens da conferência inválidos.");
    }

    await finalizeConference({
      conferenceId,
      storeId,
      userId: principal.userId,
      items: parsedItemsList,
    });

    revalidatePath("/conferencia");
    return {
      status: "success",
      message: "Conferência finalizada com sucesso! Todos os produtos foram verificados.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao finalizar conferência.",
    };
  }
}
