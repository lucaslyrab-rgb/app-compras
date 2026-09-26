export type Rational = Readonly<{ numerator: bigint; denominator: bigint }>;

export class PricingValidationError extends Error {
  override name = "PricingValidationError";
}

function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let left = absolute(a);
  let right = absolute(b);
  while (right !== 0n) [left, right] = [right, left % right];
  return left || 1n;
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new PricingValidationError("Divisão por zero.");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: (numerator / divisor) * sign,
    denominator: absolute(denominator / divisor),
  };
}

export function decimal(value: string | bigint | Rational): Rational {
  if (typeof value === "object") return value;
  if (typeof value === "bigint") return rational(value);
  const normalized = value.trim().replace(",", ".");
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new PricingValidationError("Valor decimal inválido.");
  const fraction = match[3] ?? "";
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${match[2]}${fraction}`) * (match[1] ? -1n : 1n);
  return rational(numerator, denominator);
}

export function add(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function subtract(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function multiply(left: Rational, right: Rational) {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divide(left: Rational, right: Rational) {
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function compare(left: Rational, right: Rational) {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function roundedInteger(numerator: bigint, denominator: bigint) {
  const negative = numerator < 0n;
  const value = absolute(numerator);
  const quotient = value / denominator;
  const remainder = value % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function toDecimal(value: Rational, scale = 6) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18)
    throw new PricingValidationError("Escala decimal inválida.");
  const factor = 10n ** BigInt(scale);
  const scaled = roundedInteger(value.numerator * factor, value.denominator);
  const negative = scaled < 0n;
  const unsigned = absolute(scaled);
  const whole = unsigned / factor;
  if (scale === 0) return `${negative ? "-" : ""}${whole}`;
  const fraction = String(unsigned % factor).padStart(scale, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function assertPositive(value: Rational, message: string) {
  if (compare(value, decimal(0n)) <= 0) throw new PricingValidationError(message);
}

function percentFraction(value: string, label: string) {
  const percent = decimal(value);
  if (compare(percent, decimal(0n)) < 0 || compare(percent, decimal("100")) >= 0)
    throw new PricingValidationError(`${label} deve estar entre 0 e 100%.`);
  return divide(percent, decimal("100"));
}

export function grossUnitCost(
  officialCost: string,
  conversionQuantity: string,
  costIsUnit: boolean,
) {
  const cost = decimal(officialCost);
  const conversion = decimal(conversionQuantity);
  assertPositive(cost, "O custo oficial deve ser maior que zero.");
  assertPositive(conversion, "A conversão deve ser maior que zero.");
  return costIsUnit ? cost : divide(cost, conversion);
}

export function saleableQuantity(conversionQuantity: string, lossPercent: string) {
  const conversion = decimal(conversionQuantity);
  assertPositive(conversion, "A conversão deve ser maior que zero.");
  const retained = subtract(decimal(1n), percentFraction(lossPercent, "A perda"));
  return multiply(conversion, retained);
}

export function effectiveUnitCost(grossCost: Rational, lossPercent: string) {
  assertPositive(grossCost, "O custo bruto unitário deve ser maior que zero.");
  const retained = subtract(decimal(1n), percentFraction(lossPercent, "A perda"));
  return divide(grossCost, retained);
}

export function mathematicalPrice(
  effectiveCost: Rational,
  operatingCostPercent: string,
  desiredMarginPercent: string,
) {
  assertPositive(effectiveCost, "O custo efetivo deve ser maior que zero.");
  const operating = percentFraction(operatingCostPercent, "O custo operacional");
  const margin = percentFraction(desiredMarginPercent, "A margem");
  const denominator = subtract(subtract(decimal(1n), operating), margin);
  if (compare(denominator, decimal(0n)) <= 0)
    throw new PricingValidationError("Custo operacional e margem devem somar menos de 100%.");
  return divide(effectiveCost, denominator);
}

export function commercialRound(input: Rational | string) {
  const price = typeof input === "string" ? decimal(input) : input;
  assertPositive(price, "O preço calculado deve ser maior que zero.");
  const whole = price.numerator / price.denominator;
  const remainder = rational(price.numerator % price.denominator, price.denominator);
  const twenty = decimal("0.20");
  const sixty = decimal("0.60");
  let cents: bigint;
  if (compare(remainder, twenty) < 0) cents = whole * 100n - 1n;
  else if (compare(remainder, sixty) <= 0) cents = whole * 100n + 49n;
  else cents = whole * 100n + 99n;
  if (cents <= 0n)
    throw new PricingValidationError("O preço calculado é baixo demais para o arredondamento comercial.");
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export type PricingCalculation = {
  grossUnitCost: string;
  effectiveUnitCost: string;
  calculatedPrice: string;
  suggestedPrice: string;
};

export function calculatePricing(input: {
  officialCost: string;
  costIsUnit: boolean;
  conversionQuantity: string;
  lossPercent: string;
  operatingCostPercent: string;
  desiredMarginPercent: string;
}): PricingCalculation {
  const gross = grossUnitCost(input.officialCost, input.conversionQuantity, input.costIsUnit);
  const effective = effectiveUnitCost(gross, input.lossPercent);
  const calculated = mathematicalPrice(effective, input.operatingCostPercent, input.desiredMarginPercent);
  return {
    grossUnitCost: toDecimal(gross),
    effectiveUnitCost: toDecimal(effective),
    calculatedPrice: toDecimal(calculated),
    suggestedPrice: commercialRound(calculated),
  };
}

export function simulateSellingPrice(input: {
  effectiveUnitCost: string;
  operatingCostPercent: string;
  simulatedPrice: string;
}) {
  const effective = decimal(input.effectiveUnitCost);
  const price = decimal(input.simulatedPrice);
  assertPositive(effective, "O custo efetivo deve ser maior que zero.");
  assertPositive(price, "O preço simulado deve ser maior que zero.");
  const operating = percentFraction(input.operatingCostPercent, "O custo operacional");
  const resultingMargin = subtract(subtract(decimal(1n), operating), divide(effective, price));
  const markup = subtract(divide(price, effective), decimal(1n));
  return {
    resultingMarginPercent: toDecimal(multiply(resultingMargin, decimal("100"))),
    markupPercent: toDecimal(multiply(markup, decimal("100"))),
  };
}

export function appliedSellingPrice(value: string) {
  const price = decimal(value);
  assertPositive(price, "O preço aplicado deve ser maior que zero.");
  const normalized = toDecimal(price, 2);
  if (compare(price, decimal(normalized)) !== 0)
    throw new PricingValidationError("O preço aplicado deve ter no máximo duas casas decimais.");
  return normalized;
}
