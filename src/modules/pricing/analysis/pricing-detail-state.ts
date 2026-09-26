import type { PricingCalculation } from "../financial";
import type { LatestReview, PricingStatus } from "./domain";

type PricingDetailStateSource = {
  status: PricingStatus;
  calculation: Pick<PricingCalculation, "suggestedPrice"> | null;
  latestReview: LatestReview;
};

export function initialAppliedPriceValue(analysis: PricingDetailStateSource) {
  const value = analysis.status === "REVIEWED" && analysis.latestReview?.appliedPrice
    ? analysis.latestReview.appliedPrice
    : analysis.calculation?.suggestedPrice ?? "";
  return value.replace(".", ",");
}
