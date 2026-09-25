"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/modules/identity/audit";
import { requirePrincipal } from "@/modules/identity/session";
import {
  PurchaseCalendarConflictError,
  PurchaseCalendarValidationError,
  type PurchaseCalendar,
} from "./domain";
import { savePurchaseCalendar } from "./service";

const purchaseCalendarSchema = z.object({
  timezone: z.string().trim().min(1).max(100),
  cutoffTime: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  enabledIsoWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  expectedVersion: z.number().int().positive(),
});

export type PurchaseCalendarActionResult =
  | { status: "success"; value: PurchaseCalendar }
  | { status: "conflict"; value: PurchaseCalendar; message: string }
  | { status: "error"; message: string };

export async function savePurchaseCalendarAction(raw: unknown): Promise<PurchaseCalendarActionResult> {
  const principal = await requirePrincipal();
  const parsed = purchaseCalendarSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Configuração do calendário inválida." };
  try {
    const value = await savePurchaseCalendar(principal, parsed.data);
    await recordAudit({
      actorId: principal.userId,
      action: "PURCHASE_CALENDAR_UPDATED",
      entityType: "purchase_calendar_settings",
      entityId: "OPERATIONAL",
      metadata: { version: value.version },
    });
    revalidatePath("/");
    revalidatePath("/gestor/configuracoes");
    revalidatePath("/gestor/precificacao");
    return { status: "success", value };
  } catch (error) {
    if (error instanceof PurchaseCalendarConflictError)
      return { status: "conflict", value: error.current, message: error.message };
    if (error instanceof PurchaseCalendarValidationError)
      return { status: "error", message: error.message };
    return { status: "error", message: "Não foi possível salvar o calendário de compras." };
  }
}
