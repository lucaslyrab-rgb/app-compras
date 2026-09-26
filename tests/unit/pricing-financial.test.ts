import { describe, expect, it } from "vitest";
import {
  appliedSellingPrice,
  calculatePricing,
  commercialRound,
  decimal,
  effectiveUnitCost,
  grossUnitCost,
  mathematicalPrice,
  saleableQuantity,
  simulateSellingPrice,
  toDecimal,
} from "@/modules/pricing/financial";

describe("domínio financeiro da precificação", () => {
  it.each([
    ["CX", "100", "20", false, "5.000000"],
    ["CX", "5", "20", true, "5.000000"],
    ["SC", "100", "20", false, "5.000000"],
    ["UND", "3", "1", false, "3.000000"],
    ["PCT", "7.5", "1", false, "7.500000"],
    ["BDJ", "12", "1", false, "12.000000"],
  ])("normaliza %s corretamente", (_format, cost, conversion, unit, expected) => {
    expect(toDecimal(grossUnitCost(cost, conversion, unit))).toBe(expected);
  });

  it("aplica perda sem arredondar prematuramente", () => {
    expect(toDecimal(saleableQuantity("20", "40"))).toBe("12.000000");
    expect(toDecimal(effectiveUnitCost(decimal("2"), "40"))).toBe("3.333333");
  });

  it("calcula percentuais sobre o preço de venda", () => {
    expect(toDecimal(mathematicalPrice(decimal("10"), "23", "20"))).toBe("17.543860");
  });

  it("rejeita conversão, perda e denominador inválidos", () => {
    expect(() => grossUnitCost("10", "0", false)).toThrow(/conversão/i);
    expect(() => effectiveUnitCost(decimal("10"), "-1")).toThrow(/perda/i);
    expect(() => effectiveUnitCost(decimal("10"), "100")).toThrow(/perda/i);
    expect(() => mathematicalPrice(decimal("10"), "80", "20")).toThrow(/menos de 100/i);
  });

  it.each([
    ["10.00", "9.99"],
    ["10.01", "9.99"],
    ["10.10", "9.99"],
    ["10.19", "9.99"],
    ["10.20", "10.49"],
    ["10.37", "10.49"],
    ["10.49", "10.49"],
    ["10.55", "10.49"],
    ["10.60", "10.49"],
    ["10.61", "10.99"],
    ["10.75", "10.99"],
    ["10.99", "10.99"],
    ["9.99", "9.99"],
    ["11.01", "10.99"],
  ])("arredonda %s para %s", (input, expected) => {
    expect(commercialRound(input)).toBe(expected);
  });

  it("mantém preço matemático e sugerido separados", () => {
    expect(calculatePricing({
      officialCost: "40",
      costIsUnit: false,
      conversionQuantity: "20",
      lossPercent: "40",
      operatingCostPercent: "23",
      desiredMarginPercent: "20",
    })).toEqual({
      grossUnitCost: "2.000000",
      effectiveUnitCost: "3.333333",
      calculatedPrice: "5.847953",
      suggestedPrice: "5.99",
    });
  });

  it("simula margem líquida e markup sem persistência", () => {
    expect(simulateSellingPrice({
      effectiveUnitCost: "3.333333",
      operatingCostPercent: "23",
      simulatedPrice: "5.99",
    })).toEqual({ resultingMarginPercent: "21.351703", markupPercent: "79.700018" });
    for (const simulatedPrice of ["0", "-1", "inválido"])
      expect(() => simulateSellingPrice({ effectiveUnitCost: "3", operatingCostPercent: "23", simulatedPrice })).toThrow();
  });

  it("normaliza o preço aplicado sem arredondar uma decisão do Gestor", () => {
    expect(appliedSellingPrice("6,49")).toBe("6.49");
    expect(appliedSellingPrice("6.5")).toBe("6.50");
    for (const value of ["0", "-1", "6.499", "inválido"])
      expect(() => appliedSellingPrice(value)).toThrow();
  });
});
