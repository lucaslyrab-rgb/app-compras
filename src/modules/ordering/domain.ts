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
