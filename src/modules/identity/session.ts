import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasAnyPermission, hasPermission, type Permission, type Principal } from "./domain";
import { findPrincipal } from "./repository";

export const SESSION_COOKIE = "multishow_session";

export async function currentPrincipal(): Promise<Principal | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findPrincipal(token);
}

export async function requirePrincipal(): Promise<Principal> {
  const principal = await currentPrincipal();
  if (!principal) redirect("/login");
  return principal;
}

export async function requirePermission(permission: Permission): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!hasPermission(principal, permission)) redirect("/");
  return principal;
}

export async function requireAnyPermission(permissions: readonly Permission[]): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!hasAnyPermission(principal, permissions)) redirect("/");
  return principal;
}

export async function requireManagerPrincipal(): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!hasAnyPermission(principal, ["gestor:produtos", "gestor:precificacao", "gestor:configuracoes", "gestor:usuarios"])) {
    redirect("/");
  }
  return principal;
}
