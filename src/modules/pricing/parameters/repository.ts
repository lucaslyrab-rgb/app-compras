import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import { PricingValidationError } from "../financial";
import {
  authorizePricingProductRead,
  authorizeProductManagement,
  authorizePricingSettingsRead,
  authorizePricingSettingsManagement,
  PricingConflictError,
  ProductErpConflictError,
  type ConversionOrigin,
  type PricingProduct,
  type PricingSettings,
} from "./domain";

type PricingProductRow = Omit<PricingProduct, "conversionOrigin"> & { conversionOrigin: ConversionOrigin };

function productFromRow(row: PricingProductRow): PricingProduct {
  return { ...row, updatedAt: new Date(row.updatedAt).toISOString(), photoUpdatedAt: row.photoUpdatedAt ? new Date(row.photoUpdatedAt).toISOString() : null };
}

const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23505";

export async function listPricingProducts(principal: Principal) {
  authorizePricingProductRead(principal);
  const rows = await database().sql<PricingProductRow[]>`
    SELECT p.id, p.erp_code AS "erpCode", p.name, p.unit AS "catalogUnit",
      p.purchase_format AS "purchaseFormat", p.exclusive_supplier AS "exclusiveSupplier",
      p.active, p.version AS "productVersion", p.photo_key AS "photoKey", p.photo_updated_at AS "photoUpdatedAt",
      pp.sale_unit AS "saleUnit", pp.conversion_quantity::text AS "conversionQuantity",
      pp.conversion_origin AS "conversionOrigin", pp.beneficiation_loss_percent::text AS "beneficiationLossPercent",
      pp.specific_margin_percent::text AS "specificMarginPercent", pp.version, pp.updated_at AS "updatedAt"
    FROM products p JOIN product_pricing_parameters pp ON pp.product_id = p.id
    ORDER BY p.name, p.erp_code
  `;
  return rows.map(productFromRow);
}

export async function readPricingProduct(principal: Principal, productId: string) {
  authorizePricingProductRead(principal);
  const [row] = await database().sql<PricingProductRow[]>`
    SELECT p.id, p.erp_code AS "erpCode", p.name, p.unit AS "catalogUnit",
      p.purchase_format AS "purchaseFormat", p.exclusive_supplier AS "exclusiveSupplier",
      p.active, p.version AS "productVersion", p.photo_key AS "photoKey", p.photo_updated_at AS "photoUpdatedAt",
      pp.sale_unit AS "saleUnit", pp.conversion_quantity::text AS "conversionQuantity",
      pp.conversion_origin AS "conversionOrigin", pp.beneficiation_loss_percent::text AS "beneficiationLossPercent",
      pp.specific_margin_percent::text AS "specificMarginPercent", pp.version, pp.updated_at AS "updatedAt"
    FROM products p JOIN product_pricing_parameters pp ON pp.product_id = p.id WHERE p.id = ${productId}
  `;
  return row ? productFromRow(row) : null;
}

