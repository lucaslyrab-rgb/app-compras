"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/modules/identity/session";
import { recordAudit } from "@/modules/identity/audit";
import { setProductActive } from "./repository";

export async function toggleProductAction(formData: FormData) {
  const principal = await requirePrincipal();
  const productId = String(formData.get("productId"));
  const active = String(formData.get("active")) === "true";
  await setProductActive(principal, productId, active);
  await recordAudit({ actorId: principal.userId, action: active ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED", entityType: "product", entityId: productId });
  revalidatePath("/produtos");
}
