import type { Principal } from "@/modules/identity";
import { AuthorizationError, canManagePricing } from "@/modules/identity";
import { add, compare, decimal, PricingValidationError, toDecimal } from "../financial";

export const conversionOrigins = ["PROVISIONAL", "UNIT", "MANUAL"] as const;
export type ConversionOrigin = (typeof conversionOrigins)[number];
export type ProductPricingFilter = "all" | "provisional" | "unit" | "configured";

export type PricingSettings = {
  operatingCostPercent: string;
  defaultMarginPercent: string;
  version: number;
  updatedAt: string;
};

export type PricingProduct = {
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
};

export class PricingConflictError<T> extends Error {
  constructor(public readonly current: T) {
    super("Os dados foram atualizados em outra sessão.");
    this.name = "PricingConflictError";
  }
}

export function authorizePricingManagement(principal: Principal) {
  if (!canManagePricing(principal))
    throw new AuthorizationError("Acesso restrito ao Gestor");
}

function canonicalInput(input: string, scale: number, label: string) {
  try {
    return toDecimal(decimal(input.trim().replace(",", ".")), scale);
  } catch (error) {
    if (error instanceof PricingValidationError)
      throw new PricingValidationError(`${label} inválido.`);
    throw error;
  }
}

export function validateProductPricing(input: {
  saleUnit: string;
  conversionQuantity: string;
  beneficiationLossPercent: string;
  specificMarginPercent: string | null;
}) {
  const saleUnit = input.saleUnit.trim().toLocaleUpperCase("pt-BR");
  if (!saleUnit || saleUnit.length > 16)
    throw new PricingValidationError("Informe uma unidade de venda válida.");
  const conversionQuantity = canonicalInput(input.conversionQuantity, 6, "Conversão");
  if (compare(decimal(conversionQuantity), decimal(0n)) <= 0)
    throw new PricingValidationError("A conversão deve ser maior que zero.");
  const beneficiationLossPercent = canonicalInput(input.beneficiationLossPercent, 4, "Perda");
  if (
    compare(decimal(beneficiationLossPercent), decimal(0n)) < 0 ||
    compare(decimal(beneficiationLossPercent), decimal("100")) >= 0
  ) throw new PricingValidationError("A perda deve estar entre 0 e 100%.");
  const specificMarginPercent = input.specificMarginPercent === null
    ? null
    : canonicalInput(input.specificMarginPercent, 4, "Margem específica");
  if (
    specificMarginPercent !== null &&
    (compare(decimal(specificMarginPercent), decimal(0n)) < 0 ||
      compare(decimal(specificMarginPercent), decimal("100")) >= 0)
  ) throw new PricingValidationError("A margem específica deve estar entre 0 e 100%.");
  return { saleUnit, conversionQuantity, beneficiationLossPercent, specificMarginPercent };
}

export function validatePricingSettings(input: {
  operatingCostPercent: string;
  defaultMarginPercent: string;
}) {
  const operatingCostPercent = canonicalInput(input.operatingCostPercent, 4, "Custo operacional");
  const defaultMarginPercent = canonicalInput(input.defaultMarginPercent, 4, "Margem padrão");
  const operating = decimal(operatingCostPercent);
  const margin = decimal(defaultMarginPercent);
  if (compare(operating, decimal(0n)) < 0 || compare(margin, decimal(0n)) < 0)
    throw new PricingValidationError("Os percentuais não podem ser negativos.");
  if (compare(add(operating, margin), decimal("100")) >= 0)
    throw new PricingValidationError("Custo operacional e margem devem somar menos de 100%.");
  return { operatingCostPercent, defaultMarginPercent };
}

export function pricingProductStatus(product: PricingProduct): ProductPricingFilter {
  if (product.conversionOrigin === "PROVISIONAL") return "provisional";
  if (product.conversionOrigin === "UNIT") return "unit";
  return "configured";
}

export function filterPricingProducts(
  products: PricingProduct[],
  query: string,
  filter: ProductPricingFilter,
) {
  const term = query.trim().toLocaleLowerCase("pt-BR");
  return products.filter((product) =>
    (!term || product.name.toLocaleLowerCase("pt-BR").includes(term) ||
      String(product.erpCode).includes(term) ||
      product.purchaseFormat.toLocaleLowerCase("pt-BR").includes(term)) &&
    (filter === "all" || pricingProductStatus(product) === filter));
}

export function pricingProductMetrics(products: PricingProduct[]) {
  return {
    total: products.length,
    provisional: products.filter((product) => product.conversionOrigin === "PROVISIONAL").length,
    unit: products.filter((product) => product.conversionOrigin === "UNIT").length,
    configured: products.filter((product) => product.conversionOrigin === "MANUAL").length,
  };
}
