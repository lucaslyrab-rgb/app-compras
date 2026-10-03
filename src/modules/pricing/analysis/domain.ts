import type { PricingProduct, PricingSettings } from "../parameters/domain";
import { calculatePricing, compare, decimal, grossUnitCost, type PricingCalculation } from "../financial";

export class PricingReviewError extends Error {
  override name = "PricingReviewError";
}

export type PricingStatus = "NO_COST" | "CONFIG_ERROR" | "NOT_REVIEWED" | "COST_CHANGED" | "PARAMETERS_CHANGED" | "REVIEWED";
export type PricingFilter = "all" | "cost-changed" | "stale-purchase" | "not-reviewed" | "reviewed";

export type OfficialCost = {
  id: string;
  cost: string;
  costIsUnit: boolean;
  version: number;
  cycleDate: string;
  purchasedAt: string;
  revisedAfterPurchase: boolean;
};

export type PreviousOfficialCost = OfficialCost & {
  basisRecorded: boolean;
  conversionRecorded: boolean;
};

export type DecisionOrigin = "SUGGESTED" | "MANUAL";

export type LatestReview = {
  id: string;
  inputFingerprint: string;
  officialCostId: string;
  officialCostVersion: number;
  officialPurchaseCycleDate: string;
  officialCost: string;
  costIsUnit: boolean;
  saleUnit: string;
  conversionQuantity: string;
  beneficiationLossPercent: string;
  operatingCostPercent: string;
  desiredMarginPercent: string;
  effectiveUnitCost: string;
  calculatedPrice: string;
  suggestedPrice: string;
  appliedPrice: string | null;
  decidedPrice: string | null;
  decisionOrigin: DecisionOrigin | null;
  reviewedAt: string;
} | null;

export type PricingAnalysisSource = Pick<PricingProduct,
  "id" | "erpCode" | "name" | "photoKey" | "photoUpdatedAt" | "purchaseFormat" | "saleUnit" | "conversionQuantity" |
  "conversionOrigin" | "beneficiationLossPercent" | "specificMarginPercent" | "version" | "updatedAt"
> & {
  settings: PricingSettings;
  officialCost: OfficialCost | null;
  officialCostHistory: PreviousOfficialCost[];
  latestReview: LatestReview;
  referenceCycleDate: string | null;
};

export type PricingAnalysis = PricingAnalysisSource & {
  desiredMarginPercent: string;
  marginOrigin: "DEFAULT" | "SPECIFIC";
  calculation: PricingCalculation | null;
  calculationError: string | null;
  fingerprint: string | null;
  stalePurchase: boolean;
  costChanged: boolean;
  parametersChanged: boolean;
  reviewPending: boolean;
  status: PricingStatus;
};

export type PricingReviewDecision = {
  id: string;
  productId: string;
  erpCode: number;
  productName: string;
  saleUnit: string;
  effectiveUnitCost: string;
  calculatedPrice: string;
  suggestedPrice: string;
  decidedPrice: string | null;
  decisionOrigin: DecisionOrigin | null;
  reviewedAt: string;
};

export type PricingPrintRow = {
  reviewId: string;
  productId: string;
  erpCode: number;
  productName: string;
  saleUnit: string;
  effectiveUnitCost: string;
  calculatedPrice: string;
  suggestedPrice: string;
  decidedPrice: string;
  decisionOrigin: DecisionOrigin;
};

export function pricingFingerprint(input: {
  officialCost: OfficialCost;
  saleUnit: string;
  conversionQuantity: string;
  beneficiationLossPercent: string;
  operatingCostPercent: string;
  desiredMarginPercent: string;
}) {
  return [
    input.officialCost.id,
    input.officialCost.version,
    input.officialCost.cost,
    input.officialCost.costIsUnit ? "1" : "0",
    input.saleUnit,
    input.conversionQuantity,
    input.beneficiationLossPercent,
    input.operatingCostPercent,
    input.desiredMarginPercent,
  ].join("|");
}

function sameDecimal(left: string, right: string) {
  return compare(decimal(left), decimal(right)) === 0;
}

