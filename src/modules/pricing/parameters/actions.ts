"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/modules/identity/audit";
import { requirePrincipal } from "@/modules/identity/session";
import { PricingValidationError } from "../financial";
import { PricingConflictError, type PricingProduct, type PricingSettings } from "./domain";
import { savePricingSettings, saveProductPricing } from "./service";

const productSchema = z.object({
  productId: z.uuid(),
  saleUnit: z.string().max(16),
  conversionQuantity: z.string().max(32),
  beneficiationLossPercent: z.string().max(32),
  specificMarginPercent: z.string().max(32).nullable(),
  expectedVersion: z.number().int().positive(),
});

const settingsSchema = z.object({
  operatingCostPercent: z.string().max(32),
  defaultMarginPercent: z.string().max(32),
  expectedVersion: z.number().int().positive(),
});

export type PricingActionResult<T> =
  | { status: "success"; value: T }
  | { status: "conflict"; value: T; message: string }
  | { status: "error"; message: string };

export async function saveProductPricingAction(raw: unknown): Promise<PricingActionResult<PricingProduct>> {
  const principal = await requirePrincipal();
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Dados do produto inválidos." };
  try {
    const value = await saveProductPricing(principal, parsed.data);
    await recordAudit({
      actorId: principal.userId,
      action: "PRODUCT_PRICING_UPDATED",
      entityType: "product_pricing_parameters",
      entityId: value.id,
      metadata: { version: value.version },
    });
    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/precificacao");
    return { status: "success", value };
  } catch (error) {
    if (error instanceof PricingConflictError)
      return { status: "conflict", value: error.current as PricingProduct, message: error.message };
    if (error instanceof PricingValidationError)
      return { status: "error", message: error.message };
    return { status: "error", message: "Não foi possível salvar os parâmetros." };
  }
}

export async function savePricingSettingsAction(raw: unknown): Promise<PricingActionResult<PricingSettings>> {
  const principal = await requirePrincipal();
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Configurações inválidas." };
  try {
    const value = await savePricingSettings(principal, parsed.data);
    await recordAudit({
      actorId: principal.userId,
      action: "PRICING_SETTINGS_UPDATED",
      entityType: "pricing_settings",
      entityId: "FLV",
      metadata: { version: value.version },
    });
    revalidatePath("/gestor/configuracoes");
    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/precificacao");
    return { status: "success", value };
  } catch (error) {
    if (error instanceof PricingConflictError)
      return { status: "conflict", value: error.current as PricingSettings, message: error.message };
    if (error instanceof PricingValidationError)
      return { status: "error", message: error.message };
    return { status: "error", message: "Não foi possível salvar as configurações." };
  }
}
