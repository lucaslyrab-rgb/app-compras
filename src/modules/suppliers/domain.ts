import { z } from "zod";

export const TAX_ID_TYPES = ["CNPJ", "CPF", "NOT_INFORMED"] as const;
export type TaxIdType = (typeof TAX_ID_TYPES)[number];

export const TAX_INVOICE_RULES = ["STANDARD", "AFTER_WEIGHING", "SPECIAL_REGIME"] as const;
export type TaxInvoiceRule = (typeof TAX_INVOICE_RULES)[number];

export const TAX_ID_TYPE_LABELS: Record<TaxIdType, string> = {
  CNPJ: "CNPJ",
  CPF: "CPF",
  NOT_INFORMED: "Não informado",
};

export const TAX_INVOICE_RULE_LABELS: Record<TaxInvoiceRule, string> = {
  STANDARD: "Emissão normal",
  AFTER_WEIGHING: "Após pesagem (banana)",
  SPECIAL_REGIME: "Regime especial / produtor rural",
};

export type Supplier = {
  id: string;
  corporateName: string;
  tradeName: string | null;
  taxId: string | null;
  taxIdType: TaxIdType;
  taxInvoiceRule: TaxInvoiceRule;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  active: boolean;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class SupplierValidationError extends Error {
  override name = "SupplierValidationError";
}

export class SupplierConflictError extends Error {
  override name = "SupplierConflictError";
}

export class SupplierNotFoundError extends Error {
  override name = "SupplierNotFoundError";
}

export function normalizeTaxId(taxId?: string | null): string | null {
  if (typeof taxId !== "string") return null;
  const cleaned = taxId.replace(/\D/g, "");
  return cleaned === "" ? null : cleaned;
}

export function isValidCpf(digits: string): boolean {
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * (10 - i);
  }
  let rem = sum % 11;
  const digit1 = rem < 2 ? 0 : 11 - rem;
  if (digit1 !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * (11 - i);
  }
  rem = sum % 11;
  const digit2 = rem < 2 ? 0 : 11 - rem;
  if (digit2 !== Number(digits[10])) return false;

  return true;
}

export function isValidCnpj(digits: string): boolean {
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits[i]) * weights1[i];
  }
  let rem = sum % 11;
  const digit1 = rem < 2 ? 0 : 11 - rem;
  if (digit1 !== Number(digits[12])) return false;

  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(digits[i]) * weights2[i];
  }
  rem = sum % 11;
  const digit2 = rem < 2 ? 0 : 11 - rem;
  if (digit2 !== Number(digits[13])) return false;

  return true;
}

export function validateTaxId(taxId?: string | null): {
  valid: boolean;
  type: TaxIdType;
  normalized: string | null;
  reason?: string;
} {
  const normalized = normalizeTaxId(taxId);
  if (!normalized) {
    return { valid: true, type: "NOT_INFORMED", normalized: null };
  }

  if (normalized.length === 11) {
    if (!isValidCpf(normalized)) {
      return { valid: false, type: "CPF", normalized, reason: "CPF inválido: dígitos verificadores incorretos." };
    }
    return { valid: true, type: "CPF", normalized };
  }

  if (normalized.length === 14) {
    if (!isValidCnpj(normalized)) {
      return { valid: false, type: "CNPJ", normalized, reason: "CNPJ inválido: dígitos verificadores incorretos." };
    }
    return { valid: true, type: "CNPJ", normalized };
  }

  return {
    valid: false,
    type: "NOT_INFORMED",
    normalized,
    reason: "Documento fiscal deve conter 11 dígitos (CPF) ou 14 dígitos (CNPJ).",
  };
}

export function formatTaxId(taxId?: string | null): string {
  const normalized = normalizeTaxId(taxId);
  if (!normalized) return "";

  if (normalized.length === 11) {
    return normalized.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }

  if (normalized.length === 14) {
    return normalized.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }

  return normalized;
}

export function normalizePhone(phone?: string | null): string | null {
  if (typeof phone !== "string") return null;
  const cleaned = phone.replace(/\D/g, "");
  return cleaned === "" ? null : cleaned;
}

export function formatPhone(phone?: string | null): string {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";

  if (normalized.length === 10) {
    return normalized.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }

  if (normalized.length === 11) {
    return normalized.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }

  return normalized;
}

export const createSupplierInputSchema = z.object({
  corporateName: z
    .string()
    .trim()
    .min(1, "A razão social é obrigatória."),
  tradeName: z
    .string()
    .trim()
    .transform((val) => (val === "" ? null : val))
    .nullable()
    .optional(),
  taxId: z
    .string()
    .trim()
    .transform((val) => normalizeTaxId(val))
    .nullable()
    .optional(),
  taxInvoiceRule: z.enum(TAX_INVOICE_RULES, {
    message: "Regra de emissão de NF inválida.",
  }).default("STANDARD"),
  contactName: z
    .string()
    .trim()
    .transform((val) => (val === "" ? null : val))
    .nullable()
    .optional(),
  contactPhone: z
    .string()
    .trim()
    .transform((val) => normalizePhone(val))
    .nullable()
    .optional(),
  notes: z
    .string()
    .trim()
    .transform((val) => (val === "" ? null : val))
    .nullable()
    .optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierInputSchema>;

export const updateSupplierInputSchema = createSupplierInputSchema.extend({
  id: z.string().uuid("ID de fornecedor inválido."),
  expectedVersion: z.number().int().positive("Versão esperada inválida."),
});

export type UpdateSupplierInput = z.infer<typeof updateSupplierInputSchema>;

export const toggleSupplierActiveInputSchema = z.object({
  id: z.string().uuid("ID de fornecedor inválido."),
  active: z.boolean(),
  expectedVersion: z.number().int().positive("Versão esperada inválida."),
});

export type ToggleSupplierActiveInput = z.infer<typeof toggleSupplierActiveInputSchema>;
