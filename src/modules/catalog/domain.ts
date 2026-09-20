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

export function authorizeProductManagement(principal: Principal) {
  if (!canManageProducts(principal)) throw new AuthorizationError("Somente o Gestor administra produtos");
}

export function normalizeProduct(input: ProductInput): ProductInput {
  return productInput.parse({ ...input, name: input.name.toUpperCase(), unit: input.unit.toUpperCase(), purchaseFormat: input.purchaseFormat.toUpperCase() });
}
