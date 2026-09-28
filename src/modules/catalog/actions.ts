"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/modules/identity/session";
import { recordAudit } from "@/modules/identity/audit";
import { z } from "zod";
import { ProductDraftConflictError, ProductVersionConflictError } from "./domain";
import { setProductActive } from "./repository";

const toggleSchema = z.object({ productId: z.uuid(), active: z.boolean(), expectedVersion: z.number().int().positive() });

export async function toggleProductAction(raw: unknown) {
  const principal = await requirePrincipal();
  const parsed = toggleSchema.safeParse(raw);
  if (!parsed.success) return { status: "error" as const, message: "Dados do produto inválidos." };
  try {
    const value = await setProductActive(principal, parsed.data.productId, parsed.data.active, parsed.data.expectedVersion);
    await recordAudit({ actorId: principal.userId, action: value.active ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED", entityType: "product", entityId: value.id, metadata: { version: value.version } });
    revalidatePath("/");
    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/precificacao");
    revalidatePath("/comprador/consolidado");
    revalidatePath("/comprador/custos");
    return { status: "success" as const, value };
  } catch (error) {
    if (error instanceof ProductDraftConflictError || error instanceof ProductVersionConflictError)
      return { status: "error" as const, message: error.message };
    return { status: "error" as const, message: "Não foi possível alterar o status do produto." };
  }
}
