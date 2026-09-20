import { and, eq, gt, isNull } from "drizzle-orm";
import { database } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { createSessionToken, hashToken, sessionExpiries, verifyPassword, type Principal } from "./domain";

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
  const [row] = await database().db.select({ userId: users.id, role: users.role, storeId: users.storeId, sessionId: sessions.id })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.idleExpiresAt, now), gt(sessions.absoluteExpiresAt, now), eq(users.active, true)))
    .limit(1);
  if (!row) return null;
  const idleExpiresAt = sessionExpiries(now).idleExpiresAt;
  await database().db.update(sessions).set({ lastSeenAt: now, idleExpiresAt }).where(eq(sessions.id, row.sessionId));
  return { userId: row.userId, role: row.role, storeId: row.storeId };
}

export async function revokeSession(token: string) {
  await database().db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}
