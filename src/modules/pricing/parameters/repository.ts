import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import {
  authorizePricingManagement,
  PricingConflictError,
  type ConversionOrigin,
  type PricingProduct,
  type PricingSettings,
} from "./domain";

type PricingProductRow = Omit<PricingProduct, "conversionOrigin"> & { conversionOrigin: ConversionOrigin };

function productFromRow(row: PricingProductRow): PricingProduct {
  return { ...row, updatedAt: new Date(row.updatedAt).toISOString() };
}

export async function listPricingProducts(principal: Principal) {
  authorizePricingManagement(principal);
  const rows = await database().sql<PricingProductRow[]>`
    SELECT p.id, p.erp_code AS "erpCode", p.name,
           p.purchase_format AS "purchaseFormat",
           pp.sale_unit AS "saleUnit",
           pp.conversion_quantity::text AS "conversionQuantity",
           pp.conversion_origin AS "conversionOrigin",
           pp.beneficiation_loss_percent::text AS "beneficiationLossPercent",
           pp.specific_margin_percent::text AS "specificMarginPercent",
           pp.version, pp.updated_at AS "updatedAt"
    FROM products p
    JOIN product_pricing_parameters pp ON pp.product_id = p.id
    WHERE p.active
    ORDER BY p.name, p.erp_code
  `;
  return rows.map(productFromRow);
}

export async function readPricingProduct(principal: Principal, productId: string) {
  authorizePricingManagement(principal);
  const [row] = await database().sql<PricingProductRow[]>`
    SELECT p.id, p.erp_code AS "erpCode", p.name,
           p.purchase_format AS "purchaseFormat",
           pp.sale_unit AS "saleUnit",
           pp.conversion_quantity::text AS "conversionQuantity",
           pp.conversion_origin AS "conversionOrigin",
           pp.beneficiation_loss_percent::text AS "beneficiationLossPercent",
           pp.specific_margin_percent::text AS "specificMarginPercent",
           pp.version, pp.updated_at AS "updatedAt"
    FROM products p
    JOIN product_pricing_parameters pp ON pp.product_id = p.id
    WHERE p.id = ${productId} AND p.active
  `;
  return row ? productFromRow(row) : null;
}

export async function readPricingSettings(principal: Principal): Promise<PricingSettings> {
  authorizePricingManagement(principal);
  const [row] = await database().sql<PricingSettings[]>`
    SELECT operating_cost_percent::text AS "operatingCostPercent",
           default_margin_percent::text AS "defaultMarginPercent",
           version, updated_at AS "updatedAt"
    FROM pricing_settings WHERE id = 'FLV'
  `;
  if (!row) throw new Error("Configurações de precificação não inicializadas.");
  return { ...row, updatedAt: new Date(row.updatedAt).toISOString() };
}

export async function updatePricingProduct(
  principal: Principal,
  input: {
    productId: string;
    saleUnit: string;
    conversionQuantity: string;
    beneficiationLossPercent: string;
    specificMarginPercent: string | null;
    expectedVersion: number;
  },
) {
  authorizePricingManagement(principal);
  const rows = await database().sql<PricingProductRow[]>`
    UPDATE product_pricing_parameters pp
    SET sale_unit = ${input.saleUnit},
        conversion_origin = CASE
          WHEN pp.sale_unit <> ${input.saleUnit}
            OR pp.conversion_quantity <> ${input.conversionQuantity}::numeric
          THEN 'MANUAL'
          ELSE pp.conversion_origin
        END,
        conversion_quantity = ${input.conversionQuantity},
        beneficiation_loss_percent = ${input.beneficiationLossPercent},
        specific_margin_percent = ${input.specificMarginPercent},
        version = pp.version + 1,
        updated_at = now()
    FROM products p
    WHERE pp.product_id = ${input.productId}
      AND pp.version = ${input.expectedVersion}
      AND p.id = pp.product_id
      AND p.active
    RETURNING p.id, p.erp_code AS "erpCode", p.name,
              p.purchase_format AS "purchaseFormat",
              pp.sale_unit AS "saleUnit",
              pp.conversion_quantity::text AS "conversionQuantity",
              pp.conversion_origin AS "conversionOrigin",
              pp.beneficiation_loss_percent::text AS "beneficiationLossPercent",
              pp.specific_margin_percent::text AS "specificMarginPercent",
              pp.version, pp.updated_at AS "updatedAt"
  `;
  if (rows[0]) return productFromRow(rows[0]);
  const current = await readPricingProduct(principal, input.productId);
  if (!current) throw new Error("Produto não encontrado.");
  throw new PricingConflictError(current);
}

export async function updatePricingSettings(
  principal: Principal,
  input: { operatingCostPercent: string; defaultMarginPercent: string; expectedVersion: number },
) {
  authorizePricingManagement(principal);
  const rows = await database().sql<PricingSettings[]>`
    UPDATE pricing_settings
    SET operating_cost_percent = ${input.operatingCostPercent},
        default_margin_percent = ${input.defaultMarginPercent},
        version = version + 1,
        updated_at = now()
    WHERE id = 'FLV' AND version = ${input.expectedVersion}
    RETURNING operating_cost_percent::text AS "operatingCostPercent",
              default_margin_percent::text AS "defaultMarginPercent",
              version, updated_at AS "updatedAt"
  `;
  if (rows[0]) return { ...rows[0], updatedAt: new Date(rows[0].updatedAt).toISOString() };
  throw new PricingConflictError(await readPricingSettings(principal));
}
