import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import { calculatePricing, compare, decimal, toDecimal } from "../financial";
import { authorizePricingManagement, type ConversionOrigin } from "../parameters/domain";
import { PricingReviewError, pricingFingerprint, type DecisionOrigin, type PricingAnalysisSource, type PricingReviewDecision, type PreviousOfficialCost } from "./domain";

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
  reviewId: string | null;
  reviewFingerprint: string | null;
  reviewOfficialCostId: string | null;
  reviewOfficialCostVersion: number | null;
  reviewOfficialPurchaseCycleDate: string | null;
  reviewOfficialCost: string | null;
  reviewCostIsUnit: boolean | null;
  reviewSaleUnit: string | null;
  reviewConversionQuantity: string | null;
  reviewBeneficiationLossPercent: string | null;
  reviewOperatingCostPercent: string | null;
  reviewDesiredMarginPercent: string | null;
  reviewEffectiveUnitCost: string | null;
  reviewCalculatedPrice: string | null;
  reviewSuggestedPrice: string | null;
  reviewAppliedPrice: string | null;
  reviewDecidedPrice: string | null;
  reviewDecisionOrigin: DecisionOrigin | null;
  reviewedAt: string | null;
  referenceCycleDate: string | null;
};

type CostHistoryRow = {
  productId: string;
  id: string;
  cost: string;
  costIsUnit: boolean;
  version: number;
  cycleDate: string;
  purchasedAt: string;
  revisedAfterPurchase: boolean;
  basisRecorded: boolean;
  conversionRecorded: boolean;
};

function source(row: AnalysisRow, history: PreviousOfficialCost[]): PricingAnalysisSource {
  const officialCost = history.at(-1) ?? null;
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
    officialCost,
    officialCostHistory: history,
    latestReview: row.reviewId ? {
      id: row.reviewId,
      inputFingerprint: row.reviewFingerprint!,
      officialCostId: row.reviewOfficialCostId!,
      officialCostVersion: row.reviewOfficialCostVersion!,
      officialPurchaseCycleDate: row.reviewOfficialPurchaseCycleDate!,
      officialCost: row.reviewOfficialCost!,
      costIsUnit: row.reviewCostIsUnit!,
      saleUnit: row.reviewSaleUnit!,
      conversionQuantity: row.reviewConversionQuantity!,
      beneficiationLossPercent: row.reviewBeneficiationLossPercent!,
      operatingCostPercent: row.reviewOperatingCostPercent!,
      desiredMarginPercent: row.reviewDesiredMarginPercent!,
      effectiveUnitCost: row.reviewEffectiveUnitCost!,
      calculatedPrice: row.reviewCalculatedPrice!,
      suggestedPrice: row.reviewSuggestedPrice!,
      appliedPrice: row.reviewAppliedPrice ?? row.reviewDecidedPrice ?? null,
      decidedPrice: row.reviewDecidedPrice ?? row.reviewAppliedPrice ?? null,
      decisionOrigin: row.reviewDecisionOrigin ?? null,
      reviewedAt: new Date(row.reviewedAt!).toISOString(),
    } : null,
    referenceCycleDate: row.referenceCycleDate,
  };
}

