"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePrincipal } from "@/modules/identity/session";
import { log } from "@/shared/logging";
import {
  AllocationValidationError,
  CycleClosedError,
  ExclusivityViolationError,
} from "./domain";
import {
  closeBuyerCycle,
  reopenBuyerCycle,
  saveSupplierAllocations,
} from "./repository";

const storeAllocationSchema = z.object({
  storeId: z.string().uuid(),
  destinedQuantity: z.string().min(1).max(20),
  notes: z.string().optional(),
});

const productAllocationSchema = z.object({
  productId: z.string().uuid(),
  stores: z.array(storeAllocationSchema),
  notes: z.string().optional(),
  isOpportunityConfirmed: z.boolean().optional(),
});

const saveAllocationsSchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplierId: z.string().uuid(),
  storeId: z.string().uuid().optional(),
  allocations: z.array(productAllocationSchema),
});

const closeCycleSchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const reopenCycleSchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(5, "Justificativa deve ter pelo menos 5 caracteres."),
});

export type ActionResponse<T = unknown> =
  | { status: "success"; data?: T; message?: string }
  | { status: "error"; message: string };

export async function saveSupplierAllocationsAction(
  rawInput: unknown,
): Promise<ActionResponse<{ affectedProductsCount: number }>> {
  try {
    const principal = await requirePrincipal();
    const parsed = saveAllocationsSchema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        status: "error",
        message: "Dados de destinação inválidos.",
      };
    }

    const result = await saveSupplierAllocations(principal, parsed.data);
    revalidatePath("/comprador/destinacao");
    revalidatePath("/comprador/fornecedores/faturamento");

    return {
      status: "success",
      data: { affectedProductsCount: result.affectedProductsCount },
      message: "Destinações salvas com sucesso.",
    };
  } catch (error) {
    if (
      error instanceof AllocationValidationError ||
      error instanceof ExclusivityViolationError ||
      error instanceof CycleClosedError
    ) {
      return { status: "error", message: error.message };
    }

    log("error", "Falha ao salvar destinações do comprador", {
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      status: "error",
      message: "Erro inesperado ao salvar destinações.",
    };
  }
}

export async function closeBuyerCycleAction(
  rawInput: unknown,
): Promise<ActionResponse<{ closedAt: string }>> {
  try {
    const principal = await requirePrincipal();
    const parsed = closeCycleSchema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        status: "error",
        message: "Data de ciclo inválida.",
      };
    }

    const result = await closeBuyerCycle(principal, parsed.data.cycleDate);
    revalidatePath("/comprador/destinacao");
    revalidatePath("/comprador/fornecedores/faturamento");

    return {
      status: "success",
      data: { closedAt: result.closedAt },
      message: "Ciclo operacional fechado com sucesso.",
    };
  } catch (error) {
    if (error instanceof AllocationValidationError) {
      return { status: "error", message: error.message };
    }

    log("error", "Falha ao fechar ciclo operacional", {
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao fechar ciclo.",
    };
  }
}

export async function reopenBuyerCycleAction(
  rawInput: unknown,
): Promise<ActionResponse<{ reopenedAt: string }>> {
  try {
    const principal = await requirePrincipal();
    const parsed = reopenCycleSchema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        status: "error",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos para reabertura.",
      };
    }

    const result = await reopenBuyerCycle(
      principal,
      parsed.data.cycleDate,
      parsed.data.reason,
    );
    revalidatePath("/comprador/destinacao");
    revalidatePath("/comprador/fornecedores/faturamento");

    return {
      status: "success",
      data: { reopenedAt: result.reopenedAt },
      message: "Ciclo operacional reaberto com sucesso.",
    };
  } catch (error) {
    if (error instanceof AllocationValidationError) {
      return { status: "error", message: error.message };
    }

    log("error", "Falha ao reabrir ciclo operacional", {
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao reabrir ciclo.",
    };
  }
}
