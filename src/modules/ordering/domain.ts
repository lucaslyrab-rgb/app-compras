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

export function formatOrderQuantity(value: number | string): string {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return String(value);
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
