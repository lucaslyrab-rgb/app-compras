"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/modules/identity/audit";
import { requirePrincipal } from "@/modules/identity/session";
import { log } from "@/shared/logging";
import { PricingValidationError } from "../financial";
import { PricingReviewError } from "./domain";
import { reviewPricingProduct } from "./service";

const reviewSchema = z.object({
  productId: z.uuid(),
  expectedFingerprint: z.string().min(1).max(512),
  appliedPrice: z.string().trim().min(1).max(32),
});

export async function reviewPricingProductAction(raw: unknown) {
  const principal = await requirePrincipal();
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { status: "error" as const, message: "Dados de revisão inválidos." };
  try {
    const value = await reviewPricingProduct(principal, parsed.data);
    await recordAudit({
      actorId: principal.userId,
      action: "PRICING_REVIEW_CREATED",
      entityType: "pricing_review",
      entityId: value.id,
      metadata: { productId: parsed.data.productId, appliedPrice: value.appliedPrice },
    });
    revalidatePath("/gestor/precificacao");
    revalidatePath(`/gestor/precificacao/${parsed.data.productId}`);
    return { status: "success" as const, value };
  } catch (error) {
    if (error instanceof PricingReviewError || error instanceof PricingValidationError)
      return { status: "error" as const, message: error.message };
    log("error", "Falha ao registrar revisão de precificação", {
      error: error instanceof Error ? error.message : "unknown",
      productId: parsed.data.productId,
    });
    return {
      status: "error" as const,
      message: "Não foi possível registrar a revisão.",
    };
  }
}
