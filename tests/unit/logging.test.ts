import { describe, expect, it } from "vitest";
import { redact } from "@/shared/logging";

describe("redação de logs", () => {
  it("remove segredos em objetos e listas aninhados", () => {
    expect(redact({ email: "a@b", password: "x", child: { token: "y" }, list: [{ cookie: "z" }] })).toEqual({
      email: "a@b", password: "[REDACTED]", child: { token: "[REDACTED]" }, list: [{ cookie: "[REDACTED]" }]
    });
  });
});
