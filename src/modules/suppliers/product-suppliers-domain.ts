import { z } from "zod";
import { type Principal, hasAnyPermission } from "@/modules/identity";

export type ProductSupplierLink = {
  id: string;
  productId: string;
  supplierId: string;
  isPrimary: boolean;
  isExclusive: boolean;
  active: boolean;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Dados desnormalizados do fornecedor para exibição
  corporateName: string;
  tradeName: string | null;
  taxId: string | null;
  taxIdType: string;
  taxInvoiceRule: string;
  supplierActive: boolean;
};

export type SupplierProductLink = {
  id: string;
  productId: string;
  supplierId: string;
  isPrimary: boolean;
  isExclusive: boolean;
  active: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Dados desnormalizados do produto para exibição
  erpCode: number;
  productName: string;
  unit: string;
  purchaseFormat: string;
  productActive: boolean;
};

export class ProductSupplierValidationError extends Error {
  override name = "ProductSupplierValidationError";
}

export class ProductSupplierConflictError extends Error {
  override name = "ProductSupplierConflictError";
}

export class ProductSupplierNotFoundError extends Error {
  override name = "ProductSupplierNotFoundError";
}

export function canManageProductSuppliers(principal: Principal): boolean {
  return hasAnyPermission(principal, [
    "gestor:produtos",
    "compras:fornecedores",
    "gestor:fornecedores",
  ]);
}

export function canViewProductSuppliers(principal: Principal): boolean {
  return hasAnyPermission(principal, [
    "gestor:produtos",
    "compras:fornecedores",
    "gestor:fornecedores",
    "compras:custos",
    "compras:consolidado",
  ]);
}

export const linkSupplierInputSchema = z
  .object({
    productId: z.string().uuid("ID de produto inválido"),
    supplierId: z.string().uuid("ID de fornecedor inválido"),
    isPrimary: z.boolean().default(false),
    isExclusive: z.boolean().default(false),
    notes: z
      .string()
      .trim()
      .max(500, "Observações devem ter no máximo 500 caracteres")
      .nullable()
      .optional()
      .transform((val) => (val && val.trim() !== "" ? val.trim() : null)),
  })
  .refine((data) => !data.isExclusive || data.isPrimary, {
    message: "Um fornecedor só pode ser exclusivo se for o fornecedor principal do produto.",
    path: ["isExclusive"],
  });

export type LinkSupplierInput = z.infer<typeof linkSupplierInputSchema>;

export const unlinkSupplierInputSchema = z.object({
  productId: z.string().uuid("ID de produto inválido"),
  supplierId: z.string().uuid("ID de fornecedor inválido"),
});

export type UnlinkSupplierInput = z.infer<typeof unlinkSupplierInputSchema>;

export const setPrimarySupplierInputSchema = z.object({
  productId: z.string().uuid("ID de produto inválido"),
  supplierId: z.string().uuid("ID de fornecedor inválido"),
  isExclusive: z.boolean().default(false),
});

export type SetPrimarySupplierInput = z.infer<typeof setPrimarySupplierInputSchema>;

export const toggleExclusivityInputSchema = z.object({
  productId: z.string().uuid("ID de produto inválido"),
  supplierId: z.string().uuid("ID de fornecedor inválido"),
  isExclusive: z.boolean(),
});

export type ToggleExclusivityInput = z.infer<typeof toggleExclusivityInputSchema>;
