import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "@/modules/identity/rate-limit";

describe("limite de login", () => {
  it("bloqueia após o limite e reinicia na janela seguinte", () => {
    const limiter = new LoginRateLimiter(2, 1000);
    expect(limiter.consume("User", 0).allowed).toBe(true);
    expect(limiter.consume("user", 1).allowed).toBe(true);
    expect(limiter.consume("user", 2).allowed).toBe(false);
    expect(limiter.consume("user", 1000).allowed).toBe(true);
  });

  it("limpa tentativas após sucesso", () => {
    const limiter = new LoginRateLimiter(1, 1000);
    limiter.consume("user", 0);
    limiter.clear("USER");
    expect(limiter.consume("user", 1).allowed).toBe(true);
  });
});
