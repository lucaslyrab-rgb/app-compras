import { describe, expect, it } from "vitest";
import { buildPricingAnalysis, filterPricingAnalyses, printablePricingAnalyses, pricingMetrics, pricingStalePurchaseMessage, type PricingAnalysis, type PricingAnalysisSource } from "@/modules/pricing/analysis/domain";

function source(overrides: Partial<PricingAnalysisSource> = {}): PricingAnalysisSource {
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
    officialCost: { id: "22222222-2222-4222-8222-222222222222", cost: "40.00", costIsUnit: false, version: 1, cycleDate: "2026-09-23", purchasedAt: "2026-09-23T10:00:00.000Z", revisedAfterPurchase: false },
    previousOfficialCost: null,
    latestReview: null,
    referenceCycleDate: "2026-09-23",
    ...overrides,
  };
}

function reviewOf(analysis: PricingAnalysis) {
  return {
    id: "r",
    inputFingerprint: analysis.fingerprint!,
    officialCostId: analysis.officialCost!.id,
    officialCostVersion: analysis.officialCost!.version,
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
    reviewedAt: "2026-09-23T11:00:00.000Z",
  };
}

describe("análise de precificação", () => {
  it("distingue sem custo e custo anterior ao ciclo oficial de referência", () => {
    expect(buildPricingAnalysis(source({ officialCost: null })).status).toBe("NO_COST");
    const stale = buildPricingAnalysis(source({ officialCost: { ...source().officialCost!, cycleDate: "2026-09-22" } }));
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

  it("ignora a margem global quando há margem específica", () => {
    const analysis = buildPricingAnalysis(source({ specificMarginPercent: "25.0000" }));
    expect(analysis.desiredMarginPercent).toBe("25.0000");
    expect(analysis.marginOrigin).toBe("SPECIFIC");
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
    const costChanged = buildPricingAnalysis(source({
      officialCost: { ...source().officialCost!, id: "current", cost: "50.00" },
      previousOfficialCost: { ...source().officialCost!, basisRecorded: true, conversionRecorded: true },
      latestReview: { ...reviewed.latestReview!, inputFingerprint: "old" },
    }));
    expect(costChanged.status).toBe("COST_CHANGED");
  });

  it("compara custo semântico sem usar id, versão ou ciclo como evidência", () => {
    const previous = { ...source().officialCost!, basisRecorded: true, conversionRecorded: true };
    const sameCost = buildPricingAnalysis(source({
      officialCost: { ...source().officialCost!, id: "current", version: 9, cycleDate: "2026-09-25" },
      previousOfficialCost: previous,
      referenceCycleDate: "2026-09-25",
    }));
    expect(sameCost.status).toBe("NOT_REVIEWED");

    const increased = buildPricingAnalysis(source({
      officialCost: { ...source().officialCost!, id: "current", cost: "41.00", cycleDate: "2026-09-25" },
      previousOfficialCost: previous,
      referenceCycleDate: "2026-09-25",
    }));
    expect(increased.status).toBe("COST_CHANGED");
  });

  it("mantém a revisão quando um novo ciclo repete o custo econômico confirmado", () => {
    const original = buildPricingAnalysis(source());
    const sameEconomicCost = buildPricingAnalysis(source({
      officialCost: { ...source().officialCost!, id: "new", version: 1, cycleDate: "2026-09-25" },
      previousOfficialCost: { ...source().officialCost!, basisRecorded: true, conversionRecorded: true },
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
    const changed = buildPricingAnalysis(source({
      officialCost: { ...source().officialCost!, id: "new", cost: "50.00", cycleDate: "2026-09-25" },
      previousOfficialCost: { ...source().officialCost!, basisRecorded: true, conversionRecorded: true },
      latestReview: reviewOf(original),
      referenceCycleDate: "2026-09-25",
    }));
    expect(changed).toMatchObject({ status: "COST_CHANGED", costChanged: true, reviewPending: true });
  });

  it("preserva custo e parâmetros quando valor e base mudam após a revisão", () => {
    const original = buildPricingAnalysis(source());
    const changed = buildPricingAnalysis(source({
      officialCost: {
        ...source().officialCost!,
        id: "new",
        cost: "3.00",
        costIsUnit: true,
        cycleDate: "2026-09-25",
      },
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
      latestReview: { ...reviewOf(original), appliedPrice: null },
    }));
    expect(legacy).toMatchObject({ status: "NOT_REVIEWED", costChanged: false, reviewPending: true });
  });

  it("normaliza bases equivalentes com aritmética exata", () => {
    const previous = { ...source().officialCost!, cost: "40.00", basisRecorded: true, conversionRecorded: true };
    const equivalent = buildPricingAnalysis(source({
      officialCost: { ...source().officialCost!, id: "current", cost: "2.00", costIsUnit: true },
      previousOfficialCost: previous,
    }));
    expect(equivalent.status).toBe("NOT_REVIEWED");

    const reduced = buildPricingAnalysis(source({
      officialCost: { ...source().officialCost!, id: "current", cost: "1.99", costIsUnit: true },
      previousOfficialCost: previous,
    }));
    expect(reduced.status).toBe("COST_CHANGED");
  });

  it("trata ausência e base histórica insegura sem inventar equivalência", () => {
    expect(buildPricingAnalysis(source({ previousOfficialCost: null }))).toMatchObject({
      status: "COST_CHANGED",
      costChanged: true,
      reviewPending: true,
    });
    const incompatible = buildPricingAnalysis(source({
      officialCost: { ...source().officialCost!, costIsUnit: true },
      previousOfficialCost: { ...source().officialCost!, basisRecorded: false, conversionRecorded: false },
    }));
    expect(incompatible.status).toBe("PARAMETERS_CHANGED");
  });

  it("aceita conversão já vigente no registro anterior mesmo após edição versionada", () => {
    const converted = buildPricingAnalysis(source({
      version: 2,
      officialCost: { ...source().officialCost!, id: "current", cost: "2.00", costIsUnit: true },
      previousOfficialCost: {
        ...source().officialCost!,
        cost: "40.00",
        basisRecorded: true,
        conversionRecorded: true,
      },
    }));
    expect(converted.status).toBe("NOT_REVIEWED");
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

    for (const [name, currentCost, currentIsUnit, previousCost, previousIsUnit, basisRecorded, expected] of audited) {
      const analysis = buildPricingAnalysis(source({
        name,
        referenceCycleDate: "2026-09-25",
        officialCost: {
          ...source().officialCost!,
          id: `${name}-current`,
          cost: currentCost,
          costIsUnit: currentIsUnit,
          cycleDate: "2026-09-25",
        },
        previousOfficialCost: {
          ...source().officialCost!,
          id: `${name}-previous`,
          cost: previousCost,
          costIsUnit: previousIsUnit,
          cycleDate: "2026-09-24",
          basisRecorded,
          conversionRecorded: basisRecorded,
        },
      }));
      expect(analysis.status, name).toBe(expected);
      if (name === "CHUCHU KG") expect(analysis).toMatchObject({
        costChanged: true,
        parametersChanged: true,
        reviewPending: true,
      });
    }
  });

  it("invalida a revisão quando qualquer entrada aplicável muda", () => {
    const original = buildPricingAnalysis(source());
    const latestReview = reviewOf(original);
    const changes: Partial<PricingAnalysisSource>[] = [
      { conversionQuantity: "19.000000" },
      { beneficiationLossPercent: "41.0000" },
      { specificMarginPercent: "21.0000" },
      { settings: { ...source().settings, operatingCostPercent: "24.0000" } },
      { settings: { ...source().settings, defaultMarginPercent: "21.0000" } },
    ];
    for (const change of changes) {
      expect(buildPricingAnalysis(source({ latestReview, ...change })).status).toBe("PARAMETERS_CHANGED");
    }
  });

  it("não invalida margem específica por mudança na margem global não aplicável", () => {
    const specific = buildPricingAnalysis(source({ specificMarginPercent: "25.0000" }));
    const latestReview = reviewOf(specific);
    const changedGlobal = buildPricingAnalysis(source({
      specificMarginPercent: "25.0000",
      latestReview,
      settings: { ...source().settings, defaultMarginPercent: "22.0000" },
    }));
    expect(changedGlobal.status).toBe("REVIEWED");
  });

  it("filtra e calcula indicadores", () => {
    const pending = buildPricingAnalysis(source());
    const stale = buildPricingAnalysis(source({ id: "2", name: "ALHO", officialCost: { ...source().officialCost!, cycleDate: "2026-09-22" } }));
    const reviewedBase = buildPricingAnalysis(source({ id: "3", name: "BANANA" }));
    const reviewed = buildPricingAnalysis(source({ id: "3", name: "BANANA", latestReview: reviewOf(reviewedBase) }));
    expect(filterPricingAnalyses([pending, stale, reviewed], "alho", "stale-purchase")).toEqual([stale]);
    expect(pricingMetrics([pending, stale, reviewed])).toEqual({ total: 3, costChanged: 2, stalePurchase: 1, reviewed: 1 });
    expect(filterPricingAnalyses([pending, stale, reviewed], "", "cost-changed")).toEqual([pending, stale]);
    expect(printablePricingAnalyses([pending, stale, reviewed])).toEqual([reviewed]);
    const legacy = buildPricingAnalysis(source({
      id: "4",
      name: "LEGADO",
      latestReview: { ...reviewOf(reviewedBase), appliedPrice: null },
    }));
    expect(printablePricingAnalyses([pending, reviewed, legacy])).toEqual([reviewed]);
  });
});
