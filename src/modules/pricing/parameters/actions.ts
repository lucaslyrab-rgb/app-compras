"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/modules/identity/audit";
import { requirePrincipal } from "@/modules/identity/session";
import { PricingValidationError } from "../financial";
import { PricingConflictError, ProductErpConflictError, type PricingProduct, type PricingSettings } from "./domain";
import { createProduct, savePricingSettings, saveProductPricing } from "./service";

const productFields = {
  erpCode: z.number().int().positive(),
  name: z.string().trim().min(2).max(200),
  catalogUnit: z.string().trim().min(1).max(16),
  purchaseFormat: z.string().trim().min(1).max(16),
  exclusiveSupplier: z.boolean(),
  saleUnit: z.string().max(16),
  conversionQuantity: z.string().max(32),
  beneficiationLossPercent: z.string().max(32),
  specificMarginPercent: z.string().max(32).nullable(),
};
const createProductSchema = z.object(productFields);
const productSchema = z.object({
  productId: z.uuid(), ...productFields,
  expectedVersion: z.number().int().positive(), expectedProductVersion: z.number().int().positive(),
  confirmedFormatConversion: z.boolean(),
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

function revalidateProductFlows(productId?: string) {
  revalidatePath("/");
  revalidatePath("/gestor/produtos");
  revalidatePath("/gestor/precificacao");
  revalidatePath("/comprador/consolidado");
  revalidatePath("/comprador/custos");
  if (productId) {
    revalidatePath(`/gestor/produtos/${productId}`);
  }
}

export async function createProductAction(raw: unknown): Promise<PricingActionResult<PricingProduct>> {
  const principal = await requirePrincipal();
  const parsed = createProductSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Dados do produto inválidos." };
  try {
    const value = await createProduct(principal, parsed.data);
    await recordAudit({ actorId: principal.userId, action: "PRODUCT_CREATED", entityType: "product", entityId: value.id, metadata: { erpCode: value.erpCode, productVersion: value.productVersion, pricingVersion: value.version } });
    revalidateProductFlows(value.id);
    return { status: "success", value };
  } catch (error) {
    if (error instanceof ProductErpConflictError || error instanceof PricingValidationError || error instanceof z.ZodError)
      return { status: "error", message: error.message };
    return { status: "error", message: "Não foi possível cadastrar o produto." };
  }
}

export async function saveProductPricingAction(raw: unknown): Promise<PricingActionResult<PricingProduct>> {
  const principal = await requirePrincipal();
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Dados do produto inválidos." };
  try {
    const value = await saveProductPricing(principal, parsed.data);
    await recordAudit({
      actorId: principal.userId,
      action: "PRODUCT_UPDATED",
      entityType: "product",
      entityId: value.id,
      metadata: { productVersion: value.productVersion, pricingVersion: value.version },
    });
    revalidateProductFlows(value.id);
    return { status: "success", value };
  } catch (error) {
    if (error instanceof PricingConflictError)
      return { status: "conflict", value: error.current as PricingProduct, message: error.message };
    if (error instanceof ProductErpConflictError || error instanceof PricingValidationError || error instanceof z.ZodError)
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
