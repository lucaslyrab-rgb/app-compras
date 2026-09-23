"use server";

import { z } from "zod";
import { requirePrincipal } from "@/modules/identity/session";
import { log } from "@/shared/logging";
import {
  PurchaseCostConflictError,
  PurchaseCostValidationError,
  type SavedPurchaseCost,
} from "./domain";
import { savePurchaseCost } from "./service";

const inputSchema = z.object({
  productId: z.uuid(),
  cycleDate: z.iso.date(),
  costInput: z.string().max(32),
  purchased: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
});

export type SavePurchaseCostResult =
  | { status: "success"; value: SavedPurchaseCost }
  | { status: "conflict"; value: SavedPurchaseCost; message: string }
  | { status: "error"; message: string };

export async function savePurchaseCostAction(
  rawInput: unknown,
): Promise<SavePurchaseCostResult> {
  const principal = await requirePrincipal();
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success)
    return { status: "error", message: "Dados de custo inválidos." };
  try {
    const value = await savePurchaseCost(principal, parsed.data);
    return { status: "success", value };
  } catch (error) {
    if (error instanceof PurchaseCostConflictError)
      return {
        status: "conflict",
        value: error.current,
        message: error.message,
      };
    if (error instanceof PurchaseCostValidationError)
      return { status: "error", message: error.message };
    log("error", "Falha ao salvar custo de compra", {
      error: error instanceof Error ? error.message : "unknown",
      productId: parsed.data.productId,
      cycleDate: parsed.data.cycleDate,
    });
    return {
      status: "error",
      message: "Não foi possível salvar o custo.",
    };
  }
}
