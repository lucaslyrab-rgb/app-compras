"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/modules/identity/domain";
import { requirePrincipal } from "@/modules/identity/session";
import { isCycleDate } from "@/modules/purchasing/domain";
import { CycleArchiveError, parseArchiveReason } from "./domain";
import { archiveCycle } from "./repository";

export type ArchiveCycleState = { status?: "success" | "error"; message?: string; cycleDate?: string };

/** Gestor encerra um ciclo antigo inteiro (Destinação + conferências), com motivo. */
export async function archiveCycleAction(_prev: ArchiveCycleState, formData: FormData): Promise<ArchiveCycleState> {
  try {
    const principal = await requirePrincipal();
    assertPermission(principal, "gestor:configuracoes", "Você não tem permissão para encerrar ciclos.");

    const cycleDate = String(formData.get("cycleDate") ?? "");
    if (!isCycleDate(cycleDate)) throw new CycleArchiveError("Ciclo inválido.");
    const reason = parseArchiveReason(formData.get("reason"));

    await archiveCycle({ cycleDate, reason, userId: principal.userId });

    revalidatePath("/gestor/configuracoes");
    revalidatePath("/comprador/destinacao");
    revalidatePath("/conferencia");
    revalidatePath("/fechamento");

    const [y, m, d] = cycleDate.split("-");
    return { status: "success", message: `Ciclo ${d}/${m}/${y} encerrado.`, cycleDate };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Erro ao encerrar o ciclo." };
  }
}
