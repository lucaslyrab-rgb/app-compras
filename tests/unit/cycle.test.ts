import { describe, expect, it } from "vitest";
import { purchaseCycle } from "@/modules/ordering/repository";

describe("ciclo de compra", () => {
  it("atribui pedido antes das 19h à madrugada seguinte", () => {
    const result = purchaseCycle(new Date("2026-09-21T19:30:00.000Z"));
    expect(result.cycleDate).toBe("2026-09-22");
    expect(result.afterCutoff).toBe(false);
  });

  it("atribui pedido após 19h ao ciclo seguinte", () => {
    const result = purchaseCycle(new Date("2026-09-21T23:15:00.000Z"));
    expect(result.cycleDate).toBe("2026-09-23");
    expect(result.afterCutoff).toBe(true);
  });
});
