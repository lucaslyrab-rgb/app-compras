"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePrincipal } from "@/modules/identity/session";
import { log } from "@/shared/logging";
import {
  AllocationDestinationConflictError,
  AllocationValidationError,
  CycleClosedError,
  ExclusivityViolationError,
} from "./domain";
import type { AllocationDestinationConflict } from "./domain";
import {
  closeBuyerCycle,
  closeStoreCycle,
  concludeSupplierStoreReview,
  reopenBuyerCycle,
  reopenStoreCycle,
  revertProductSupplierDecision,
  saveSupplierAllocations,
  setProductSupplierDecision,
} from "./repository";

const storeAllocationSchema = z.object({
  storeId: z.string().uuid(),
  destinedQuantity: z.string().min(1).max(20),
  notes: z.string().optional(),
  conflictResolution: z.enum(["TRANSFER", "SPLIT_CONFIRMED"]).optional(),
  conflictFingerprint: z.string().min(1).max(2000).optional(),
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

const setDecisionSchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplierId: z.string().uuid(),
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  decision: z.literal("NOT_PURCHASED"),
  notes: z.string().optional(),
  confirmRemoveDestined: z.boolean().optional(),
});

const revertDecisionSchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplierId: z.string().uuid(),
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
});

const concludeSupplierStoreReviewSchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplierId: z.string().uuid(),
  storeId: z.string().uuid(),
  expectedProductIds: z.array(z.string().uuid()),
});

const closeStoreCycleSchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  storeId: z.string().uuid(),
  expectedOrderId: z.string().uuid().nullable(),
  expectedOrderRevision: z.number().int().min(1).nullable(),
  expectedAllocationsHash: z.string().min(1, "Hash de alocações da prévia é obrigatório."),
  expectedCostsHash: z.string().min(1, "Hash de custos da prévia é obrigatório."),
});

const reopenStoreCycleSchema = z.object({
  cycleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  storeId: z.string().uuid(),
  reason: z.string().min(5, "Justificativa deve ter pelo menos 5 caracteres."),
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
  | {
      status: "conflict";
      message: string;
      conflicts: AllocationDestinationConflict[];
    }
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
    if (error instanceof AllocationDestinationConflictError) {
      return {
        status: "conflict",
        message: error.message,
        conflicts: error.conflicts,
      };
    }

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

export async function setProductSupplierDecisionAction(
  rawInput: unknown,
): Promise<ActionResponse<{ success: boolean }>> {
  try {
    const principal = await requirePrincipal();
    const parsed = setDecisionSchema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        status: "error",
        message: "Dados inválidos para registrar decisão de fornecedor.",
      };
    }

    await setProductSupplierDecision(principal, parsed.data);
    revalidatePath("/comprador/destinacao");
    revalidatePath("/comprador/fornecedores/faturamento");

    return {
      status: "success",
      data: { success: true },
      message: "Decisão registrada com sucesso.",
    };
  } catch (error) {
    if (error instanceof AllocationValidationError || error instanceof CycleClosedError) {
      return { status: "error", message: error.message };
    }

    log("error", "Falha ao registrar decisão de não compra", {
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao registrar decisão.",
    };
  }
}

export async function revertProductSupplierDecisionAction(
  rawInput: unknown,
): Promise<ActionResponse<{ success: boolean }>> {
  try {
    const principal = await requirePrincipal();
    const parsed = revertDecisionSchema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        status: "error",
        message: "Dados inválidos para reverter decisão de fornecedor.",
      };
    }

    await revertProductSupplierDecision(principal, parsed.data);
    revalidatePath("/comprador/destinacao");
    revalidatePath("/comprador/fornecedores/faturamento");

    return {
      status: "success",
      data: { success: true },
      message: "Decisão revertida com sucesso.",
    };
  } catch (error) {
    if (error instanceof AllocationValidationError || error instanceof CycleClosedError) {
      return { status: "error", message: error.message };
    }

    log("error", "Falha ao reverter decisão de fornecedor", {
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao reverter decisão.",
    };
  }
}

export async function concludeSupplierStoreReviewAction(
  rawInput: unknown,
): Promise<ActionResponse<{ affectedCount: number }>> {
  try {
    const principal = await requirePrincipal();
    const parsed = concludeSupplierStoreReviewSchema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        status: "error",
        message: "Dados inválidos para concluir conferência do fornecedor.",
      };
    }

    const result = await concludeSupplierStoreReview(principal, parsed.data);
    revalidatePath("/comprador/destinacao");
    revalidatePath("/comprador/fornecedores/faturamento");

    return {
      status: "success",
      data: { affectedCount: result.affectedCount },
      message: "Conferência do fornecedor concluída com sucesso.",
    };
  } catch (error) {
    if (error instanceof AllocationValidationError || error instanceof CycleClosedError) {
      return { status: "error", message: error.message };
    }

    log("error", "Falha ao concluir conferência do fornecedor", {
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao concluir conferência do fornecedor.",
    };
  }
}

export async function closeStoreCycleAction(
  rawInput: unknown,
): Promise<ActionResponse<{ totalCutItems: number }>> {
  try {
    const principal = await requirePrincipal();
    const parsed = closeStoreCycleSchema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        status: "error",
        message: "Dados inválidos para finalizar conferência da loja.",
      };
    }

    const result = await closeStoreCycle(principal, parsed.data);
    revalidatePath("/comprador/destinacao");
    revalidatePath("/comprador/fornecedores/faturamento");

    return {
      status: "success",
      data: { totalCutItems: result.totalCutItems },
      message: "Conferência da loja finalizada com sucesso.",
    };
  } catch (error) {
    if (error instanceof AllocationValidationError || error instanceof CycleClosedError) {
      return { status: "error", message: error.message };
    }

    log("error", "Falha ao finalizar conferência da loja", {
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao finalizar conferência da loja.",
    };
  }
}

export async function reopenStoreCycleAction(
  rawInput: unknown,
): Promise<ActionResponse<{ reopenedAt: string }>> {
  try {
    const principal = await requirePrincipal();
    const parsed = reopenStoreCycleSchema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        status: "error",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos para reabertura da loja.",
      };
    }

    const result = await reopenStoreCycle(principal, parsed.data);
    revalidatePath("/comprador/destinacao");
    revalidatePath("/comprador/fornecedores/faturamento");

    return {
      status: "success",
      data: { reopenedAt: result.reopenedAt },
      message: "Conferência da loja reaberta com sucesso.",
    };
  } catch (error) {
    if (error instanceof AllocationValidationError || error instanceof CycleClosedError) {
      return { status: "error", message: error.message };
    }

    log("error", "Falha ao reabrir conferência da loja", {
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Erro ao reabrir conferência da loja.",
    };
  }
}
