import type { Principal } from "@/modules/identity";
import { normalizeManagedProduct } from "@/modules/catalog/domain";
import { validatePricingSettings, validateProductPricing } from "./domain";
import {
  createPricingProduct,
  listPricingProducts,
  readPricingProduct,
  readPricingSettings,
  updatePricingProduct,
  updatePricingSettings,
} from "./repository";

export { listPricingProducts, readPricingProduct, readPricingSettings };

export async function createProduct(principal: Principal, input: {
  erpCode: number; name: string; catalogUnit: string; purchaseFormat: string; exclusiveSupplier: boolean;
  saleUnit: string; conversionQuantity: string; beneficiationLossPercent: string; specificMarginPercent: string | null;
}) {
  const master = normalizeManagedProduct({
    erpCode: input.erpCode, name: input.name, unit: input.catalogUnit,
    purchaseFormat: input.purchaseFormat, exclusiveSupplier: input.exclusiveSupplier,
  });
  return createPricingProduct(principal, {
    ...input, name: master.name, catalogUnit: master.unit, purchaseFormat: master.purchaseFormat,
    ...validateProductPricing(input),
  });
}

export async function saveProductPricing(
  principal: Principal,
  input: {
    productId: string;
    erpCode: number;
    name: string;
    catalogUnit: string;
    purchaseFormat: string;
    exclusiveSupplier: boolean;
    saleUnit: string;
    conversionQuantity: string;
    beneficiationLossPercent: string;
    specificMarginPercent: string | null;
    expectedVersion: number;
    expectedProductVersion: number;
    confirmedFormatConversion: boolean;
  },
) {
  const master = normalizeManagedProduct({
    erpCode: input.erpCode, name: input.name, unit: input.catalogUnit,
    purchaseFormat: input.purchaseFormat, exclusiveSupplier: input.exclusiveSupplier,
  });
  return updatePricingProduct(principal, {
    ...input,
    name: master.name,
    catalogUnit: master.unit,
    purchaseFormat: master.purchaseFormat,
    ...validateProductPricing(input),
  });
}

export async function savePricingSettings(
  principal: Principal,
  input: { operatingCostPercent: string; defaultMarginPercent: string; expectedVersion: number },
) {
  return updatePricingSettings(principal, {
    expectedVersion: input.expectedVersion,
    ...validatePricingSettings(input),
  });
}
