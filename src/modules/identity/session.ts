import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findPrincipal } from "./repository";

export const SESSION_COOKIE = "multishow_session";

export async function currentPrincipal() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findPrincipal(token);
}

export async function requirePrincipal() {
  const principal = await currentPrincipal();
  if (!principal) redirect("/login");
  return principal;
}

export async function requireManagerPrincipal() {
  const principal = await requirePrincipal();
  if (principal.role !== "GESTOR") redirect("/");
  return principal;
}
