import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import { calculatePricing } from "../financial";
import { authorizePricingManagement, type ConversionOrigin } from "../parameters/domain";
import { PricingReviewError, pricingFingerprint, type PricingAnalysisSource } from "./domain";

type AnalysisRow = {
  id: string;
  erpCode: number;
  name: string;
  purchaseFormat: string;
  saleUnit: string;
  conversionQuantity: string;
  conversionOrigin: ConversionOrigin;
  beneficiationLossPercent: string;
  specificMarginPercent: string | null;
  version: number;
  updatedAt: string;
  operatingCostPercent: string;
  defaultMarginPercent: string;
  settingsVersion: number;
  settingsUpdatedAt: string;
  officialCostId: string | null;
  officialCost: string | null;
  officialCostIsUnit: boolean | null;
  officialCostVersion: number | null;
  officialCycleDate: string | null;
  officialPurchasedAt: string | null;
  reviewId: string | null;
  reviewFingerprint: string | null;
  reviewOfficialCostId: string | null;
  reviewOfficialCostVersion: number | null;
  reviewedAt: string | null;
};

function source(row: AnalysisRow, currentCycleDate: string): PricingAnalysisSource {
  return {
    id: row.id,
    erpCode: row.erpCode,
    name: row.name,
    purchaseFormat: row.purchaseFormat,
    saleUnit: row.saleUnit,
    conversionQuantity: row.conversionQuantity,
    conversionOrigin: row.conversionOrigin,
    beneficiationLossPercent: row.beneficiationLossPercent,
    specificMarginPercent: row.specificMarginPercent,
    version: row.version,
    updatedAt: new Date(row.updatedAt).toISOString(),
    settings: {
      operatingCostPercent: row.operatingCostPercent,
      defaultMarginPercent: row.defaultMarginPercent,
      version: row.settingsVersion,
      updatedAt: new Date(row.settingsUpdatedAt).toISOString(),
    },
    officialCost: row.officialCostId ? {
      id: row.officialCostId,
      cost: row.officialCost!,
      costIsUnit: row.officialCostIsUnit ?? false,
      version: row.officialCostVersion!,
      cycleDate: row.officialCycleDate!,
      purchasedAt: new Date(row.officialPurchasedAt!).toISOString(),
    } : null,
    latestReview: row.reviewId ? {
      id: row.reviewId,
      inputFingerprint: row.reviewFingerprint!,
      officialCostId: row.reviewOfficialCostId!,
      officialCostVersion: row.reviewOfficialCostVersion!,
      reviewedAt: new Date(row.reviewedAt!).toISOString(),
    } : null,
    currentCycleDate,
  };
}

export async function readPricingAnalysisSources(principal: Principal, currentCycleDate: string) {
  authorizePricingManagement(principal);
  const rows = await database().sql<AnalysisRow[]>`
    SELECT p.id, p.erp_code AS "erpCode", p.name,
           p.purchase_format AS "purchaseFormat",
           pp.sale_unit AS "saleUnit",
           pp.conversion_quantity::text AS "conversionQuantity",
           pp.conversion_origin AS "conversionOrigin",
           pp.beneficiation_loss_percent::text AS "beneficiationLossPercent",
           pp.specific_margin_percent::text AS "specificMarginPercent",
           pp.version, pp.updated_at AS "updatedAt",
           settings.operating_cost_percent::text AS "operatingCostPercent",
           settings.default_margin_percent::text AS "defaultMarginPercent",
           settings.version AS "settingsVersion",
           settings.updated_at AS "settingsUpdatedAt",
           official.id AS "officialCostId", official.cost::text AS "officialCost",
           official.cost_is_unit AS "officialCostIsUnit",
           official.version AS "officialCostVersion",
           official.purchase_cycle_date::text AS "officialCycleDate",
           official.purchased_at AS "officialPurchasedAt",
           review.id AS "reviewId", review.input_fingerprint AS "reviewFingerprint",
           review.official_cost_id AS "reviewOfficialCostId",
           review.official_cost_version AS "reviewOfficialCostVersion",
           review.reviewed_at AS "reviewedAt"
    FROM products p
    JOIN product_pricing_parameters pp ON pp.product_id = p.id
    CROSS JOIN pricing_settings settings
    LEFT JOIN LATERAL (
      SELECT c.* FROM purchase_cycle_product_costs c
      WHERE c.product_id = p.id AND c.purchased AND c.cost IS NOT NULL
        AND c.purchase_cycle_date <= ${currentCycleDate}::date
      ORDER BY c.purchase_cycle_date DESC, c.purchased_at DESC NULLS LAST,
               c.updated_at DESC, c.id DESC
      LIMIT 1
    ) official ON true
    LEFT JOIN LATERAL (
      SELECT r.* FROM pricing_reviews r
      WHERE r.product_id = p.id
      ORDER BY r.reviewed_at DESC, r.id DESC
      LIMIT 1
    ) review ON true
    WHERE p.active AND settings.id = 'FLV'
    ORDER BY p.name, p.erp_code
  `;
  return rows.map((row) => source(row, currentCycleDate));
}

