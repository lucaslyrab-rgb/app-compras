import { describe, expect, it } from "vitest";
import {
  buildPricingAnalysis,
  filterPricingAnalyses,
  printablePricingAnalyses,
  pricingPrintRows,
  pricingMetrics,
  pricingStalePurchaseMessage,
  type LatestReview,
  type PricingAnalysis,
  type PricingAnalysisSource,
  type PreviousOfficialCost,
} from "@/modules/pricing/analysis/domain";

function cost(value: string, cycleDate = "2026-09-23", overrides: Partial<PreviousOfficialCost> = {}): PreviousOfficialCost {
  return {
    id: `cost-${cycleDate}`,
    cost: value,
    costIsUnit: false,
    version: 1,
    cycleDate,
    purchasedAt: `${cycleDate}T10:00:00.000Z`,
    revisedAfterPurchase: false,
    basisRecorded: true,
    conversionRecorded: true,
    ...overrides,
  };
}

function source(overrides: Partial<PricingAnalysisSource> = {}): PricingAnalysisSource {
  const officialCost = overrides.officialCost === undefined ? cost("40.00") : overrides.officialCost;
  return {
    id: "11111111-1111-4111-8111-111111111111",
    erpCode: 1010,
    name: "REPOLHO VERDE",
    purchaseFormat: "CX",
    saleUnit: "KG",
    conversionQuantity: "20.000000",
    conversionOrigin: "PROVISIONAL",
    beneficiationLossPercent: "40.0000",
    specificMarginPercent: null,
    version: 1,
    updatedAt: "2026-09-23T10:00:00.000Z",
    settings: { operatingCostPercent: "23.0000", defaultMarginPercent: "20.0000", version: 1, updatedAt: "2026-09-23T10:00:00.000Z" },
    officialCost,
    officialCostHistory: overrides.officialCostHistory ?? (officialCost ? [{ ...officialCost, basisRecorded: true, conversionRecorded: true }] : []),
    latestReview: null,
    referenceCycleDate: "2026-09-23",
    ...overrides,
  };
}

function reviewOf(analysis: PricingAnalysis, overrides: Partial<NonNullable<LatestReview>> = {}): NonNullable<LatestReview> {
  return {
    id: "review-1",
    inputFingerprint: analysis.fingerprint!,
    officialCostId: analysis.officialCost!.id,
    officialCostVersion: analysis.officialCost!.version,
    officialPurchaseCycleDate: analysis.officialCost!.cycleDate,
    officialCost: analysis.officialCost!.cost,
    costIsUnit: analysis.officialCost!.costIsUnit,
    saleUnit: analysis.saleUnit,
    conversionQuantity: analysis.conversionQuantity,
    beneficiationLossPercent: analysis.beneficiationLossPercent,
    operatingCostPercent: analysis.settings.operatingCostPercent,
    desiredMarginPercent: analysis.desiredMarginPercent,
    effectiveUnitCost: analysis.calculation!.effectiveUnitCost,
    calculatedPrice: analysis.calculation!.calculatedPrice,
    suggestedPrice: analysis.calculation!.suggestedPrice,
    appliedPrice: analysis.calculation!.suggestedPrice,
    decidedPrice: analysis.calculation!.suggestedPrice,
    decisionOrigin: "SUGGESTED",
    reviewedAt: "2026-09-23T11:00:00.000Z",
    ...overrides,
  };
}

