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

export type LatestReview = {
  id: string;
  inputFingerprint: string;
  officialCostId: string;
  officialCostVersion: number;
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
  reviewedAt: string;
} | null;

export type PricingAnalysisSource = PricingProduct & {
  settings: PricingSettings;
  officialCost: OfficialCost | null;
  previousOfficialCost: PreviousOfficialCost | null;
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
    review.costIsUnit !== source.officialCost?.costIsUnit ||
    review.saleUnit !== source.saleUnit ||
    !sameDecimal(review.conversionQuantity, source.conversionQuantity) ||
    !sameDecimal(review.beneficiationLossPercent, source.beneficiationLossPercent) ||
    !sameDecimal(review.operatingCostPercent, source.settings.operatingCostPercent) ||
    !sameDecimal(review.desiredMarginPercent, desiredMarginPercent)
  ));
}

function costChangeSinceReview(source: PricingAnalysisSource) {
  const current = source.officialCost!;
  const review = source.latestReview;
  if (!review) return null;
  if (current.costIsUnit === review.costIsUnit)
    return !sameDecimal(current.cost, review.officialCost);
  const currentNormalized = grossUnitCost(
    current.cost,
    source.conversionQuantity,
    current.costIsUnit,
  );
  const reviewedNormalized = grossUnitCost(
    review.officialCost,
    review.conversionQuantity,
    review.costIsUnit,
  );
  return compare(currentNormalized, reviewedNormalized) !== 0;
}

function costChangeWithoutReview(source: PricingAnalysisSource) {
  const current = source.officialCost!;

  const previous = source.previousOfficialCost;
  if (!previous) return { costChanged: true, basisUncertain: false };

  if (current.costIsUnit === previous.costIsUnit)
    return { costChanged: !sameDecimal(current.cost, previous.cost), basisUncertain: false };

  if (!previous.basisRecorded)
    return { costChanged: !sameDecimal(current.cost, previous.cost), basisUncertain: true };
  if (!previous.conversionRecorded)
    return { costChanged: !sameDecimal(current.cost, previous.cost), basisUncertain: true };

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
  return {
    costChanged: compare(currentNormalized, previousNormalized) !== 0,
    basisUncertain: false,
  };
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
  const reviewedCostChanged = costChangeSinceReview(source);
  const unreviewedCost = reviewedCostChanged === null
    ? costChangeWithoutReview(source)
    : null;
  const basisUncertain = unreviewedCost?.basisUncertain ?? false;
  const parametersChanged = parameterInputsChanged || basisUncertain || Boolean(
    source.officialCost.revisedAfterPurchase && !source.latestReview,
  );
  const costChanged = reviewedCostChanged ?? unreviewedCost!.costChanged;
  const reviewPending = !source.latestReview?.appliedPrice || parametersChanged || costChanged;
  let status: PricingStatus;
  if (!reviewPending) status = "REVIEWED";
  else if (parametersChanged) status = "PARAMETERS_CHANGED";
  else if (costChanged) status = "COST_CHANGED";
  else status = "NOT_REVIEWED";
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
    analysis.status === "REVIEWED" && Boolean(analysis.latestReview?.appliedPrice)
  );
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
