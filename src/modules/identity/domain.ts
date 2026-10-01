import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

function scrypt(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, length, { ...options, maxmem: 64 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived)));
}
export const PERMISSIONS = [
  "pedidos:criar",
  "pedidos:historico",
  "compras:consolidado",
  "compras:custos",
  "gestor:produtos",
  "gestor:precificacao",
  "gestor:configuracoes",
  "gestor:usuarios",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const STORE_PERMISSIONS: readonly Permission[] = [
  "pedidos:criar",
  "pedidos:historico",
] as const;

export const roles = ["LOJA", "COMPRADOR", "GESTOR"] as const;
export type Role = (typeof roles)[number];

export type Principal = {
  userId: string;
  role: Role;
  storeId: string | null;
  permissions: Permission[];
};

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return (principal.permissions ?? []).includes(permission);
}

export function hasAnyPermission(principal: Principal, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => hasPermission(principal, permission));
}

export function hasAllPermissions(principal: Principal, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => hasPermission(principal, permission));
}

export function assertPermission(principal: Principal, permission: Permission, message = "Acesso negado") {
  if (!hasPermission(principal, permission)) {
    throw new AuthorizationError(message);
  }
}

export function canManageProducts(principal: Principal) {
  return hasPermission(principal, "gestor:produtos");
}

export function canManagePricing(principal: Principal) {
  return hasPermission(principal, "gestor:precificacao");
}

export function canManageSettings(principal: Principal) {
  return hasPermission(principal, "gestor:configuracoes");
}

export function canManageUsers(principal: Principal) {
  return hasPermission(principal, "gestor:usuarios");
}

export function canManageGestor(principal: Principal) {
  return hasAnyPermission(principal, [
    "gestor:produtos",
    "gestor:precificacao",
    "gestor:configuracoes",
    "gestor:usuarios",
  ]);
}

export const ROLE_DEFAULT_PERMISSIONS: Record<Role, readonly Permission[]> = {
  LOJA: ["pedidos:criar", "pedidos:historico"],
  COMPRADOR: ["compras:consolidado", "compras:custos"],
  GESTOR: [
    "compras:consolidado",
    "compras:custos",
    "gestor:produtos",
    "gestor:precificacao",
    "gestor:configuracoes",
    "gestor:usuarios",
  ],
};

export const PERMISSION_GROUPS = [
  {
    group: "Loja",
    permissions: [
      { id: "pedidos:criar", label: "Fazer pedidos" },
      { id: "pedidos:historico", label: "Histórico da loja" },
    ],
  },
  {
    group: "Comprador",
    permissions: [
      { id: "compras:consolidado", label: "Consolidado" },
      { id: "compras:custos", label: "Lançamento de custos" },
    ],
  },
  {
    group: "Gestor",
    permissions: [
      { id: "gestor:produtos", label: "Produtos" },
      { id: "gestor:precificacao", label: "Precificação" },
      { id: "gestor:configuracoes", label: "Configurações" },
      { id: "gestor:usuarios", label: "Usuários" },
    ],
  },
] as const;

export function resolveOperationalRoute(principal: Principal): string | null {
  if (hasPermission(principal, "pedidos:criar") && Boolean(principal.storeId)) {
    return "/";
  }
  if (hasPermission(principal, "gestor:produtos")) return "/gestor/produtos";
  if (hasPermission(principal, "compras:consolidado")) return "/comprador/consolidado";
  if (hasPermission(principal, "compras:custos")) return "/comprador/custos";
  if (hasPermission(principal, "gestor:precificacao")) return "/gestor/precificacao";
  if (hasPermission(principal, "gestor:configuracoes")) return "/gestor/configuracoes";
  if (hasPermission(principal, "gestor:usuarios")) return "/gestor/usuarios";
  if (hasPermission(principal, "pedidos:historico") && Boolean(principal.storeId)) {
    return "/historico";
  }
  return null;
}

export function hasOperationalRoute(principal: Principal): boolean {
  return resolveOperationalRoute(principal) !== null;
}

export function assertStoreAccess(principal: Principal, requestedStoreId: string) {
  if (hasAnyPermission(principal, ["pedidos:criar", "pedidos:historico"])) {
    if (!principal.storeId || principal.storeId !== requestedStoreId) {
      throw new AuthorizationError("Acesso negado");
    }
  } else {
    throw new AuthorizationError("Acesso negado");
  }
}

export class AuthorizationError extends Error {
  override name = "AuthorizationError";
}

export class UserValidationError extends Error {
  override name = "UserValidationError";
}

export class LastAdminProtectionError extends Error {
  override name = "LastAdminProtectionError";
}

export class UserConflictError extends Error {
  override name = "UserConflictError";
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function normalizeStoreId(storeId: string | null | undefined): string | null {
  if (typeof storeId !== "string") {
    return null;
  }
  const trimmed = storeId.trim();
  return trimmed === "" ? null : trimmed;
}

export function validateStoreUserInvariant(
  permissions: readonly Permission[],
  storeId: string | null | undefined
): { valid: boolean; reason?: string } {
  const hasStorePerm = permissions.some((p) => STORE_PERMISSIONS.includes(p));
  const normalizedStoreId = normalizeStoreId(storeId);

  if (hasStorePerm) {
    if (!normalizedStoreId) {
      return {
        valid: false,
        reason: "Usuário com permissão de Loja (pedidos:criar ou pedidos:historico) deve possuir uma loja vinculada.",
      };
    }
    if (!isValidUuid(normalizedStoreId)) {
      return {
        valid: false,
        reason: "Identificador de loja inválido: deve ser um UUID válido.",
      };
    }
    return { valid: true };
  }

  if (normalizedStoreId !== null) {
    return {
      valid: false,
      reason: "Usuário sem permissão de Loja não pode possuir loja vinculada.",
    };
  }

  return { valid: true };
}

export function assertStoreUserInvariant(
  permissions: readonly Permission[],
  storeId: string | null | undefined
): void {
  const result = validateStoreUserInvariant(permissions, storeId);
  if (!result.valid) {
    throw new UserValidationError(result.reason);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export const PASSWORD_POLICY_MESSAGE =
  "A senha deve ter pelo menos 8 caracteres e conter pelo menos uma letra e um número.";

export function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== "string" || password.length < 8) {
    return { valid: false, reason: PASSWORD_POLICY_MESSAGE };
  }
  const hasLetter = /[a-zA-Z]/.test(password) || /\p{L}/u.test(password);
  const hasNumber = /[0-9]/.test(password);
  if (!hasLetter || !hasNumber) {
    return { valid: false, reason: PASSWORD_POLICY_MESSAGE };
  }
  return { valid: true };
}

export function assertPassword(password: string): void {
  const result = validatePassword(password);
  if (!result.valid) {
    throw new UserValidationError(result.reason ?? PASSWORD_POLICY_MESSAGE);
  }
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string
): { valid: boolean; reason?: string } {
  if (password !== confirmation) {
    return { valid: false, reason: "As senhas não coincidem." };
  }
  return { valid: true };
}

export async function hashPassword(password: string) {
  assertPassword(password);
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
