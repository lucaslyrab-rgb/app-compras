import { describe, expect, it } from "vitest";
import { assertStoreAccess, AuthorizationError, canManageProducts, createSessionToken, hashPassword, hashToken, sessionExpiries, verifyPassword } from "@/modules/identity/domain";

describe("identidade", () => {
  it("gera e verifica hash de senha sem expor a senha", async () => {
    const password = "senha-segura-com-mais-de-16";
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("senha-errada-tambem-longa", hash)).resolves.toBe(false);
  });

  it("recusa senha curta e formatos inválidos", async () => {
    await expect(hashPassword("curta")).rejects.toThrow(/16 caracteres/);
    await expect(verifyPassword("qualquer", "invalido")).resolves.toBe(false);
  });

  it("gera token opaco e hash determinístico", () => {
    const session = createSessionToken();
    expect(session.token).not.toBe(session.tokenHash);
    expect(hashToken(session.token)).toBe(session.tokenHash);
  });

  it("calcula expiração ociosa e absoluta", () => {
    const now = new Date("2026-09-19T12:00:00Z");
    const expiry = sessionExpiries(now);
    expect(expiry.idleExpiresAt.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(expiry.absoluteExpiresAt.toISOString()).toBe("2026-09-26T12:00:00.000Z");
  });

  it("aplica RBAC e isolamento da loja", () => {
    const loja = { userId: "u1", role: "LOJA" as const, storeId: "s1" };
    expect(canManageProducts(loja)).toBe(false);
    expect(canManageProducts({ userId: "u2", role: "GESTOR", storeId: null })).toBe(true);
    expect(() => assertStoreAccess(loja, "s1")).not.toThrow();
    expect(() => assertStoreAccess(loja, "s2")).toThrow(AuthorizationError);
    expect(() => assertStoreAccess({ userId: "u3", role: "COMPRADOR", storeId: null }, "s2")).not.toThrow();
  });
});
