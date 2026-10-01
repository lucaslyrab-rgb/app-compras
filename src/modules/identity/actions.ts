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
import { recordAudit } from "./audit";
import { log } from "@/shared/logging";

export async function createUserAction(input: CreateUserInput) {
  const principal = await currentPrincipal();
  if (!principal || !hasPermission(principal, "gestor:usuarios")) {
    return { status: "error" as const, message: "Acesso negado: permissão gestor:usuarios necessária." };
  }

  try {
    const user = await createUser(input);

    await recordAudit({
      actorId: principal.userId,
      action: "USER_CREATED",
      entityType: "user",
      entityId: user.id,
      metadata: {
        email: user.email,
        name: user.name,
        role: user.role,
        storeId: user.storeId,
        permissions: user.permissions,
      },
    });

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

export async function updateUserAction(input: UpdateUserInput) {
  const principal = await currentPrincipal();
  if (!principal || !hasPermission(principal, "gestor:usuarios")) {
    return { status: "error" as const, message: "Acesso negado: permissão gestor:usuarios necessária." };
  }

  try {
    const { user, previous } = await updateUser(input);

    const changedFields: string[] = [];
    if (previous.name !== user.name) changedFields.push("name");
    if (previous.email !== user.email) changedFields.push("email");
    if (previous.role !== user.role) changedFields.push("role");
    if (previous.storeId !== user.storeId) changedFields.push("storeId");
    if (previous.active !== user.active) changedFields.push("active");
    if (JSON.stringify(previous.permissions) !== JSON.stringify(user.permissions)) changedFields.push("permissions");

    await recordAudit({
      actorId: principal.userId,
      action: "USER_UPDATED",
      entityType: "user",
      entityId: user.id,
      metadata: {
        changedFields,
        previous: {
          name: previous.name,
          email: previous.email,
          role: previous.role,
          storeId: previous.storeId,
          permissions: previous.permissions,
          active: previous.active,
        },
        current: {
          name: user.name,
          email: user.email,
          role: user.role,
          storeId: user.storeId,
          permissions: user.permissions,
          active: user.active,
        },
      },
    });

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
    const { user } = await toggleUserActive(input);

    await recordAudit({
      actorId: principal.userId,
      action: user.active ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      entityType: "user",
      entityId: user.id,
      metadata: {
        active: user.active,
        sessionsRevoked: !user.active,
      },
    });

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

export async function resetUserPasswordAction(input: ResetUserPasswordInput) {
  const principal = await currentPrincipal();
  if (!principal || !hasPermission(principal, "gestor:usuarios")) {
    return { status: "error" as const, message: "Acesso negado: permissão gestor:usuarios necessária." };
  }

  try {
    const result = await resetUserPassword(input);

    await recordAudit({
      actorId: principal.userId,
      action: "USER_PASSWORD_RESET",
      entityType: "user",
      entityId: result.targetUserId,
      metadata: {
        resetByAdmin: true,
        sessionsRevoked: true,
      },
    });

    revalidatePath("/gestor/usuarios");
    revalidatePath("/");

    return { status: "success" as const, targetUserId: result.targetUserId };
  } catch (error) {
    if (
      error instanceof UserValidationError ||
      error instanceof LastAdminProtectionError ||
      error instanceof UserConflictError
    ) {
      return { status: "error" as const, message: error.message };
    }
    log("error", "Falha ao resetar senha do usuário", { error: error instanceof Error ? error.message : "unknown" });
    return { status: "error" as const, message: "Não foi possível redefinir a senha do usuário." };
  }
}
