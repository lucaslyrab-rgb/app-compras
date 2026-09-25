import type { PricingProduct, PricingSettings } from "../parameters/domain";
import { calculatePricing, type PricingCalculation } from "../financial";

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
};

export type LatestReview = {
  id: string;
  inputFingerprint: string;
  officialCostId: string;
  officialCostVersion: number;
  reviewedAt: string;
} | null;

export type PricingAnalysisSource = PricingProduct & {
  settings: PricingSettings;
  officialCost: OfficialCost | null;
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
  else if (source.latestReview && (
    source.latestReview.officialCostId !== source.officialCost.id ||
    source.latestReview.officialCostVersion !== source.officialCost.version
  )) status = "COST_CHANGED";
  else if (source.latestReview) status = "PARAMETERS_CHANGED";
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
