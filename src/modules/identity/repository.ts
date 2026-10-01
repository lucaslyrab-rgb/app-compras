import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { database } from "@/db/client";
import { sessions, stores, users } from "@/db/schema";
import { recordAudit } from "./audit";
import {
  assertPassword,
  assertStoreUserInvariant,
  createSessionToken,
  hashPassword,
  hashToken,
  isValidEmail,
  LastAdminProtectionError,
  normalizeEmail,
  normalizeStoreId,
  sessionExpiries,
  UserConflictError,
  UserValidationError,
  verifyPassword,
  type Permission,
  type Principal,
  type Role,
} from "./domain";

export const USER_MANAGEMENT_ADVISORY_LOCK_ID = 42424201;

export type ManagedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  storeId: string | null;
  storeName: string | null;
  permissions: Permission[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ActiveStoreOption = {
  id: string;
  name: string;
  slug: string;
};

export async function authenticate(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const [user] = await database().db.select().from(users).where(and(eq(users.email, normalized), eq(users.active, true))).limit(1);
  if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
  const { token, tokenHash } = createSessionToken();
  const expiries = sessionExpiries();
  await database().db.insert(sessions).values({ userId: user.id, tokenHash, ...expiries });
  return { token, absoluteExpiresAt: expiries.absoluteExpiresAt };
}

export async function findPrincipal(token: string): Promise<Principal | null> {
  const now = new Date();
  const [row] = await database().db.select({
    userId: users.id,
    role: users.role,
    storeId: users.storeId,
    permissions: users.permissions,
    sessionId: sessions.id,
  })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.idleExpiresAt, now), gt(sessions.absoluteExpiresAt, now), eq(users.active, true)))
    .limit(1);
  if (!row) return null;
  const idleExpiresAt = sessionExpiries(now).idleExpiresAt;
  await database().db.update(sessions).set({ lastSeenAt: now, idleExpiresAt }).where(eq(sessions.id, row.sessionId));
  return {
    userId: row.userId,
    role: row.role,
    storeId: row.storeId,
    permissions: (row.permissions ?? []) as Permission[],
  };
}