function reviewParametersChanged(
  source: PricingAnalysisSource,
  desiredMarginPercent: string,
) {
  const review = source.latestReview;
  return Boolean(review && (
    review.saleUnit !== source.saleUnit ||
    review.costIsUnit !== source.officialCost?.costIsUnit ||
    !sameDecimal(review.conversionQuantity, source.conversionQuantity) ||
    !sameDecimal(review.beneficiationLossPercent, source.beneficiationLossPercent) ||
    !sameDecimal(review.operatingCostPercent, source.settings.operatingCostPercent) ||
    !sameDecimal(review.desiredMarginPercent, desiredMarginPercent)
  ));
}

type ComparableCost = PreviousOfficialCost & { coveredByReview?: boolean };

function reviewCost(source: PricingAnalysisSource): ComparableCost {
  const review = source.latestReview!;
  return {
    id: review.officialCostId,
    cost: review.officialCost,
    costIsUnit: review.costIsUnit,
    version: review.officialCostVersion,
    cycleDate: review.officialPurchaseCycleDate,
    purchasedAt: review.reviewedAt,
    revisedAfterPurchase: false,
    basisRecorded: true,
    conversionRecorded: true,
    coveredByReview: true,
  };
}

function relevantCostWindow(source: PricingAnalysisSource) {
  const history = source.officialCostHistory;
  const review = source.latestReview;
  if (!review) return {
    costs: history as ComparableCost[],
    unsafeCorrection: history.some((cost) => cost.revisedAfterPurchase),
  };

  const anchor = reviewCost(source);
  const reviewedIndex = history.findIndex((cost) => cost.id === review.officialCostId);
  if (reviewedIndex < 0) {
    const later = history.filter((cost) => cost.cycleDate > review.officialPurchaseCycleDate);
    return {
      costs: [anchor, ...later],
      unsafeCorrection: later.some((cost) => cost.revisedAfterPurchase),
    };
  }

  const reviewedRow = history[reviewedIndex];
  if (reviewedRow.version === review.officialCostVersion) {
    const later = history.slice(reviewedIndex + 1);
    return {
      costs: [anchor, ...later],
      unsafeCorrection: later.some((cost) => cost.revisedAfterPurchase),
    };
  }

  const afterAnchor = history.slice(reviewedIndex);
  const firstCorrectionReconstructible = reviewedRow.revisedAfterPurchase &&
    reviewedRow.version === review.officialCostVersion + 1;
  return {
    costs: [anchor, ...afterAnchor],
    unsafeCorrection: !firstCorrectionReconstructible ||
      afterAnchor.slice(1).some((cost) => cost.revisedAfterPurchase),
  };
}

function compareCostTransition(
  source: PricingAnalysisSource,
  previous: ComparableCost,
  current: ComparableCost,
) {
  if (current.costIsUnit === previous.costIsUnit)
    return sameDecimal(current.cost, previous.cost) ? "EQUAL" : "CHANGED";

  if (!previous.basisRecorded) return "UNSAFE";
  const reviewProvesStableConversion = Boolean(
    previous.coveredByReview &&
    source.latestReview &&
    source.latestReview.saleUnit === source.saleUnit &&
    sameDecimal(source.latestReview.conversionQuantity, source.conversionQuantity),
  );
  if (!previous.conversionRecorded && !reviewProvesStableConversion)
    return "UNSAFE";

  const currentNormalized = grossUnitCost(
    current.cost,
    source.conversionQuantity,
    current.costIsUnit,
  );
  const previousNormalized = grossUnitCost(
    previous.cost,
    source.conversionQuantity,
    previous.costIsUnit,
  );
  return compare(currentNormalized, previousNormalized) === 0 ? "EQUAL" : "CHANGED";
}

export function hasReferenceCycleCostChange(source: PricingAnalysisSource) {
  const current = source.officialCost;
  if (!current || !source.referenceCycleDate || current.cycleDate !== source.referenceCycleDate)
    return false;

  let currentIndex = -1;
  for (let index = source.officialCostHistory.length - 1; index >= 0; index -= 1) {
    const candidate = source.officialCostHistory[index];
    if (candidate.id === current.id && candidate.version === current.version) {
      currentIndex = index;
      break;
    }
  }
  if (currentIndex <= 0) return false;

  const previous = source.officialCostHistory[currentIndex - 1];
  const currentWithMetadata = source.officialCostHistory[currentIndex];
  if (previous.revisedAfterPurchase || currentWithMetadata.revisedAfterPurchase)
    return false;

  return compareCostTransition(source, previous, currentWithMetadata) === "CHANGED";
}