type ReviewInputRow = {
  productId: string;
  saleUnit: string;
  conversionQuantity: string;
  conversionOrigin: ConversionOrigin;
  lossPercent: string;
  parameterVersion: number;
  specificMarginPercent: string | null;
  operatingCostPercent: string;
  defaultMarginPercent: string;
  settingsVersion: number;
};

type OfficialRow = {
  id: string;
  cost: string;
  costIsUnit: boolean;
  version: number;
  cycleDate: string;
  purchasedAt: string;
};

export async function persistPricingReview(
  principal: Principal,
  input: { productId: string; currentCycleDate: string; expectedFingerprint: string },
) {
  authorizePricingManagement(principal);
  return database().sql.begin(async (sql) => {
    const [parameters] = await sql<ReviewInputRow[]>`
      SELECT pp.product_id AS "productId", pp.sale_unit AS "saleUnit",
             pp.conversion_quantity::text AS "conversionQuantity",
             pp.conversion_origin AS "conversionOrigin",
             pp.beneficiation_loss_percent::text AS "lossPercent",
             pp.version AS "parameterVersion",
             pp.specific_margin_percent::text AS "specificMarginPercent",
             settings.operating_cost_percent::text AS "operatingCostPercent",
             settings.default_margin_percent::text AS "defaultMarginPercent",
             settings.version AS "settingsVersion"
      FROM product_pricing_parameters pp
      JOIN products p ON p.id = pp.product_id AND p.active
      CROSS JOIN pricing_settings settings
      WHERE pp.product_id = ${input.productId} AND settings.id = 'FLV'
      FOR SHARE OF pp, p, settings
    `;
    if (!parameters) throw new PricingReviewError("Produto não encontrado.");
    const [official] = await sql<OfficialRow[]>`
      SELECT id, cost::text, cost_is_unit AS "costIsUnit", version,
             purchase_cycle_date::text AS "cycleDate", purchased_at AS "purchasedAt"
      FROM purchase_cycle_product_costs
      WHERE product_id = ${input.productId} AND purchased AND cost IS NOT NULL
        AND purchase_cycle_date <= ${input.currentCycleDate}::date
      ORDER BY purchase_cycle_date DESC, purchased_at DESC NULLS LAST,
               updated_at DESC, id DESC
      LIMIT 1
      FOR SHARE
    `;
    if (!official) throw new PricingReviewError("Produto sem custo oficial.");
    const desiredMarginPercent = parameters.specificMarginPercent ?? parameters.defaultMarginPercent;
    const fingerprint = pricingFingerprint({
      officialCost: {
        id: official.id,
        cost: official.cost,
        costIsUnit: official.costIsUnit,
        version: official.version,
        cycleDate: official.cycleDate,
        purchasedAt: new Date(official.purchasedAt).toISOString(),
      },
      saleUnit: parameters.saleUnit,
      conversionQuantity: parameters.conversionQuantity,
      beneficiationLossPercent: parameters.lossPercent,
      operatingCostPercent: parameters.operatingCostPercent,
      desiredMarginPercent,
    });
    if (fingerprint !== input.expectedFingerprint)
      throw new PricingReviewError("Os dados da precificação mudaram. Analise novamente.");
    const calculation = calculatePricing({
      officialCost: official.cost,
      costIsUnit: official.costIsUnit,
      conversionQuantity: parameters.conversionQuantity,
      lossPercent: parameters.lossPercent,
      operatingCostPercent: parameters.operatingCostPercent,
      desiredMarginPercent,
    });
    const [review] = await sql<{ id: string; reviewedAt: string }[]>`
      INSERT INTO pricing_reviews (
        product_id, official_cost_id, official_cost_version,
        official_purchase_cycle_date, official_cost, cost_is_unit,
        sale_unit, conversion_quantity, conversion_origin,
        beneficiation_loss_percent, parameter_version,
        operating_cost_percent, desired_margin_percent, margin_origin,
        settings_version, gross_unit_cost, effective_unit_cost,
        calculated_price, suggested_price, input_fingerprint,
        reviewed_by
      ) VALUES (
        ${input.productId}, ${official.id}, ${official.version},
        ${official.cycleDate}::date, ${official.cost}, ${official.costIsUnit},
        ${parameters.saleUnit}, ${parameters.conversionQuantity}, ${parameters.conversionOrigin},
        ${parameters.lossPercent}, ${parameters.parameterVersion},
        ${parameters.operatingCostPercent}, ${desiredMarginPercent},
        ${parameters.specificMarginPercent === null ? "DEFAULT" : "SPECIFIC"},
        ${parameters.settingsVersion}, ${calculation.grossUnitCost},
        ${calculation.effectiveUnitCost}, ${calculation.calculatedPrice},
        ${calculation.suggestedPrice}, ${fingerprint}, ${principal.userId}
      )
      RETURNING id, reviewed_at AS "reviewedAt"
    `;
    return { ...review, reviewedAt: new Date(review.reviewedAt).toISOString(), fingerprint };
  });
}