export async function revokeSession(token: string) {
  await database().db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function revokeAllUserSessions(
  userId: string,
  dbClient: ReturnType<typeof database>["db"] = database().db
) {
  await dbClient
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function listUsersForManagement(): Promise<ManagedUser[]> {
  const rows = await database().db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      storeId: users.storeId,
      storeName: stores.name,
      permissions: users.permissions,
      active: users.active,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .leftJoin(stores, eq(users.storeId, stores.id))
    .orderBy(users.name);

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    storeId: r.storeId,
    storeName: r.storeName ?? null,
    permissions: (r.permissions ?? []) as Permission[],
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function listActiveStores(): Promise<ActiveStoreOption[]> {
  return database().db
    .select({ id: stores.id, name: stores.name, slug: stores.slug })
    .from(stores)
    .where(eq(stores.active, true))
    .orderBy(stores.name);
}

export type AdminAssertionExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

export async function assertRemainingActiveAdmins(tx: AdminAssertionExecutor) {
  const result = (await tx.execute(
    sql`SELECT count(*)::int AS count FROM users WHERE active = true AND 'gestor:usuarios' = ANY(permissions);`
  )) as Array<{ count?: number | string }>;
  const count = Number(result[0]?.count ?? 0);
  if (count < 1) {
    throw new LastAdminProtectionError(
      "Não é possível concluir esta alteração porque o sistema precisa manter pelo menos um administrador ativo com acesso à Gestão de Usuários."
    );
  }
}

export type CreateUserInput = {
  name: string;
  email: string;
  role: Role;
  storeId?: string | null;
  permissions: Permission[];
  password: string;
  passwordConfirmation: string;
  actorId: string;
};

export async function createUser(
  input: CreateUserInput,
  dbClient: ReturnType<typeof database>["db"] = database().db
): Promise<ManagedUser> {
  const name = input.name.trim();
  if (name.length < 2) {
    throw new UserValidationError("O nome deve ter pelo menos 2 caracteres.");
  }
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    throw new UserValidationError("Informe um e-mail válido.");
  }
  if (input.password !== input.passwordConfirmation) {
    throw new UserValidationError("As senhas não coincidem.");
  }
  assertPassword(input.password);
  const normalizedStoreId = normalizeStoreId(input.storeId);
  assertStoreUserInvariant(input.permissions, normalizedStoreId);

  const passwordHash = await hashPassword(input.password);

  return dbClient.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USER_MANAGEMENT_ADVISORY_LOCK_ID});`);

    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (existing) {
      throw new UserValidationError("Já existe um usuário cadastrado com este e-mail.");
    }

    const [created] = await tx
      .insert(users)
      .values({
        name,
        email,
        role: input.role,
        storeId: normalizedStoreId,
        permissions: input.permissions,
        passwordHash,
        active: true,
        updatedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        storeId: users.storeId,
        permissions: users.permissions,
        active: users.active,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    await recordAudit(
      {
        actorId: input.actorId,
        action: "user_created",
        entityType: "user",
        entityId: created.id,
        metadata: {
          email: created.email,
          name: created.name,
          role: created.role,
          storeId: created.storeId,
          permissions: created.permissions,
        },
      },
      tx
    );

    let storeName: string | null = null;
    if (normalizedStoreId) {
      const [st] = await tx
        .select({ name: stores.name })
        .from(stores)
        .where(eq(stores.id, normalizedStoreId))
        .limit(1);
      storeName = st?.name ?? null;
    }

    return {
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      storeId: created.storeId,
      storeName,
      permissions: created.permissions as Permission[],
      active: created.active,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  });
}

export type UpdateUserInput = {
  id: string;
  name: string;
  email: string;
  role: Role;
  storeId?: string | null;
  permissions: Permission[];
  active: boolean;
  expectedUpdatedAt: string | Date;
  actorId: string;
};

export async function updateUser(
  input: UpdateUserInput,
  dbClient: ReturnType<typeof database>["db"] = database().db
): Promise<{
  user: ManagedUser;
  previous: {
    name: string;
    email: string;
    role: Role;
    storeId: string | null;
    permissions: Permission[];
    active: boolean;
  };
}> {
  const name = input.name.trim();
  if (name.length < 2) {
    throw new UserValidationError("O nome deve ter pelo menos 2 caracteres.");
  }
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    throw new UserValidationError("Informe um e-mail válido.");
  }
  const normalizedStoreId = normalizeStoreId(input.storeId);
  assertStoreUserInvariant(input.permissions, normalizedStoreId);

  const expectedDate = new Date(input.expectedUpdatedAt);
  if (isNaN(expectedDate.getTime())) {
    throw new UserValidationError("Timestamp de versão inválido.");
  }

  return dbClient.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USER_MANAGEMENT_ADVISORY_LOCK_ID});`);

    const [currentUser] = await tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        storeId: users.storeId,
        permissions: users.permissions,
        active: users.active,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, input.id))
      .limit(1);

    if (!currentUser) {
      throw new UserValidationError("Usuário não encontrado.");
    }

    const [existingWithEmail] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, sql`${users.id} <> ${input.id}`))
      .limit(1);

    if (existingWithEmail) {
      throw new UserValidationError("Já existe um usuário cadastrado com este e-mail.");
    }

    // Real CAS update condition on id and updated_at
    const updatedRows = await tx
      .update(users)
      .set({
        name,
        email,
        role: input.role,
        storeId: normalizedStoreId,
        permissions: input.permissions,
        active: input.active,
        updatedAt: sql`date_trunc('milliseconds', GREATEST(clock_timestamp(), ${users.updatedAt} + INTERVAL '1 millisecond'))`,
      })
      .where(
        and(
          eq(users.id, input.id),
          sql`date_trunc('milliseconds', ${users.updatedAt}) = date_trunc('milliseconds', ${expectedDate.toISOString()}::timestamptz)`
        )
      )
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        storeId: users.storeId,
        permissions: users.permissions,
        active: users.active,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    if (updatedRows.length === 0) {
      throw new UserConflictError(
        "Este usuário foi alterado por outro administrador. Os dados mais recentes foram carregados."
      );
    }

    const updated = updatedRows[0];

    if (currentUser.active && !input.active) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, input.id), isNull(sessions.revokedAt)));
    }

    await assertRemainingActiveAdmins(tx);

    const changedFields: string[] = [];
    if (currentUser.name !== updated.name) changedFields.push("name");
    if (currentUser.email !== updated.email) changedFields.push("email");
    if (currentUser.role !== updated.role) changedFields.push("role");
    if (currentUser.storeId !== updated.storeId) changedFields.push("storeId");
    if (currentUser.active !== updated.active) changedFields.push("active");
    if (JSON.stringify(currentUser.permissions) !== JSON.stringify(updated.permissions)) changedFields.push("permissions");

    await recordAudit(
      {
        actorId: input.actorId,
        action: "user_updated",
        entityType: "user",
        entityId: updated.id,
        metadata: {
          changedFields,
          previous: {
            name: currentUser.name,
            email: currentUser.email,
            role: currentUser.role,
            storeId: currentUser.storeId,
            permissions: currentUser.permissions,
            active: currentUser.active,
          },
          current: {
            name: updated.name,
            email: updated.email,
            role: updated.role,
            storeId: updated.storeId,
            permissions: updated.permissions,
            active: updated.active,
          },
        },
      },
      tx
    );

    let storeName: string | null = null;
    if (normalizedStoreId) {
      const [st] = await tx
        .select({ name: stores.name })
        .from(stores)
        .where(eq(stores.id, normalizedStoreId))
        .limit(1);
      storeName = st?.name ?? null;
    }

    return {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        storeId: updated.storeId,
        storeName,
        permissions: updated.permissions as Permission[],
        active: updated.active,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      previous: {
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role,
        storeId: currentUser.storeId,
        permissions: currentUser.permissions as Permission[],
        active: currentUser.active,
      },
    };
  });
}