function reviewCoversCurrentOfficialCost(analysis: PricingAnalysis) {
  const review = analysis.latestReview;
  const cost = analysis.officialCost;
  return Boolean(
    review && cost &&
    review.officialCostId === cost.id &&
    review.officialCostVersion === cost.version &&
    review.officialPurchaseCycleDate === cost.cycleDate
  );
}

export function buildPricingAnalysis(source: PricingAnalysisSource): PricingAnalysis {
  const desiredMarginPercent = source.specificMarginPercent ?? source.settings.defaultMarginPercent;
  const marginOrigin = source.specificMarginPercent === null ? "DEFAULT" : "SPECIFIC";
  const stalePurchase = Boolean(
    source.officialCost &&
    source.referenceCycleDate &&
    source.officialCost.cycleDate < source.referenceCycleDate
  );
  if (!source.officialCost) return {
    ...source,
    desiredMarginPercent,
    marginOrigin,
    calculation: null,
    calculationError: null,
    fingerprint: null,
    stalePurchase,
    costChanged: false,
    parametersChanged: false,
    reviewPending: false,
    status: "NO_COST",
  };
  let calculation: PricingCalculation;
  try {
    calculation = calculatePricing({
      officialCost: source.officialCost.cost,
      costIsUnit: source.officialCost.costIsUnit,
      conversionQuantity: source.conversionQuantity,
      lossPercent: source.beneficiationLossPercent,
      operatingCostPercent: source.settings.operatingCostPercent,
      desiredMarginPercent,
    });
  } catch (error) {
    return {
      ...source,
      desiredMarginPercent,
      marginOrigin,
      calculation: null,
      calculationError: error instanceof Error ? error.message : "Configuração inválida.",
      fingerprint: null,
      stalePurchase,
      costChanged: false,
      parametersChanged: false,
      reviewPending: true,
      status: "CONFIG_ERROR",
    };
  }
  const fingerprint = pricingFingerprint({
    officialCost: source.officialCost,
    saleUnit: source.saleUnit,
    conversionQuantity: source.conversionQuantity,
    beneficiationLossPercent: source.beneficiationLossPercent,
    operatingCostPercent: source.settings.operatingCostPercent,
    desiredMarginPercent,
  });
  const parameterInputsChanged = reviewParametersChanged(source, desiredMarginPercent);
  const window = relevantCostWindow(source);

  let unsafeTransition = window.unsafeCorrection;
  let hasCostChange = false;

  if (!source.latestReview && window.costs.length <= 1) {
    hasCostChange = true;
  } else {
    for (let index = 1; index < window.costs.length; index += 1) {
      const prev = window.costs[index - 1];
      const curr = window.costs[index];
      const result = compareCostTransition(source, prev, curr);
      if (result === "UNSAFE") {
        unsafeTransition = true;
        if (!sameDecimal(prev.cost, curr.cost)) {
          hasCostChange = true;
        }
      } else if (result === "CHANGED") {
        hasCostChange = true;
      }
    }
  }

  const parametersChanged = parameterInputsChanged || unsafeTransition || Boolean(
    source.officialCost.revisedAfterPurchase && !source.latestReview,
  );
  const costChanged = hasCostChange;
  const hasDecision = Boolean(
    (source.latestReview?.decidedPrice && source.latestReview.decidedPrice.trim()) ||
    (source.latestReview?.appliedPrice && source.latestReview.appliedPrice.trim())
  );
  const reviewPending = !source.latestReview || !hasDecision || parametersChanged || costChanged;

  let status: PricingStatus;
  if (!reviewPending) {
    status = "REVIEWED";
  } else if (parametersChanged) {
    status = "PARAMETERS_CHANGED";
  } else if (costChanged) {
    status = "COST_CHANGED";
  } else {
    status = "NOT_REVIEWED";
  }

  return {
    ...source,
    desiredMarginPercent,
    marginOrigin,
    calculation,
    calculationError: null,
    fingerprint,
    stalePurchase,
    costChanged,
    parametersChanged,
    reviewPending,
    status,
  };
}

