"use server";

import { revalidatePath } from "next/cache";
import { recordAudit } from "@/modules/identity/audit";
import { currentPrincipal } from "@/modules/identity/session";
import { log } from "@/shared/logging";
import {
  canManageProductSuppliers,
  canViewProductSuppliers,
  linkSupplierInputSchema,
  setPrimarySupplierInputSchema,
  toggleExclusivityInputSchema,
  unlinkSupplierInputSchema,
  ProductSupplierConflictError,
  ProductSupplierNotFoundError,
  ProductSupplierValidationError,
} from "./product-suppliers-domain";
import {
  linkSupplierToProduct,
  listProductsBySupplier,
  listSuppliersByProduct,
  setPrimarySupplier,
  toggleExclusivity,
  unlinkSupplierFromProduct,
} from "./product-suppliers-repository";

export async function listProductSuppliersAction(productId: string) {
  const principal = await currentPrincipal();
  if (!principal || !canViewProductSuppliers(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: você não tem permissão para visualizar vínculos de fornecedores.",
    };
  }

  try {
    const suppliers = await listSuppliersByProduct(productId);
    return { status: "success" as const, suppliers };
  } catch (error) {
    log("error", "Falha ao listar fornecedores do produto", {
      productId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível carregar os fornecedores do produto.",
    };
  }
}

export async function listSupplierProductsAction(supplierId: string) {
  const principal = await currentPrincipal();
  if (!principal || !canViewProductSuppliers(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: você não tem permissão para visualizar vínculos de produtos.",
    };
  }

  try {
    const products = await listProductsBySupplier(supplierId);
    return { status: "success" as const, products };
  } catch (error) {
    log("error", "Falha ao listar produtos do fornecedor", {
      supplierId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível carregar os produtos atendidos pelo fornecedor.",
    };
  }
}

export async function linkSupplierAction(raw: unknown) {
  const principal = await currentPrincipal();
  if (!principal || !canManageProductSuppliers(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: permissão insuficiente para vincular fornecedores.",
    };
  }

  const parsed = linkSupplierInputSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    return { status: "error" as const, message: firstIssue };
  }

  try {
    const link = await linkSupplierToProduct({
      ...parsed.data,
      actorId: principal.userId,
    });

    await recordAudit({
      actorId: principal.userId,
      action: "PRODUCT_SUPPLIER_LINKED",
      entityType: "product_supplier",
      entityId: link.id,
      metadata: {
        productId: link.productId,
        supplierId: link.supplierId,
        isPrimary: link.isPrimary,
        isExclusive: link.isExclusive,
        corporateName: link.corporateName,
      },
    });

    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/fornecedores");
    revalidatePath("/comprador/fornecedores");
    revalidatePath("/comprador/consolidado");
    revalidatePath("/comprador/custos");

    return { status: "success" as const, link };
  } catch (error) {
    if (
      error instanceof ProductSupplierValidationError ||
      error instanceof ProductSupplierConflictError ||
      error instanceof ProductSupplierNotFoundError
    ) {
      return { status: "error" as const, message: error.message };
    }

    log("error", "Falha ao vincular fornecedor ao produto", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível vincular o fornecedor. Tente novamente.",
    };
  }
}

export async function unlinkSupplierAction(raw: unknown) {
  const principal = await currentPrincipal();
  if (!principal || !canManageProductSuppliers(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: permissão insuficiente para desvincular fornecedores.",
    };
  }

  const parsed = unlinkSupplierInputSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    return { status: "error" as const, message: firstIssue };
  }

  try {
    await unlinkSupplierFromProduct({
      ...parsed.data,
      actorId: principal.userId,
    });

    await recordAudit({
      actorId: principal.userId,
      action: "PRODUCT_SUPPLIER_UNLINKED",
      entityType: "product_supplier",
      entityId: `${parsed.data.productId}:${parsed.data.supplierId}`,
      metadata: {
        productId: parsed.data.productId,
        supplierId: parsed.data.supplierId,
      },
    });

    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/fornecedores");
    revalidatePath("/comprador/fornecedores");
    revalidatePath("/comprador/consolidado");
    revalidatePath("/comprador/custos");

    return { status: "success" as const };
  } catch (error) {
    if (
      error instanceof ProductSupplierValidationError ||
      error instanceof ProductSupplierNotFoundError
    ) {
      return { status: "error" as const, message: error.message };
    }

    log("error", "Falha ao desvincular fornecedor", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível desvincular o fornecedor. Tente novamente.",
    };
  }
}

export async function setPrimarySupplierAction(raw: unknown) {
  const principal = await currentPrincipal();
  if (!principal || !canManageProductSuppliers(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: permissão insuficiente para alterar o fornecedor principal.",
    };
  }

  const parsed = setPrimarySupplierInputSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    return { status: "error" as const, message: firstIssue };
  }

  try {
    const link = await setPrimarySupplier({
      ...parsed.data,
      actorId: principal.userId,
    });

    await recordAudit({
      actorId: principal.userId,
      action: "PRODUCT_PRIMARY_SUPPLIER_SET",
      entityType: "product_supplier",
      entityId: link.id,
      metadata: {
        productId: link.productId,
        supplierId: link.supplierId,
        isPrimary: link.isPrimary,
        isExclusive: link.isExclusive,
        corporateName: link.corporateName,
      },
    });

    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/fornecedores");
    revalidatePath("/comprador/fornecedores");
    revalidatePath("/comprador/consolidado");
    revalidatePath("/comprador/custos");

    return { status: "success" as const, link };
  } catch (error) {
    if (
      error instanceof ProductSupplierValidationError ||
      error instanceof ProductSupplierNotFoundError
    ) {
      return { status: "error" as const, message: error.message };
    }

    log("error", "Falha ao definir fornecedor principal", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível definir o fornecedor principal. Tente novamente.",
    };
  }
}

export async function toggleExclusivityAction(raw: unknown) {
  const principal = await currentPrincipal();
  if (!principal || !canManageProductSuppliers(principal)) {
    return {
      status: "error" as const,
      message: "Acesso negado: permissão insuficiente para alterar exclusividade.",
    };
  }

  const parsed = toggleExclusivityInputSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    return { status: "error" as const, message: firstIssue };
  }

  try {
    const link = await toggleExclusivity({
      ...parsed.data,
      actorId: principal.userId,
    });

    await recordAudit({
      actorId: principal.userId,
      action: "PRODUCT_SUPPLIER_EXCLUSIVITY_TOGGLED",
      entityType: "product_supplier",
      entityId: link.id,
      metadata: {
        productId: link.productId,
        supplierId: link.supplierId,
        isExclusive: link.isExclusive,
        corporateName: link.corporateName,
      },
    });

    revalidatePath("/gestor/produtos");
    revalidatePath("/gestor/fornecedores");
    revalidatePath("/comprador/fornecedores");
    revalidatePath("/comprador/consolidado");
    revalidatePath("/comprador/custos");

    return { status: "success" as const, link };
  } catch (error) {
    if (
      error instanceof ProductSupplierValidationError ||
      error instanceof ProductSupplierNotFoundError
    ) {
      return { status: "error" as const, message: error.message };
    }

    log("error", "Falha ao alterar exclusividade de fornecedor", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      status: "error" as const,
      message: "Não foi possível alterar a exclusividade. Tente novamente.",
    };
  }
}
