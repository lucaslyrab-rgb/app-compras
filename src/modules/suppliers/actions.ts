"use server";

import { revalidatePath } from "next/cache";
import { recordAudit } from "@/modules/identity/audit";
import {
  canManageSuppliers,
  canToggleSupplierStatus,
} from "@/modules/identity/domain";
import { currentPrincipal } from "@/modules/identity/session";
import { log } from "@/shared/logging";
import {
  createSupplierInputSchema,
  toggleSupplierActiveInputSchema,
  updateSupplierInputSchema,
  SupplierConflictError,
  SupplierNotFoundError,
  SupplierValidationError,
} from "./domain";
import {
  createSupplier,
  listSuppliers,
  toggleSupplierActive,
  updateSupplier,
} from "./repository";

export async function createSupplierAction(raw: unknown) {
  const principal = await currentPrincipal();
  if (!principal || !canManageSuppliers(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: permissão de fornecedores necessária.",
    };
  }

  const parsed = createSupplierInputSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    return { status: "error" as const, message: firstIssue };
  }

  try {
    const supplier = await createSupplier({
      ...parsed.data,
      actorId: principal.userId,
    });

    await recordAudit({
      actorId: principal.userId,
      action: "SUPPLIER_CREATED",
      entityType: "supplier",
      entityId: supplier.id,
      metadata: {
        corporateName: supplier.corporateName,
        tradeName: supplier.tradeName,
        taxId: supplier.taxId,
        taxInvoiceRule: supplier.taxInvoiceRule,
      },
    });

    revalidatePath("/gestor/fornecedores");
    revalidatePath("/comprador/fornecedores");

    return { status: "success" as const, supplier };
  } catch (error) {
    if (
      error instanceof SupplierValidationError ||
      error instanceof SupplierConflictError
    ) {
      return { status: "error" as const, message: error.message };
    }

    log("error", "Falha ao criar fornecedor", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível cadastrar o fornecedor. Verifique os dados e tente novamente.",
    };
  }
}

export async function updateSupplierAction(raw: unknown) {
  const principal = await currentPrincipal();
  if (!principal || !canManageSuppliers(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: permissão de fornecedores necessária.",
    };
  }

  const parsed = updateSupplierInputSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    return { status: "error" as const, message: firstIssue };
  }

  try {
    const supplier = await updateSupplier({
      ...parsed.data,
      actorId: principal.userId,
    });

    await recordAudit({
      actorId: principal.userId,
      action: "SUPPLIER_UPDATED",
      entityType: "supplier",
      entityId: supplier.id,
      metadata: {
        version: supplier.version,
        corporateName: supplier.corporateName,
        tradeName: supplier.tradeName,
        taxId: supplier.taxId,
        taxInvoiceRule: supplier.taxInvoiceRule,
      },
    });

    revalidatePath("/gestor/fornecedores");
    revalidatePath("/comprador/fornecedores");

    return { status: "success" as const, supplier };
  } catch (error) {
    if (
      error instanceof SupplierValidationError ||
      error instanceof SupplierConflictError ||
      error instanceof SupplierNotFoundError
    ) {
      return { status: "error" as const, message: error.message };
    }

    log("error", "Falha ao atualizar fornecedor", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível atualizar o fornecedor. Verifique os dados e tente novamente.",
    };
  }
}

export async function toggleSupplierActiveAction(raw: unknown) {
  const principal = await currentPrincipal();
  if (!principal || !canToggleSupplierStatus(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: apenas o perfil Gestor pode ativar ou desativar fornecedores.",
    };
  }

  const parsed = toggleSupplierActiveInputSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    return { status: "error" as const, message: firstIssue };
  }

  try {
    const supplier = await toggleSupplierActive({
      ...parsed.data,
      actorId: principal.userId,
    });

    await recordAudit({
      actorId: principal.userId,
      action: supplier.active ? "SUPPLIER_ACTIVATED" : "SUPPLIER_DEACTIVATED",
      entityType: "supplier",
      entityId: supplier.id,
      metadata: {
        version: supplier.version,
        active: supplier.active,
      },
    });

    revalidatePath("/gestor/fornecedores");
    revalidatePath("/comprador/fornecedores");

    return { status: "success" as const, supplier };
  } catch (error) {
    if (
      error instanceof SupplierValidationError ||
      error instanceof SupplierConflictError ||
      error instanceof SupplierNotFoundError
    ) {
      return { status: "error" as const, message: error.message };
    }

    log("error", "Falha ao alterar situação do fornecedor", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível alterar a situação do fornecedor.",
    };
  }
}

export async function listActiveSuppliersAction() {
  const principal = await currentPrincipal();
  if (!principal || !canManageSuppliers(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: permissão de fornecedores necessária.",
      suppliers: [],
    };
  }

  try {
    const suppliers = await listSuppliers({ includeInactive: false });
    return { status: "success" as const, suppliers };
  } catch (error) {
    log("error", "Falha ao listar fornecedores ativos", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível carregar fornecedores.",
      suppliers: [],
    };
  }
}
