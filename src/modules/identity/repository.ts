import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { database } from "@/db/client";
import { sessions, stores, users } from "@/db/schema";
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

export async function revokeAllUserSessions(userId: string) {
  await database().db
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

export type TransactionClient = Parameters<Parameters<ReturnType<typeof database>["db"]["transaction"]>[0]>[0];

export async function assertRemainingActiveAdmins(tx: TransactionClient) {
  const result = await tx.execute(
    sql`SELECT count(*)::int AS count FROM users WHERE active = true AND 'gestor:usuarios' = ANY(permissions);`
  );
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
};

export async function createUser(input: CreateUserInput): Promise<ManagedUser> {
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

  return database().db.transaction(async (tx) => {
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
};

export async function updateUser(input: UpdateUserInput): Promise<{
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

  return database().db.transaction(async (tx) => {
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

    if (currentUser.updatedAt.getTime() !== expectedDate.getTime()) {
      throw new UserConflictError(
        "Este usuário foi alterado por outro administrador. Os dados mais recentes foram carregados."
      );
    }

    const [existingWithEmail] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, sql`${users.id} <> ${input.id}`))
      .limit(1);

    if (existingWithEmail) {
      throw new UserValidationError("Já existe um usuário cadastrado com este e-mail.");
    }

    const [updated] = await tx
      .update(users)
      .set({
        name,
        email,
        role: input.role,
        storeId: normalizedStoreId,
        permissions: input.permissions,
        active: input.active,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.id))
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

    if (currentUser.active && !input.active) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, input.id), isNull(sessions.revokedAt)));
    }

    await assertRemainingActiveAdmins(tx);

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

export async function toggleUserActive(input: {
  id: string;
  active: boolean;
  expectedUpdatedAt: string | Date;
}): Promise<{ user: ManagedUser; previousActive: boolean }> {
  const expectedDate = new Date(input.expectedUpdatedAt);
  if (isNaN(expectedDate.getTime())) {
    throw new UserValidationError("Timestamp de versão inválido.");
  }

  return database().db.transaction(async (tx) => {
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

    if (currentUser.updatedAt.getTime() !== expectedDate.getTime()) {
      throw new UserConflictError(
        "Este usuário foi alterado por outro administrador. Os dados mais recentes foram carregados."
      );
    }

    const [updated] = await tx
      .update(users)
      .set({
        active: input.active,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.id))
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

    if (currentUser.active && !input.active) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, input.id), isNull(sessions.revokedAt)));
    }

    await assertRemainingActiveAdmins(tx);

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
      previousActive: currentUser.active,
    };
  });
}

export type ResetUserPasswordInput = {
  targetUserId: string;
  newPassword: string;
  passwordConfirmation: string;
};

export async function resetUserPassword(input: ResetUserPasswordInput): Promise<{
  targetUserId: string;
  targetEmail: string;
}> {
  if (input.newPassword !== input.passwordConfirmation) {
    throw new UserValidationError("As senhas não coincidem.");
  }
  assertPassword(input.newPassword);

  const newHash = await hashPassword(input.newPassword);

  return database().db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${USER_MANAGEMENT_ADVISORY_LOCK_ID});`);

    const [target] = await tx
      .select({ id: users.id, email: users.email, active: users.active })
      .from(users)
      .where(eq(users.id, input.targetUserId))
      .limit(1);

    if (!target) {
      throw new UserValidationError("Usuário não encontrado.");
    }

    await tx
      .update(users)
      .set({
        passwordHash: newHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.targetUserId));

    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, input.targetUserId), isNull(sessions.revokedAt)));

    return { targetUserId: target.id, targetEmail: target.email };
  });
}
