import { describe, expect, it } from "vitest";
import { initialAppliedPriceValue } from "@/modules/pricing/analysis/pricing-detail-state";
import type { LatestReview, PricingStatus } from "@/modules/pricing/analysis/domain";

function state(input: {
  status: PricingStatus;
  suggestedPrice: string;
  appliedPrice?: string | null;
}) {
  return {
    status: input.status,
    calculation: { suggestedPrice: input.suggestedPrice },
    latestReview: input.appliedPrice === undefined ? null : {
      appliedPrice: input.appliedPrice,
    } as LatestReview,
  };
}

describe("estado inicial do preço aplicado", () => {
  it("restaura o preço manual confirmado após remount", () => {
    expect(initialAppliedPriceValue(state({
      status: "REVIEWED",
      suggestedPrice: "6.99",
      appliedPrice: "6.49",
    }))).toBe("6,49");
  });

  it("restaura o sugerido quando ele foi o preço efetivamente aplicado", () => {
    expect(initialAppliedPriceValue(state({
      status: "REVIEWED",
      suggestedPrice: "6.99",
      appliedPrice: "6.99",
    }))).toBe("6,99");
  });

  it("inicia uma pendência com a sugestão atual, sem reutilizar revisão anterior", () => {
    expect(initialAppliedPriceValue(state({
      status: "COST_CHANGED",
      suggestedPrice: "7.99",
      appliedPrice: "6.49",
    }))).toBe("7,99");
  });

  it("calcula o valor inicial independentemente para cada produto", () => {
    const reviewed = state({ status: "REVIEWED", suggestedPrice: "6.99", appliedPrice: "6.49" });
    const pending = state({ status: "NOT_REVIEWED", suggestedPrice: "4.99" });
    expect([initialAppliedPriceValue(reviewed), initialAppliedPriceValue(pending)]).toEqual(["6,49", "4,99"]);
  });
});