describe("análise de precificação", () => {
  it("distingue sem custo e custo anterior ao ciclo oficial de referência", () => {
    expect(buildPricingAnalysis(source({ officialCost: null, officialCostHistory: [] })).status).toBe("NO_COST");
    const staleCost = cost("40.00", "2026-09-22");
    const stale = buildPricingAnalysis(source({ officialCost: staleCost, officialCostHistory: [staleCost] }));
    expect(stale.stalePurchase).toBe(true);
    expect(stale.status).toBe("COST_CHANGED");
    expect(stale).toMatchObject({ costChanged: true, reviewPending: true });
    expect(pricingStalePurchaseMessage(stale)).toBe(
      "Sem compra no ciclo 23/09/2026 — usando custo oficial do ciclo 22/09/2026.",
    );
  });

  it("não torna histórico o custo do ciclo de referência nem depende do próximo pedido", () => {
    const current = buildPricingAnalysis(source({
      referenceCycleDate: "2026-09-25",
      officialCost: { ...source().officialCost!, cycleDate: "2026-09-25" },
    }));
    expect(current.stalePurchase).toBe(false);
    expect(pricingStalePurchaseMessage(current)).toBeNull();
  });

  it("não marca recência quando ainda não existe ciclo oficial de referência", () => {
    expect(buildPricingAnalysis(source({ officialCost: null, referenceCycleDate: null }))).toMatchObject({
      status: "NO_COST",
      stalePurchase: false,
    });
  });

  it("mantém a mudança do ciclo N pendente em N+1 e N+2", () => {
    const n = cost("40.00", "2026-09-23");
    const changed = cost("50.00", "2026-09-24");
    const sameN1 = cost("50.00", "2026-09-25");
    const sameN2 = cost("50.00", "2026-09-26");
    for (const history of [[n, changed], [n, changed, sameN1], [n, changed, sameN1, sameN2]]) {
      expect(buildPricingAnalysis(source({ officialCost: history.at(-1)!, officialCostHistory: history, referenceCycleDate: history.at(-1)!.cycleDate })).status).toBe("COST_CHANGED");
    }
  });

  it("distingue custo alterado de parâmetro alterado e revisado", () => {
    const fresh = buildPricingAnalysis(source());
    expect(fresh).toMatchObject({ status: "COST_CHANGED", costChanged: true, reviewPending: true });
    const reviewed = buildPricingAnalysis(source({ latestReview: reviewOf(fresh) }));
    expect(reviewed.status).toBe("REVIEWED");
    const parameterChanged = buildPricingAnalysis(source({
      latestReview: { ...reviewed.latestReview!, inputFingerprint: "old", conversionQuantity: "19.000000" },
    }));
    expect(parameterChanged.status).toBe("PARAMETERS_CHANGED");
    const currentCost = cost("50.00", "2026-09-23", { id: "current" });
    const costChanged = buildPricingAnalysis(source({
      officialCost: currentCost,
      officialCostHistory: [
        { ...source().officialCost!, basisRecorded: true, conversionRecorded: true },
        currentCost,
      ],
      latestReview: { ...reviewed.latestReview!, inputFingerprint: "old" },
    }));
    expect(costChanged.status).toBe("COST_CHANGED");
  });

  it("não apaga a pendência com custo igual posterior, nova mudança ou retorno ao inicial", () => {
    const initial = cost("40.00", "2026-09-23");
    const changed = cost("50.00", "2026-09-24");
    const cases = [
      [initial, changed, cost("50.00", "2026-09-25")],
      [initial, changed, cost("55.00", "2026-09-25")],
      [initial, changed, cost("40.00", "2026-09-25")],
    ];
    for (const history of cases)
      expect(buildPricingAnalysis(source({ officialCost: history.at(-1)!, officialCostHistory: history, referenceCycleDate: "2026-09-25" })).status).toBe("COST_CHANGED");
  });

  it("usa a revisão como watermark e custo igual posterior não cria pendência", () => {
    const initial = cost("40.00", "2026-09-23");
    const changed = cost("50.00", "2026-09-24");
    const beforeReview = buildPricingAnalysis(source({ officialCost: changed, officialCostHistory: [initial, changed], referenceCycleDate: changed.cycleDate }));
    const latestReview = reviewOf(beforeReview);
    expect(buildPricingAnalysis(source({ officialCost: changed, officialCostHistory: [initial, changed], latestReview, referenceCycleDate: changed.cycleDate })).status).toBe("REVIEWED");
    const equalAfter = cost("50.00", "2026-09-25");
    expect(buildPricingAnalysis(source({ officialCost: equalAfter, officialCostHistory: [initial, changed, equalAfter], latestReview, referenceCycleDate: equalAfter.cycleDate })).status).toBe("REVIEWED");
  });

  it("permite revisão comercial manual sem criar Custo alterado", () => {
    const analysis = buildPricingAnalysis(source());
    const manual = reviewOf(analysis, { decidedPrice: "7.99", decisionOrigin: "MANUAL" });
    expect(buildPricingAnalysis(source({ latestReview: manual })).status).toBe("REVIEWED");
  });

  it("não usa id, versão ou ciclo como evidência de custo alterado", () => {
    const previous = cost("40.00", "2026-09-23");
    const same = cost("40.00", "2026-09-25", { id: "other", version: 9 });
    expect(buildPricingAnalysis(source({ officialCost: same, officialCostHistory: [previous, same], referenceCycleDate: same.cycleDate })).status).toBe("NOT_REVIEWED");
  });

  it("mantém a revisão quando um novo ciclo repete o custo econômico confirmado", () => {
    const original = buildPricingAnalysis(source());
    const previous = { ...source().officialCost!, basisRecorded: true, conversionRecorded: true };
    const sameCost = cost("40.00", "2026-09-25", { id: "new", version: 1 });
    const sameEconomicCost = buildPricingAnalysis(source({
      officialCost: sameCost,
      officialCostHistory: [previous, sameCost],
      latestReview: reviewOf(original),
      referenceCycleDate: "2026-09-25",
    }));
    expect(sameEconomicCost).toMatchObject({
      status: "REVIEWED",
      costChanged: false,
      parametersChanged: false,
      reviewPending: false,
    });
  });

  it("reabre a revisão após mudança posterior ao custo confirmado", () => {
    const original = buildPricingAnalysis(source());
    const previous = { ...source().officialCost!, basisRecorded: true, conversionRecorded: true };
    const changedCost = cost("50.00", "2026-09-25", { id: "new" });
    const changed = buildPricingAnalysis(source({
      officialCost: changedCost,
      officialCostHistory: [previous, changedCost],
      latestReview: reviewOf(original),
      referenceCycleDate: "2026-09-25",
    }));
    expect(changed).toMatchObject({ status: "COST_CHANGED", costChanged: true, reviewPending: true });
  });

  it("preserva custo e parâmetros quando valor e base mudam após a revisão", () => {
    const original = buildPricingAnalysis(source());
    const previous = { ...source().officialCost!, basisRecorded: true, conversionRecorded: true };
    const changedCost = cost("3.00", "2026-09-25", {
      id: "new",
      costIsUnit: true,
    });
    const changed = buildPricingAnalysis(source({
      officialCost: changedCost,
      officialCostHistory: [previous, changedCost],
      latestReview: reviewOf(original),
      referenceCycleDate: "2026-09-25",
    }));
    expect(changed).toMatchObject({
      status: "PARAMETERS_CHANGED",
      costChanged: true,
      parametersChanged: true,
      reviewPending: true,
    });
  });

  it("não trata revisão legada sem preço aplicado como confirmação", () => {
    const original = buildPricingAnalysis(source());
    const legacy = buildPricingAnalysis(source({
      latestReview: { ...reviewOf(original), appliedPrice: null, decidedPrice: null, decisionOrigin: null },
    }));
    expect(legacy).toMatchObject({ status: "NOT_REVIEWED", costChanged: false, reviewPending: true });
    expect(legacy.latestReview?.decidedPrice).toBeNull();
  });

  it("imprime somente revisão atual com decisão explícita e preserva o preço manual", () => {
    const pending = buildPricingAnalysis(source({ id: "pending" }));
    const manualBase = buildPricingAnalysis(source({ id: "manual", name: "CEBOLA ROXA" }));
    const manual = buildPricingAnalysis(source({
      id: "manual",
      name: "CEBOLA ROXA",
      latestReview: reviewOf(manualBase, {
        id: "manual-review",
        suggestedPrice: "10.49",
        appliedPrice: "9.99",
        decidedPrice: "9.99",
        decisionOrigin: "MANUAL",
      }),
    }));
    const legacyBase = buildPricingAnalysis(source({ id: "legacy" }));
    const legacy = buildPricingAnalysis(source({
      id: "legacy",
      latestReview: reviewOf(legacyBase, {
        id: "legacy-review",
        appliedPrice: null,
        decidedPrice: null,
        decisionOrigin: null,
      }),
    }));

    expect(pricingPrintRows([pending, manual, legacy])).toEqual([
      expect.objectContaining({
        reviewId: "manual-review",
        productName: "CEBOLA ROXA",
        suggestedPrice: "10.49",
        decidedPrice: "9.99",
        decisionOrigin: "MANUAL",
      }),
    ]);
    expect(pricingPrintRows([manual], ["other-review"])).toEqual([]);
    expect(pricingPrintRows([manual], ["manual-review"])).toHaveLength(1);
  });

  it("normaliza bases equivalentes com aritmética exata", () => {
    const previous = cost("40.00");
    const equivalent = cost("2.00", "2026-09-24", { costIsUnit: true });
    expect(buildPricingAnalysis(source({ officialCost: equivalent, officialCostHistory: [previous, equivalent] })).status).toBe("NOT_REVIEWED");
    const reduced = cost("1.99", "2026-09-24", { costIsUnit: true });
    expect(buildPricingAnalysis(source({ officialCost: reduced, officialCostHistory: [previous, reduced] })).status).toBe("COST_CHANGED");
  });

  it("trata ausência e base histórica insegura sem inventar equivalência", () => {
    expect(buildPricingAnalysis(source({ officialCost: null, officialCostHistory: [] })).status).toBe("NO_COST");
    const previous = cost("40.00", "2026-09-23", { basisRecorded: false, conversionRecorded: false });
    const current = cost("2.00", "2026-09-24", { costIsUnit: true });
    expect(buildPricingAnalysis(source({ officialCost: current, officialCostHistory: [previous, current] })).status).toBe("PARAMETERS_CHANGED");
  });

  it("mantém tratamento conservador para correção sobrescrita não reconstruível", () => {
    const corrected = cost("40.00", "2026-09-23", { version: 3, revisedAfterPurchase: true });
    expect(buildPricingAnalysis(source({ officialCost: corrected, officialCostHistory: [corrected] })).status).toBe("PARAMETERS_CHANGED");
  });

  it("classifica com segurança os dados auditados de 25/09", () => {
    const audited = [
      ["ABACATE KG", "60.00", false, "50.00", false, true, "COST_CHANGED"],
      ["AIPIM KG", "75.00", false, "80.00", false, true, "COST_CHANGED"],
      ["BANANA NANICA KG", "63.00", false, "60.00", false, true, "COST_CHANGED"],
      ["CEBOLA ROXA KG", "120.00", false, "100.00", false, true, "COST_CHANGED"],
      ["BATATA INGLESA KG", "100.00", false, "100.00", false, true, "NOT_REVIEWED"],
      ["BANANA PRATA KG", "2.50", true, "3.00", false, false, "PARAMETERS_CHANGED"],
      ["BERINJELA KG", "3.00", true, "3.00", false, false, "PARAMETERS_CHANGED"],
      ["CHUCHU KG", "50.00", true, "70.00", false, false, "PARAMETERS_CHANGED"],
    ] as const;

    for (const [name, currentValue, currentIsUnit, previousValue, previousIsUnit, recorded, expected] of audited) {
      const previous = cost(previousValue, "2026-09-24", { id: `${name}-previous`, costIsUnit: previousIsUnit, basisRecorded: recorded, conversionRecorded: recorded });
      const current = cost(currentValue, "2026-09-25", { id: `${name}-current`, costIsUnit: currentIsUnit });
      const analysis = buildPricingAnalysis(source({
        name,
        officialCost: current,
        officialCostHistory: [previous, current],
        referenceCycleDate: current.cycleDate,
      }));
      expect(analysis.status, name).toBe(expected);
      if (name === "CHUCHU KG") expect(analysis).toMatchObject({
        costChanged: true,
        parametersChanged: true,
        reviewPending: true,
      });
    }
  });

  it("invalida a revisão quando qualquer parâmetro aplicável muda", () => {
    const original = buildPricingAnalysis(source());
    const latestReview = reviewOf(original);
    const changes: Partial<PricingAnalysisSource>[] = [
      { saleUnit: "UND" },
      { conversionQuantity: "21.000000" },
      { beneficiationLossPercent: "41.0000" },
      { settings: { ...source().settings, operatingCostPercent: "24.0000" } },
      { settings: { ...source().settings, defaultMarginPercent: "21.0000" } },
    ];
    for (const change of changes)
      expect(buildPricingAnalysis(source({ latestReview, ...change })).status).toBe("PARAMETERS_CHANGED");
  });

  it("não invalida margem específica por mudança global não aplicável", () => {
    const specific = buildPricingAnalysis(source({ specificMarginPercent: "25.0000" }));
    const latestReview = reviewOf(specific);
    expect(buildPricingAnalysis(source({ specificMarginPercent: "25.0000", latestReview, settings: { ...source().settings, defaultMarginPercent: "22.0000" } })).status).toBe("REVIEWED");
  });

  it("filtra e calcula indicadores", () => {
    const pending = buildPricingAnalysis(source());
    const staleCost = cost("40.00", "2026-09-22");
    const stale = buildPricingAnalysis(source({ id: "2", name: "ALHO", officialCost: staleCost, officialCostHistory: [staleCost] }));
    const reviewedBase = buildPricingAnalysis(source({ id: "3", name: "BANANA" }));
    const reviewed = buildPricingAnalysis(source({ id: "3", name: "BANANA", latestReview: reviewOf(reviewedBase) }));
    expect(filterPricingAnalyses([pending, stale, reviewed], "alho", "stale-purchase")).toEqual([stale]);
    expect(pricingMetrics([pending, stale, reviewed])).toEqual({
      total: 3,
      costChanged: 2,
      stalePurchase: 1,
      reviewed: 1,
    });
    expect(printablePricingAnalyses([pending, stale, reviewed])).toEqual([reviewed]);
  });
});
