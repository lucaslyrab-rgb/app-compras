"use server";

import { revalidatePath } from "next/cache";
import { currentPrincipal } from "./session";
import { hasPermission, LastAdminProtectionError, UserConflictError, UserValidationError } from "./domain";
import {
  createUser,
  updateUser,
  toggleUserActive,
  resetUserPassword,
  listUsersForManagement,
  type CreateUserInput,
  type UpdateUserInput,
  type ResetUserPasswordInput,
} from "./repository";
import { log } from "@/shared/logging";

export async function createUserAction(input: Omit<CreateUserInput, "actorId">) {
  const principal = await currentPrincipal();
  if (!principal || !hasPermission(principal, "gestor:usuarios")) {
    return { status: "error" as const, message: "Acesso negado: permissão gestor:usuarios necessária." };
  }

  try {
    const user = await createUser({ ...input, actorId: principal.userId });

    revalidatePath("/gestor/usuarios");
    revalidatePath("/");

    return { status: "success" as const, user };
  } catch (error) {
    if (
      error instanceof UserValidationError ||
      error instanceof LastAdminProtectionError ||
      error instanceof UserConflictError
    ) {
      return { status: "error" as const, message: error.message };
    }
    log("error", "Falha ao criar usuário", { error: error instanceof Error ? error.message : "unknown" });
    return { status: "error" as const, message: "Não foi possível criar o usuário. Verifique os dados e tente novamente." };
  }
}

export async function updateUserAction(input: Omit<UpdateUserInput, "actorId">) {
  const principal = await currentPrincipal();
  if (!principal || !hasPermission(principal, "gestor:usuarios")) {
    return { status: "error" as const, message: "Acesso negado: permissão gestor:usuarios necessária." };
  }

  try {
    const { user } = await updateUser({ ...input, actorId: principal.userId });

    revalidatePath("/gestor/usuarios");
    revalidatePath("/");

    return { status: "success" as const, user };
  } catch (error) {
    if (error instanceof UserConflictError) {
      const freshUsers = await listUsersForManagement();
      return { status: "conflict" as const, message: error.message, freshUsers };
    }
    if (
      error instanceof UserValidationError ||
      error instanceof LastAdminProtectionError
    ) {
      return { status: "error" as const, message: error.message };
    }
    log("error", "Falha ao atualizar usuário", { error: error instanceof Error ? error.message : "unknown" });
    return { status: "error" as const, message: "Não foi possível atualizar o usuário. Tente novamente." };
  }
}

export async function toggleUserActiveAction(input: {
  id: string;
  active: boolean;
  expectedUpdatedAt: string;
}) {
  const principal = await currentPrincipal();
  if (!principal || !hasPermission(principal, "gestor:usuarios")) {
    return { status: "error" as const, message: "Acesso negado: permissão gestor:usuarios necessária." };
  }

  try {
    const { user } = await toggleUserActive({ ...input, actorId: principal.userId });

    revalidatePath("/gestor/usuarios");
    revalidatePath("/");

    return { status: "success" as const, user };
  } catch (error) {
    if (error instanceof UserConflictError) {
      const freshUsers = await listUsersForManagement();
      return { status: "conflict" as const, message: error.message, freshUsers };
    }
    if (
      error instanceof UserValidationError ||
      error instanceof LastAdminProtectionError
    ) {
      return { status: "error" as const, message: error.message };
    }
    log("error", "Falha ao alterar status do usuário", { error: error instanceof Error ? error.message : "unknown" });
    return { status: "error" as const, message: "Não foi possível alterar o status do usuário." };
  }
}

export async function resetUserPasswordAction(input: Omit<ResetUserPasswordInput, "actorId">) {
  const principal = await currentPrincipal();
  if (!principal || !hasPermission(principal, "gestor:usuarios")) {
    return { status: "error" as const, message: "Acesso negado: permissão gestor:usuarios necessária." };
  }

  if (!input.expectedUpdatedAt) {
    return { status: "error" as const, message: "Timestamp de versão (expectedUpdatedAt) é obrigatório." };
  }

  try {
    const result = await resetUserPassword({ ...input, actorId: principal.userId });

    revalidatePath("/gestor/usuarios");
    revalidatePath("/");

    return {
      status: "success" as const,
      targetUserId: result.targetUserId,
      targetEmail: result.targetEmail,
      updatedAt: result.updatedAt,
    };
  } catch (error) {
    if (error instanceof UserConflictError) {
      const freshUsers = await listUsersForManagement();
      return { status: "conflict" as const, message: error.message, freshUsers };
    }
    if (
      error instanceof UserValidationError ||
      error instanceof LastAdminProtectionError
    ) {
      return { status: "error" as const, message: error.message };
    }
    log("error", "Falha ao resetar senha do usuário", { error: error instanceof Error ? error.message : "unknown" });
    return { status: "error" as const, message: "Não foi possível redefinir a senha do usuário." };
  }
}
