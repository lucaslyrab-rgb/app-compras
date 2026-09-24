import type { Principal } from "@/modules/identity";
import { purchaseCycle } from "@/modules/ordering/repository";
import { buildPricingAnalysis } from "./domain";
import { persistPricingReview, readPricingAnalysisSources } from "./repository";

export async function loadPricingAnalyses(principal: Principal) {
  const currentCycleDate = purchaseCycle().cycleDate;
  return (await readPricingAnalysisSources(principal, currentCycleDate)).map(buildPricingAnalysis);
}

export async function loadPricingAnalysis(principal: Principal, productId: string) {
  return (await loadPricingAnalyses(principal)).find((analysis) => analysis.id === productId) ?? null;
}

export async function reviewPricingProduct(
  principal: Principal,
  input: { productId: string; expectedFingerprint: string },
) {
  return persistPricingReview(principal, {
    ...input,
    currentCycleDate: purchaseCycle().cycleDate,
  });
}