export async function createPricingProduct(principal: Principal, input: {
  erpCode: number; name: string; catalogUnit: string; purchaseFormat: string; exclusiveSupplier: boolean;
  saleUnit: string; conversionQuantity: string; beneficiationLossPercent: string; specificMarginPercent: string | null;
}) {
  authorizeProductManagement(principal);
  try {
    const row = await database().sql.begin(async (tx) => {
      const [product] = await tx<{ id: string }[]>`
        INSERT INTO products (erp_code, name, unit, purchase_format, markup, exclusive_supplier, active)
        VALUES (${input.erpCode}, ${input.name}, ${input.catalogUnit}, ${input.purchaseFormat}, 0, ${input.exclusiveSupplier}, true)
        RETURNING id
      `;
      await tx`INSERT INTO product_pricing_parameters (
        product_id, sale_unit, conversion_quantity, conversion_origin, beneficiation_loss_percent, specific_margin_percent
      ) VALUES (${product.id}, ${input.saleUnit}, ${input.conversionQuantity}, 'MANUAL', ${input.beneficiationLossPercent}, ${input.specificMarginPercent})`;
      const [created] = await tx<PricingProductRow[]>`
        SELECT p.id, p.erp_code AS "erpCode", p.name, p.unit AS "catalogUnit", p.purchase_format AS "purchaseFormat",
          p.exclusive_supplier AS "exclusiveSupplier", p.active, p.version AS "productVersion", p.photo_key AS "photoKey",
          p.photo_updated_at AS "photoUpdatedAt", pp.sale_unit AS "saleUnit", pp.conversion_quantity::text AS "conversionQuantity",
          pp.conversion_origin AS "conversionOrigin", pp.beneficiation_loss_percent::text AS "beneficiationLossPercent",
          pp.specific_margin_percent::text AS "specificMarginPercent", pp.version, pp.updated_at AS "updatedAt"
        FROM products p JOIN product_pricing_parameters pp ON pp.product_id = p.id WHERE p.id = ${product.id}`;
      return created;
    });
    return productFromRow(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ProductErpConflictError();
    throw error;
  }
}

export async function updatePricingProduct(principal: Principal, input: {
  productId: string; erpCode: number; name: string; catalogUnit: string; purchaseFormat: string; exclusiveSupplier: boolean;
  saleUnit: string; conversionQuantity: string; beneficiationLossPercent: string; specificMarginPercent: string | null;
  expectedProductVersion: number; expectedVersion: number; confirmedFormatConversion: boolean;
}) {
  authorizeProductManagement(principal);
  try {
    const row = await database().sql.begin(async (tx) => {
      const [current] = await tx<PricingProductRow[]>`
        SELECT p.id, p.erp_code AS "erpCode", p.name, p.unit AS "catalogUnit", p.purchase_format AS "purchaseFormat",
          p.exclusive_supplier AS "exclusiveSupplier", p.active, p.version AS "productVersion", p.photo_key AS "photoKey",
          p.photo_updated_at AS "photoUpdatedAt", pp.sale_unit AS "saleUnit", pp.conversion_quantity::text AS "conversionQuantity",
          pp.conversion_origin AS "conversionOrigin", pp.beneficiation_loss_percent::text AS "beneficiationLossPercent",
          pp.specific_margin_percent::text AS "specificMarginPercent", pp.version, pp.updated_at AS "updatedAt"
        FROM products p JOIN product_pricing_parameters pp ON pp.product_id = p.id
        WHERE p.id = ${input.productId} FOR UPDATE OF p, pp`;
      if (!current) throw new Error("Produto não encontrado.");
      if (current.productVersion !== input.expectedProductVersion || current.version !== input.expectedVersion)
        throw new PricingConflictError(productFromRow(current));
      const formatChanged = current.purchaseFormat !== input.purchaseFormat;
      if (formatChanged && !input.confirmedFormatConversion)
        throw new PricingValidationError("Confirme a revisão da conversão ao alterar o formato de compra.");
      await tx`UPDATE products SET erp_code = ${input.erpCode}, name = ${input.name}, unit = ${input.catalogUnit},
        purchase_format = ${input.purchaseFormat}, exclusive_supplier = ${input.exclusiveSupplier},
        version = version + 1, updated_at = now()
        WHERE id = ${input.productId} AND version = ${input.expectedProductVersion}`;
      await tx`UPDATE product_pricing_parameters SET sale_unit = ${input.saleUnit}, conversion_quantity = ${input.conversionQuantity},
        conversion_origin = CASE WHEN ${formatChanged} OR sale_unit <> ${input.saleUnit}
          OR conversion_quantity <> ${input.conversionQuantity}::numeric THEN 'MANUAL' ELSE conversion_origin END,
        beneficiation_loss_percent = ${input.beneficiationLossPercent}, specific_margin_percent = ${input.specificMarginPercent},
        version = version + 1, updated_at = now()
        WHERE product_id = ${input.productId} AND version = ${input.expectedVersion}`;
      const [updated] = await tx<PricingProductRow[]>`
        SELECT p.id, p.erp_code AS "erpCode", p.name, p.unit AS "catalogUnit", p.purchase_format AS "purchaseFormat",
          p.exclusive_supplier AS "exclusiveSupplier", p.active, p.version AS "productVersion", p.photo_key AS "photoKey",
          p.photo_updated_at AS "photoUpdatedAt", pp.sale_unit AS "saleUnit", pp.conversion_quantity::text AS "conversionQuantity",
          pp.conversion_origin AS "conversionOrigin", pp.beneficiation_loss_percent::text AS "beneficiationLossPercent",
          pp.specific_margin_percent::text AS "specificMarginPercent", pp.version, pp.updated_at AS "updatedAt"
        FROM products p JOIN product_pricing_parameters pp ON pp.product_id = p.id WHERE p.id = ${input.productId}`;
      return updated;
    });
    return productFromRow(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ProductErpConflictError();
    throw error;
  }
}

export async function readPricingSettings(principal: Principal): Promise<PricingSettings> {
  authorizePricingSettingsRead(principal);
  const [row] = await database().sql<PricingSettings[]>`
    SELECT operating_cost_percent::text AS "operatingCostPercent", default_margin_percent::text AS "defaultMarginPercent",
      version, updated_at AS "updatedAt" FROM pricing_settings WHERE id = 'FLV'`;
  if (!row) throw new Error("Configurações de precificação não inicializadas.");
  return { ...row, updatedAt: new Date(row.updatedAt).toISOString() };
}

export async function updatePricingSettings(principal: Principal, input: { operatingCostPercent: string; defaultMarginPercent: string; expectedVersion: number }) {
  authorizePricingSettingsManagement(principal);
  const rows = await database().sql<PricingSettings[]>`
    UPDATE pricing_settings SET operating_cost_percent = ${input.operatingCostPercent}, default_margin_percent = ${input.defaultMarginPercent},
      version = version + 1, updated_at = now() WHERE id = 'FLV' AND version = ${input.expectedVersion}
    RETURNING operating_cost_percent::text AS "operatingCostPercent", default_margin_percent::text AS "defaultMarginPercent",
      version, updated_at AS "updatedAt"`;
  if (rows[0]) return { ...rows[0], updatedAt: new Date(rows[0].updatedAt).toISOString() };
  throw new PricingConflictError(await readPricingSettings(principal));
}
