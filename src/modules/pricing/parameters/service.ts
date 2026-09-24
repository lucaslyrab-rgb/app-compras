import type { Principal } from "@/modules/identity";
import { validatePricingSettings, validateProductPricing } from "./domain";
import {
  listPricingProducts,
  readPricingProduct,
  readPricingSettings,
  updatePricingProduct,
  updatePricingSettings,
} from "./repository";

export { listPricingProducts, readPricingProduct, readPricingSettings };

export async function saveProductPricing(
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
  return updatePricingProduct(principal, {
    productId: input.productId,
    expectedVersion: input.expectedVersion,
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
