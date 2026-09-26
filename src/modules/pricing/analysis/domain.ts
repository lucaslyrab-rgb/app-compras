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
    review.saleUnit !== source.saleUnit ||
    !sameDecimal(review.conversionQuantity, source.conversionQuantity) ||
    !sameDecimal(review.beneficiationLossPercent, source.beneficiationLossPercent) ||
    !sameDecimal(review.operatingCostPercent, source.settings.operatingCostPercent) ||
    !sameDecimal(review.desiredMarginPercent, desiredMarginPercent)
  ));
}

function reviewedCostBeforeCorrection(source: PricingAnalysisSource): PreviousOfficialCost | null {
  const current = source.officialCost;
  const review = source.latestReview;
  if (!current?.revisedAfterPurchase || !review) return null;
  if (review.officialCostId !== current.id || review.officialCostVersion + 1 !== current.version)
    return null;
  return {
    id: review.officialCostId,
    cost: review.officialCost,
    costIsUnit: review.costIsUnit,
    version: review.officialCostVersion,
    cycleDate: current.cycleDate,
    purchasedAt: current.purchasedAt,
    revisedAfterPurchase: false,
    basisRecorded: true,
    conversionRecorded: true,
  };
}

function semanticCostStatus(
  source: PricingAnalysisSource,
  parametersChanged: boolean,
): PricingStatus {
  const current = source.officialCost!;
  if (parametersChanged) return "PARAMETERS_CHANGED";

  const correctedPrevious = reviewedCostBeforeCorrection(source);
  if (current.revisedAfterPurchase && !correctedPrevious) return "PARAMETERS_CHANGED";
  const previous = correctedPrevious ?? source.previousOfficialCost;
  if (!previous) return "NOT_REVIEWED";

  if (current.costIsUnit === previous.costIsUnit)
    return sameDecimal(current.cost, previous.cost) ? "NOT_REVIEWED" : "COST_CHANGED";

  if (!previous.basisRecorded) return "PARAMETERS_CHANGED";
  const reviewProvesStableConversion = Boolean(
    source.latestReview &&
    source.latestReview.officialCostId === previous.id &&
    source.latestReview.officialCostVersion === previous.version &&
    source.latestReview.saleUnit === source.saleUnit &&
    sameDecimal(source.latestReview.conversionQuantity, source.conversionQuantity),
  );
  if (!previous.conversionRecorded && !reviewProvesStableConversion)
    return "PARAMETERS_CHANGED";

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
  return compare(currentNormalized, previousNormalized) === 0 ? "NOT_REVIEWED" : "COST_CHANGED";
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
  let status: PricingStatus = "NOT_REVIEWED";
  if (source.latestReview?.inputFingerprint === fingerprint) status = "REVIEWED";
  else status = semanticCostStatus(
    source,
    reviewParametersChanged(source, desiredMarginPercent),
  );
  return {
    ...source,
    desiredMarginPercent,
    marginOrigin,
    calculation,
    calculationError: null,
    fingerprint,
    stalePurchase,
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
      (filter === "cost-changed" && analysis.status === "COST_CHANGED") ||
      (filter === "stale-purchase" && analysis.stalePurchase) ||
      (filter === "not-reviewed" && !["REVIEWED", "NO_COST"].includes(analysis.status)) ||
      (filter === "reviewed" && analysis.status === "REVIEWED")));
}

export function pricingMetrics(analyses: PricingAnalysis[]) {
  return {
    total: analyses.length,
    costChanged: analyses.filter((analysis) => analysis.status === "COST_CHANGED").length,
    stalePurchase: analyses.filter((analysis) => analysis.stalePurchase).length,
    reviewed: analyses.filter((analysis) => analysis.status === "REVIEWED").length,
  };
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
