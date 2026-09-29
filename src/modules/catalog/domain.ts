import { z } from "zod";
import type { Principal } from "@/modules/identity";
import { canManageProducts, AuthorizationError } from "@/modules/identity";

export const productInput = z.object({
  erpCode: z.number().int().positive(),
  name: z.string().trim().min(2),
  unit: z.string().trim().min(1).max(16),
  purchaseFormat: z.string().trim().min(1).max(16),
  markup: z.number().min(0),
  exclusiveSupplier: z.boolean()
});
export type ProductInput = z.infer<typeof productInput>;

export const managedProductInput = productInput.omit({ markup: true });
export type ManagedProductInput = z.infer<typeof managedProductInput>;

export function authorizeProductManagement(principal: Principal) {
  if (!canManageProducts(principal)) throw new AuthorizationError("Somente o Gestor administra produtos");
}

export function normalizeProduct(input: ProductInput): ProductInput {
  return productInput.parse({ ...input, name: input.name.toUpperCase(), unit: input.unit.toUpperCase(), purchaseFormat: input.purchaseFormat.toUpperCase() });
}

export function normalizeManagedProduct(input: ManagedProductInput): ManagedProductInput {
  return managedProductInput.parse({
    ...input,
    name: input.name.toLocaleUpperCase("pt-BR"),
    unit: input.unit.toLocaleUpperCase("pt-BR"),
    purchaseFormat: input.purchaseFormat.toLocaleUpperCase("pt-BR"),
  });
}

export class ProductDraftConflictError extends Error {
  constructor(public readonly draftCount: number) {
    super(`O produto está preenchido em ${draftCount} rascunho(s). Finalize ou limpe esses rascunhos antes de inativar.`);
    this.name = "ProductDraftConflictError";
  }
}

export class ProductVersionConflictError extends Error {
  constructor() {
    super("O produto foi atualizado em outra sessão. Recarregue a página.");
    this.name = "ProductVersionConflictError";
  }
}

export type ProductPhotoDto = {
  id: string;
  version: number;
  photoKey: string | null;
  photoUpdatedAt: string | null;
};

export function toIsoDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