export function filterPricingAnalyses(analyses: PricingAnalysis[], query: string, filter: PricingFilter) {
  const term = query.trim().toLocaleLowerCase("pt-BR");
  return analyses.filter((analysis) =>
    (!term || analysis.name.toLocaleLowerCase("pt-BR").includes(term) ||
      String(analysis.erpCode).includes(term) ||
      analysis.purchaseFormat.toLocaleLowerCase("pt-BR").includes(term)) &&
    (filter === "all" ||
      (filter === "cost-changed" && analysis.reviewPending && analysis.costChanged) ||
      (filter === "stale-purchase" && analysis.stalePurchase) ||
      (filter === "not-reviewed" && analysis.reviewPending) ||
      (filter === "reviewed" && !analysis.reviewPending && analysis.status === "REVIEWED")));
}

export function pricingMetrics(analyses: PricingAnalysis[]) {
  return {
    total: analyses.length,
    costChanged: analyses.filter((analysis) => analysis.reviewPending && analysis.costChanged).length,
    stalePurchase: analyses.filter((analysis) => analysis.stalePurchase).length,
    reviewed: analyses.filter((analysis) => analysis.status === "REVIEWED").length,
  };
}

export function printablePricingAnalyses(analyses: PricingAnalysis[]) {
  return analyses.filter((analysis) =>
    analysis.status === "REVIEWED" &&
    hasReferenceCycleCostChange(analysis) &&
    reviewCoversCurrentOfficialCost(analysis) &&
    Boolean(analysis.latestReview?.decidedPrice || analysis.latestReview?.appliedPrice)
  );
}

export function pricingPrintRows(analyses: PricingAnalysis[], reviewIds: string[] = []): PricingPrintRow[] {
  const selectedReviews = reviewIds.length ? new Set(reviewIds) : null;
  return analyses.flatMap((analysis) => {
    if (
      analysis.status !== "REVIEWED" ||
      !analysis.latestReview ||
      !hasReferenceCycleCostChange(analysis) ||
      !reviewCoversCurrentOfficialCost(analysis)
    ) return [];
    const review = analysis.latestReview;
    const decidedPrice = review.decidedPrice ?? review.appliedPrice;
    if (!decidedPrice || (selectedReviews && !selectedReviews.has(review.id))) return [];
    const decisionOrigin = review.decisionOrigin ?? (
      compare(decimal(decidedPrice), decimal(review.suggestedPrice)) === 0 ? "SUGGESTED" : "MANUAL"
    );
    return [{
      reviewId: review.id,
      productId: analysis.id,
      erpCode: analysis.erpCode,
      productName: analysis.name,
      saleUnit: review.saleUnit,
      effectiveUnitCost: review.effectiveUnitCost,
      calculatedPrice: review.calculatedPrice,
      suggestedPrice: review.suggestedPrice,
      decidedPrice,
      decisionOrigin,
    }];
  });
}

export function pricingStalePurchaseMessage(analysis: PricingAnalysis) {
  if (!analysis.stalePurchase || !analysis.referenceCycleDate || !analysis.officialCost) return null;
  const cycleLabel = (value: string) => value.split("-").reverse().join("/");
  return `Sem compra no ciclo ${cycleLabel(analysis.referenceCycleDate)} — usando custo oficial do ciclo ${cycleLabel(analysis.officialCost.cycleDate)}.`;
}

export function formatPricingCurrency(value: string | null) {
  if (!value) return "—";
  const [whole, fraction = ""] = value.split(".");
  return `R$ ${BigInt(whole).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

export function formatPricingNumber(value: string, digits = 2) {
  const [whole, fraction = ""] = value.split(".");
  return `${BigInt(whole)},${fraction.padEnd(digits, "0").slice(0, digits)}`;
}
