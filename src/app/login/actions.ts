"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate, revokeSession } from "@/modules/identity/repository";
import { SESSION_COOKIE } from "@/modules/identity/session";
import { LoginRateLimiter } from "@/modules/identity/rate-limit";
import { log } from "@/shared/logging";
import { recordAudit } from "@/modules/identity/audit";

const limiter = new LoginRateLimiter();

export async function loginAction(_state: { error: string | undefined }, form: FormData): Promise<{ error: string | undefined }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${ip}:${email}`;
  if (!limiter.consume(key).allowed) return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  try {
    const session = await authenticate(email, password);
    if (!session) {
      log("warn", "Falha de autenticação", { emailHash: email.length, ip });
      await recordAudit({ action: "LOGIN_FAILED", entityType: "session", metadata: { emailLength: email.length } });
      return { error: "E-mail ou senha inválidos." };
    }
    limiter.clear(key);
    (await cookies()).set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.absoluteExpiresAt
    });
  } catch (error) {
    log("error", "Falha interna no login", { error: error instanceof Error ? error.message : "unknown" });
    return { error: "Não foi possível entrar agora. Tente novamente." };
  }
  redirect("/");
}

export async function logoutAction() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