export async function readPricingAnalysisSources(principal: Principal, operationalDate: string) {
  authorizePricingManagement(principal);
  const sql = database().sql;
  const [rows, costRows] = await Promise.all([
    sql<AnalysisRow[]>`
      WITH pricing_reference AS (
        SELECT max(c.purchase_cycle_date) AS cycle_date
        FROM purchase_cycle_product_costs c
        WHERE c.purchased AND c.cost IS NOT NULL
          AND c.purchase_cycle_date <= ${operationalDate}::date
      )
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
             review.id AS "reviewId", review.input_fingerprint AS "reviewFingerprint",
             review.official_cost_id AS "reviewOfficialCostId",
             review.official_cost_version AS "reviewOfficialCostVersion",
             review.official_purchase_cycle_date::text AS "reviewOfficialPurchaseCycleDate",
             review.official_cost::text AS "reviewOfficialCost",
             review.cost_is_unit AS "reviewCostIsUnit",
             review.sale_unit AS "reviewSaleUnit",
             review.conversion_quantity::text AS "reviewConversionQuantity",
             review.beneficiation_loss_percent::text AS "reviewBeneficiationLossPercent",
             review.operating_cost_percent::text AS "reviewOperatingCostPercent",
             review.desired_margin_percent::text AS "reviewDesiredMarginPercent",
             review.effective_unit_cost::text AS "reviewEffectiveUnitCost",
             review.calculated_price::text AS "reviewCalculatedPrice",
             review.suggested_price::text AS "reviewSuggestedPrice",
             review.applied_price::text AS "reviewAppliedPrice",
             COALESCE(review.decided_price, review.applied_price)::text AS "reviewDecidedPrice",
             CASE
               WHEN review.decided_price IS NOT NULL THEN COALESCE(review.decision_origin, 'MANUAL')
               WHEN review.applied_price IS NOT NULL THEN
                 CASE WHEN review.applied_price = review.suggested_price THEN 'SUGGESTED' ELSE 'MANUAL' END
               ELSE NULL
             END AS "reviewDecisionOrigin",
             review.reviewed_at AS "reviewedAt",
             pricing_reference.cycle_date::text AS "referenceCycleDate"
      FROM products p
      JOIN product_pricing_parameters pp ON pp.product_id = p.id
      CROSS JOIN pricing_settings settings
      CROSS JOIN pricing_reference
      LEFT JOIN LATERAL (
        SELECT r.* FROM pricing_reviews r
        WHERE r.product_id = p.id
        ORDER BY r.reviewed_at DESC, r.id DESC
        LIMIT 1
      ) review ON true
      WHERE p.active AND settings.id = 'FLV'
      ORDER BY p.name, p.erp_code
    `,
    sql<CostHistoryRow[]>`
      WITH pricing_reference AS (
        SELECT max(c.purchase_cycle_date) AS cycle_date
        FROM purchase_cycle_product_costs c
        WHERE c.purchased AND c.cost IS NOT NULL
          AND c.purchase_cycle_date <= ${operationalDate}::date
      )
      SELECT c.product_id AS "productId", c.id, c.cost::text,
             c.cost_is_unit AS "costIsUnit", c.version,
             c.purchase_cycle_date::text AS "cycleDate",
             c.purchased_at AS "purchasedAt",
             c.version > 1 AND c.updated_at > c.purchased_at AS "revisedAfterPurchase",
             c.updated_at >= pp.created_at AS "basisRecorded",
             c.updated_at >= pp.updated_at AS "conversionRecorded"
      FROM purchase_cycle_product_costs c
      JOIN products p ON p.id = c.product_id AND p.active
      JOIN product_pricing_parameters pp ON pp.product_id = c.product_id
      CROSS JOIN pricing_reference
      WHERE c.purchased AND c.cost IS NOT NULL
        AND pricing_reference.cycle_date IS NOT NULL
        AND c.purchase_cycle_date <= pricing_reference.cycle_date
      ORDER BY c.product_id, c.purchase_cycle_date, c.purchased_at,
               c.updated_at, c.id
    `,
  ]);
  const histories = new Map<string, PreviousOfficialCost[]>();
  for (const row of costRows) {
    const item: PreviousOfficialCost = {
      id: row.id,
      cost: row.cost,
      costIsUnit: row.costIsUnit,
      version: row.version,
      cycleDate: row.cycleDate,
      purchasedAt: new Date(row.purchasedAt).toISOString(),
      revisedAfterPurchase: row.revisedAfterPurchase,
      basisRecorded: row.basisRecorded,
      conversionRecorded: row.conversionRecorded,
    };
    histories.set(row.productId, [...(histories.get(row.productId) ?? []), item]);
  }
  return rows.map((row) => source(row, histories.get(row.id) ?? []));
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
  input: { productId: string; operationalDate: string; expectedFingerprint: string; decidedPrice: string },
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
      WITH pricing_reference AS (
        SELECT max(purchase_cycle_date) AS cycle_date
        FROM purchase_cycle_product_costs
        WHERE purchased AND cost IS NOT NULL
          AND purchase_cycle_date <= ${input.operationalDate}::date
      )
      SELECT id, cost::text, cost_is_unit AS "costIsUnit", version,
             purchase_cycle_date::text AS "cycleDate", purchased_at AS "purchasedAt"
      FROM purchase_cycle_product_costs
      WHERE product_id = ${input.productId} AND purchased AND cost IS NOT NULL
        AND purchase_cycle_date <= (SELECT cycle_date FROM pricing_reference)
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
        revisedAfterPurchase: false,
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
    const parsedDecision = decimal(input.decidedPrice);
    if (compare(parsedDecision, decimal(0n)) <= 0)
      throw new PricingReviewError("O preço decidido deve ser maior que zero.");
    const decidedPrice = toDecimal(parsedDecision, 2);
    if (compare(decimal(decidedPrice), decimal(0n)) <= 0)
      throw new PricingReviewError("O preço decidido deve ser maior que zero.");
    const decisionOrigin: DecisionOrigin = compare(decimal(decidedPrice), decimal(calculation.suggestedPrice)) === 0
      ? "SUGGESTED"
      : "MANUAL";
    const [review] = await sql<{ id: string; reviewedAt: string }[]>`
      INSERT INTO pricing_reviews (
        product_id, official_cost_id, official_cost_version,
        official_purchase_cycle_date, official_cost, cost_is_unit,
        sale_unit, conversion_quantity, conversion_origin,
        beneficiation_loss_percent, parameter_version,
        operating_cost_percent, desired_margin_percent, margin_origin,
        settings_version, gross_unit_cost, effective_unit_cost,
        calculated_price, suggested_price, applied_price, decided_price, decision_origin,
        input_fingerprint, reviewed_by
      ) VALUES (
        ${input.productId}, ${official.id}, ${official.version},
        ${official.cycleDate}::date, ${official.cost}, ${official.costIsUnit},
        ${parameters.saleUnit}, ${parameters.conversionQuantity}, ${parameters.conversionOrigin},
        ${parameters.lossPercent}, ${parameters.parameterVersion},
        ${parameters.operatingCostPercent}, ${desiredMarginPercent},
        ${parameters.specificMarginPercent === null ? "DEFAULT" : "SPECIFIC"},
        ${parameters.settingsVersion}, ${calculation.grossUnitCost},
        ${calculation.effectiveUnitCost}, ${calculation.calculatedPrice},
        ${calculation.suggestedPrice}, ${decidedPrice}, ${decidedPrice}, ${decisionOrigin},
        ${fingerprint}, ${principal.userId}
      )
      RETURNING id, reviewed_at AS "reviewedAt"
    `;
    return {
      ...review,
      reviewedAt: new Date(review.reviewedAt).toISOString(),
      fingerprint,
      effectiveUnitCost: calculation.effectiveUnitCost,
      calculatedPrice: calculation.calculatedPrice,
      suggestedPrice: calculation.suggestedPrice,
      appliedPrice: decidedPrice,
      decidedPrice,
      decisionOrigin,
    };
  });
}