export type ToggleUserActiveInput = {
  id: string;
  active: boolean;
  expectedUpdatedAt: string | Date;
  actorId: string;
};

export async function toggleUserActive(
  input: ToggleUserActiveInput,
  dbClient: ReturnType<typeof database>["db"] = database().db
): Promise<{ user: ManagedUser; previousActive: boolean }> {
  const expectedDate = new Date(input.expectedUpdatedAt);
  if (isNaN(expectedDate.getTime())) {
    throw new UserValidationError("Timestamp de versão inválido.");
  }

  return dbClient.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USER_MANAGEMENT_ADVISORY_LOCK_ID});`);

    const updatedRows = await tx
      .update(users)
      .set({
        active: input.active,
        updatedAt: sql`date_trunc('milliseconds', GREATEST(clock_timestamp(), ${users.updatedAt} + INTERVAL '1 millisecond'))`,
      })
      .where(
        and(
          eq(users.id, input.id),
          sql`date_trunc('milliseconds', ${users.updatedAt}) = date_trunc('milliseconds', ${expectedDate.toISOString()}::timestamptz)`
        )
      )
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        storeId: users.storeId,
        permissions: users.permissions,
        active: users.active,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    if (updatedRows.length === 0) {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.id)).limit(1);
      if (!existing) {
        throw new UserValidationError("Usuário não encontrado.");
      }
      throw new UserConflictError(
        "Este usuário foi alterado por outro administrador. Os dados mais recentes foram carregados."
      );
    }

    const updated = updatedRows[0];

    if (!input.active) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, input.id), isNull(sessions.revokedAt)));

      await assertRemainingActiveAdmins(tx);
    }

    await recordAudit(
      {
        actorId: input.actorId,
        action: input.active ? "user_activated" : "user_deactivated",
        entityType: "user",
        entityId: updated.id,
        metadata: {
          active: updated.active,
          sessionsRevoked: !updated.active,
        },
      },
      tx
    );

    let storeName: string | null = null;
    if (updated.storeId) {
      const [st] = await tx
        .select({ name: stores.name })
        .from(stores)
        .where(eq(stores.id, updated.storeId))
        .limit(1);
      storeName = st?.name ?? null;
    }

    return {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        storeId: updated.storeId,
        storeName,
        permissions: updated.permissions as Permission[],
        active: updated.active,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      previousActive: !input.active,
    };
  });
}

export type ResetUserPasswordInput = {
  targetUserId: string;
  newPassword: string;
  passwordConfirmation: string;
  actorId: string;
  expectedUpdatedAt?: string | Date;
};

export async function resetUserPassword(
  input: ResetUserPasswordInput,
  dbClient: ReturnType<typeof database>["db"] = database().db
): Promise<{
  targetUserId: string;
  targetEmail: string;
}> {
  if (input.newPassword !== input.passwordConfirmation) {
    throw new UserValidationError("As senhas não coincidem.");
  }
  assertPassword(input.newPassword);

  const newHash = await hashPassword(input.newPassword);

  return dbClient.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USER_MANAGEMENT_ADVISORY_LOCK_ID});`);

    let updatedRows;
    if (input.expectedUpdatedAt) {
      const expectedDate = new Date(input.expectedUpdatedAt);
      if (isNaN(expectedDate.getTime())) {
        throw new UserValidationError("Timestamp de versão inválido.");
      }
      updatedRows = await tx
        .update(users)
        .set({
          passwordHash: newHash,
          updatedAt: sql`date_trunc('milliseconds', GREATEST(clock_timestamp(), ${users.updatedAt} + INTERVAL '1 millisecond'))`,
        })
        .where(
          and(
            eq(users.id, input.targetUserId),
            sql`date_trunc('milliseconds', ${users.updatedAt}) = date_trunc('milliseconds', ${expectedDate.toISOString()}::timestamptz)`
          )
        )
        .returning({ id: users.id, email: users.email });

      if (updatedRows.length === 0) {
        const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.targetUserId)).limit(1);
        if (!existing) {
          throw new UserValidationError("Usuário não encontrado.");
        }
        throw new UserConflictError(
          "Este usuário foi alterado por outro administrador. Os dados mais recentes foram carregados."
        );
      }
    } else {
      updatedRows = await tx
        .update(users)
        .set({
          passwordHash: newHash,
          updatedAt: sql`date_trunc('milliseconds', GREATEST(clock_timestamp(), ${users.updatedAt} + INTERVAL '1 millisecond'))`,
        })
        .where(eq(users.id, input.targetUserId))
        .returning({ id: users.id, email: users.email });

      if (updatedRows.length === 0) {
        throw new UserValidationError("Usuário não encontrado.");
      }
    }

    const target = updatedRows[0];

    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, input.targetUserId), isNull(sessions.revokedAt)));

    await recordAudit(
      {
        actorId: input.actorId,
        action: "user_password_reset_by_admin",
        entityType: "user",
        entityId: target.id,
        metadata: {
          resetByAdmin: true,
          sessionsRevoked: true,
        },
      },
      tx
    );

    return { targetUserId: target.id, targetEmail: target.email };
  });
}
