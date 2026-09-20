import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

function scrypt(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, length, { ...options, maxmem: 64 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived)));
}
export const roles = ["LOJA", "COMPRADOR", "GESTOR"] as const;
export type Role = (typeof roles)[number];
export type Principal = { userId: string; role: Role; storeId: string | null };

export function canManageProducts(principal: Principal) {
  return principal.role === "GESTOR";
}

export function assertStoreAccess(principal: Principal, requestedStoreId: string) {
  if (principal.role === "LOJA" && principal.storeId !== requestedStoreId) {
    throw new AuthorizationError("Acesso negado");
  }
}

export class AuthorizationError extends Error {
  override name = "AuthorizationError";
}

export async function hashPassword(password: string) {
  if (password.length < 16) throw new Error("A senha deve ter pelo menos 16 caracteres");
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1 });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p)
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiries(now = new Date()) {
  return {
    idleExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
    absoluteExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  };
}
