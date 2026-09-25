import { describe, expect, it } from "vitest";
import { buildPricingAnalysis, filterPricingAnalyses, pricingMetrics, pricingStalePurchaseMessage, type PricingAnalysisSource } from "@/modules/pricing/analysis/domain";

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
    officialCost: { id: "22222222-2222-4222-8222-222222222222", cost: "40.00", costIsUnit: false, version: 1, cycleDate: "2026-09-23", purchasedAt: "2026-09-23T10:00:00.000Z" },
    latestReview: null,
    referenceCycleDate: "2026-09-23",
    ...overrides,
  };
}

describe("análise de precificação", () => {
  it("distingue sem custo e custo anterior ao ciclo oficial de referência", () => {
    expect(buildPricingAnalysis(source({ officialCost: null })).status).toBe("NO_COST");
    const stale = buildPricingAnalysis(source({ officialCost: { ...source().officialCost!, cycleDate: "2026-09-22" } }));
    expect(stale.stalePurchase).toBe(true);
    expect(stale.status).toBe("NOT_REVIEWED");
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
    const reviewed = buildPricingAnalysis(source({ latestReview: { id: "r", inputFingerprint: fresh.fingerprint!, officialCostId: fresh.officialCost!.id, officialCostVersion: 1, reviewedAt: "2026-09-23T11:00:00.000Z" } }));
    expect(reviewed.status).toBe("REVIEWED");
    const parameterChanged = buildPricingAnalysis(source({ latestReview: { ...reviewed.latestReview!, inputFingerprint: "old" } }));
    expect(parameterChanged.status).toBe("PARAMETERS_CHANGED");
    const costChanged = buildPricingAnalysis(source({ latestReview: { ...reviewed.latestReview!, inputFingerprint: "old", officialCostVersion: 0 } }));
    expect(costChanged.status).toBe("COST_CHANGED");
  });

  it("invalida a revisão quando qualquer entrada aplicável muda", () => {
    const original = buildPricingAnalysis(source());
    const latestReview = {
      id: "r",
      inputFingerprint: original.fingerprint!,
      officialCostId: original.officialCost!.id,
      officialCostVersion: original.officialCost!.version,
      reviewedAt: "2026-09-23T11:00:00.000Z",
    };
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
    const latestReview = {
      id: "r",
      inputFingerprint: specific.fingerprint!,
      officialCostId: specific.officialCost!.id,
      officialCostVersion: specific.officialCost!.version,
      reviewedAt: "2026-09-23T11:00:00.000Z",
    };
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
    const reviewed = buildPricingAnalysis(source({ id: "3", name: "BANANA", latestReview: { id: "r", inputFingerprint: reviewedBase.fingerprint!, officialCostId: reviewedBase.officialCost!.id, officialCostVersion: 1, reviewedAt: "2026-09-23T11:00:00.000Z" } }));
    expect(filterPricingAnalyses([pending, stale, reviewed], "alho", "stale-purchase")).toEqual([stale]);
    expect(pricingMetrics([pending, stale, reviewed])).toEqual({ total: 3, costChanged: 0, stalePurchase: 1, reviewed: 1 });
  });
});