export async function readPricingReviewDecisions(principal: Principal, ids: string[]) {
  authorizePricingManagement(principal);
  if (!ids.length) return [];
  const sql = database().sql;
  const rows = await sql<PricingReviewDecision[]>`
    SELECT r.id, r.product_id AS "productId", p.erp_code AS "erpCode",
           p.name AS "productName", r.sale_unit AS "saleUnit",
           r.effective_unit_cost::text AS "effectiveUnitCost",
           r.calculated_price::text AS "calculatedPrice",
           r.suggested_price::text AS "suggestedPrice",
           COALESCE(r.decided_price, r.applied_price)::text AS "decidedPrice",
           CASE
             WHEN r.decided_price IS NOT NULL THEN COALESCE(r.decision_origin, 'MANUAL')
             WHEN r.applied_price IS NOT NULL THEN
               CASE WHEN r.applied_price = r.suggested_price THEN 'SUGGESTED' ELSE 'MANUAL' END
             ELSE NULL
           END AS "decisionOrigin",
           r.reviewed_at AS "reviewedAt"
    FROM pricing_reviews r
    JOIN products p ON p.id = r.product_id
    WHERE r.id IN ${sql(ids)}
    ORDER BY r.reviewed_at, r.id
  `;
  return rows.map((row) => ({ ...row, reviewedAt: new Date(row.reviewedAt).toISOString() }));
}
