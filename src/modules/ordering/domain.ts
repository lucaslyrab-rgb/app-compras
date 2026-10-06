import { z } from "zod";

export const draftItem = z.object({
  productId: z.string().uuid(),
  stock: z.number().min(0).finite(),
  quantity: z.number().min(0).finite()
});
export type DraftItem = z.infer<typeof draftItem>;

export class DraftConflictError extends Error {
  override name = "DraftConflictError";
}

export class OrderValidationError extends Error {
  override name = "OrderValidationError";
}

export function validateDraft(items: DraftItem[]) {
  const parsed = z.array(draftItem).parse(items);
  const ids = new Set(parsed.map((item) => item.productId));
  if (ids.size !== parsed.length) throw new Error("Produto duplicado no rascunho");
  return parsed;
}

export function nextRevision(existing: number[]) {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

export function conferenceItems<T extends { quantity: number }>(items: T[]) {
  return items.filter((item) => item.quantity > 0);
}

export interface OrderReportItem {
  erpCode: number;
  name: string;
  unit: string;
  quantity: number | string;
  stock?: number | string;
}

export interface OrderReportHeader {
  id: string;
  orderDate: string;
  purchaseCycleDate: string;
  revision: number;
  submittedAt: Date;
  cancelledAt: Date | null;
  cancellationReason: string | null;
}

export function filterReportItems<T extends { quantity: number | string }>(items: T[]): T[] {
  return items.filter((item) => Number(item.quantity) > 0);
}

export const ORDER_PRINT_TWO_COLUMN_THRESHOLD = 15;

export function splitReportItems<T>(items: T[]): [T[], T[]] {
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}

export function sortReportItems<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

export const DISCRETE_PURCHASE_FORMATS = new Set([
  "CX",
  "CAIXA",
  "SC",
  "SACO",
  "UND",
  "UN",
  "UNIDADE",
  "PCT",
  "PACOTE",
  "BDJ",
  "BANDEJA",
  "DZ",
  "DUZIA",
  "DÚZIA",
  "FD",
  "FARDO",
  "MC",
  "MÇ",
  "MACO",
  "MAÇO",
]);

export function isDiscretePurchaseFormat(format: string | null | undefined): boolean {
  if (!format) return false;
  const normalized = format.trim().toLocaleUpperCase("pt-BR");
  return DISCRETE_PURCHASE_FORMATS.has(normalized);
}

export function getPurchaseFormatLabel(format: string | null | undefined): string {
  if (!format) return "unidade";
  const normalized = format.trim().toLocaleUpperCase("pt-BR");
  switch (normalized) {
    case "CX":
    case "CAIXA":
      return "caixa";
    case "SC":
    case "SACO":
      return "saco";
    case "UND":
    case "UN":
    case "UNIDADE":
      return "unidade";
    case "PCT":
    case "PACOTE":
      return "pacote";
    case "BDJ":
    case "BANDEJA":
      return "bandeja";
    case "DZ":
    case "DUZIA":
    case "DÚZIA":
      return "dúzia";
    case "FD":
    case "FARDO":
      return "fardo";
    case "MC":
    case "MÇ":
    case "MACO":
    case "MAÇO":
      return "maço";
    default:
      return format.trim().toLocaleLowerCase("pt-BR");
  }
}

export function parseQuantityInput(raw: unknown): number | null {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || Number.isNaN(raw) || raw < 0) return null;
    return raw;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const normalized = trimmed.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || Number.isNaN(num) || num < 0) return null;
  return num;
}

export function validateOrderQuantity(
  rawValue: string,
  purchaseFormat: string | null | undefined
): { valid: boolean; error?: string; parsedValue?: number } {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { valid: true, parsedValue: 0 };
  }

  const isDiscrete = isDiscretePurchaseFormat(purchaseFormat);
  const formatLabel = getPurchaseFormatLabel(purchaseFormat);

  if (isDiscrete && (trimmed.includes(",") || trimmed.includes("."))) {
    const parsed = parseQuantityInput(trimmed);
    if (parsed !== null && Number.isInteger(parsed) && !trimmed.endsWith(",") && !trimmed.endsWith(".")) {
      return { valid: true, parsedValue: parsed };
    }
    return {
      valid: false,
      error: `Informe uma quantidade inteira. Para este produto não é permitido ${trimmed} ${formatLabel}.`,
    };
  }

  const parsed = parseQuantityInput(trimmed);
  if (parsed === null) {
    return {
      valid: false,
      error: "Informe uma quantidade válida.",
    };
  }

  if (isDiscrete && !Number.isInteger(parsed)) {
    return {
      valid: false,
      error: `Informe uma quantidade inteira. Para este produto não é permitido ${trimmed} ${formatLabel}.`,
    };
  }

  return { valid: true, parsedValue: parsed };
}

export function formatOrderQuantity(value: number | string): string {
  const num = typeof value === "number" ? value : parseQuantityInput(value);
  if (num === null || Number.isNaN(num)) return String(value);
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatCycleDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  if (!year || !month || !day) return dateStr;
  return `${day}/${month}/${year}`;
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}
