import { describe, expect, it } from "vitest";
import {
  buildPricingDetailHref,
  buildPricingListHref,
  buildPricingSearchParams,
  filterPricingAnalyses,
  isValidPricingFilter,
  parsePricingFilter,
  resolvePricingBackHref,
  sanitizePricingQuery,
  type PricingAnalysis,
  type PricingFilter,
} from "@/modules/pricing/analysis/domain";

describe("navegação e preservação de contexto da precificação", () => {
  it("1. acesso sem parâmetros resulta em filtro 'all' (Todos) e busca vazia", () => {
    expect(parsePricingFilter(undefined)).toBe("all");
    expect(parsePricingFilter(null)).toBe("all");
    expect(parsePricingFilter("")).toBe("all");
    expect(sanitizePricingQuery(undefined)).toBe("");
    expect(sanitizePricingQuery(null)).toBe("");
    expect(sanitizePricingQuery("")).toBe("");
  });

  it("2. filter=cost-changed inicializa filtro correto", () => {
    expect(parsePricingFilter("cost-changed")).toBe("cost-changed");
    expect(isValidPricingFilter("cost-changed")).toBe(true);
  });

  it("3. q=BATATA inicializa busca correta", () => {
    expect(sanitizePricingQuery("BATATA")).toBe("BATATA");
    expect(sanitizePricingQuery("  BATATA  ")).toBe("BATATA");
  });

  it("4. preserva filtro e busca simultaneamente nos search params", () => {
    const params = buildPricingSearchParams("cost-changed", "BATATA");
    expect(params.get("filter")).toBe("cost-changed");
    expect(params.get("q")).toBe("BATATA");
    expect(buildPricingListHref("cost-changed", "BATATA")).toBe("/gestor/precificacao?filter=cost-changed&q=BATATA");
  });

  it("5. filtro inválido cai com segurança para 'all' (Todos)", () => {
    expect(parsePricingFilter("invalid-status")).toBe("all");
    expect(parsePricingFilter("DROP TABLE products")).toBe("all");
    expect(parsePricingFilter("COST_CHANGED")).toBe("all");
    expect(parsePricingFilter(123 as unknown as string)).toBe("all");
    expect(isValidPricingFilter("invalid-status")).toBe(false);
  });

  it("6. query longa é tratada com segurança e limitada a 100 caracteres", () => {
    const longQuery = "a".repeat(150);
    const sanitized = sanitizePricingQuery(longQuery);
    expect(sanitized.length).toBe(100);
    expect(sanitized).toBe("a".repeat(100));

    const spacedQuery = "   " + "b".repeat(100) + "   ";
    expect(sanitizePricingQuery(spacedQuery)).toBe("b".repeat(100));
  });

  it("7. mudança de filtro gera URL sincronizada sem poluir defaults", () => {
    expect(buildPricingListHref("cost-changed", "")).toBe("/gestor/precificacao?filter=cost-changed");
    expect(buildPricingListHref("stale-purchase", "")).toBe("/gestor/precificacao?filter=stale-purchase");
    expect(buildPricingListHref("not-reviewed", "")).toBe("/gestor/precificacao?filter=not-reviewed");
    expect(buildPricingListHref("reviewed", "")).toBe("/gestor/precificacao?filter=reviewed");
    expect(buildPricingListHref("all", "")).toBe("/gestor/precificacao");
  });

  it("8. mudança de busca gera URL sincronizada mantendo o filtro atual", () => {
    expect(buildPricingListHref("cost-changed", "CENOURA")).toBe("/gestor/precificacao?filter=cost-changed&q=CENOURA");
    expect(buildPricingListHref("all", "TOMATE")).toBe("/gestor/precificacao?q=TOMATE");
  });

  it("9. link mobile para detalhe transporta o filtro selecionado", () => {
    const href = buildPricingDetailHref("prod-123", "cost-changed", "");
    expect(href).toBe("/gestor/precificacao/prod-123?filter=cost-changed");
  });

  it("10. link mobile para detalhe transporta filtro e busca", () => {
    const href = buildPricingDetailHref("prod-123", "cost-changed", "BATATA");
    expect(href).toBe("/gestor/precificacao/prod-123?filter=cost-changed&q=BATATA");

    // sem parâmetros extras quando default
    const defaultHref = buildPricingDetailHref("prod-123", "all", "");
    expect(defaultHref).toBe("/gestor/precificacao/prod-123");
  });

  it("11. ← Precificação reconstrói deterministicamente a URL a partir dos search params", () => {
    expect(resolvePricingBackHref({ filter: "cost-changed", q: "BATATA" })).toBe(
      "/gestor/precificacao?filter=cost-changed&q=BATATA",
    );
    expect(resolvePricingBackHref({ filter: "cost-changed" })).toBe("/gestor/precificacao?filter=cost-changed");
    expect(resolvePricingBackHref({ q: "BATATA" })).toBe("/gestor/precificacao?q=BATATA");
    expect(resolvePricingBackHref({ filter: "invalid-filter", q: "BATATA" })).toBe("/gestor/precificacao?q=BATATA");
  });

  it("12. acesso direto ao detalhe sem params continua retornando para /gestor/precificacao puro", () => {
    expect(resolvePricingBackHref(undefined)).toBe("/gestor/precificacao");
    expect(resolvePricingBackHref({})).toBe("/gestor/precificacao");
    expect(resolvePricingBackHref({ filter: "all", q: "" })).toBe("/gestor/precificacao");
  });

  it("13. produto revisado desaparece de Custos alterados sem alterar a regra do filtro", () => {
    const itemPending = {
      id: "prod-1",
      name: "BATATA INGLESA",
      erpCode: 101,
      purchaseFormat: "SC",
      reviewPending: true,
      costChanged: true,
      stalePurchase: false,
      status: "COST_CHANGED",
    } as unknown as PricingAnalysis;

    const itemReviewed = {
      id: "prod-1",
      name: "BATATA INGLESA",
      erpCode: 101,
      purchaseFormat: "SC",
      reviewPending: false,
      costChanged: false,
      stalePurchase: false,
      status: "REVIEWED",
    } as unknown as PricingAnalysis;

    const nextPending = {
      id: "prod-2",
      name: "CEBOLA NACIONAL",
      erpCode: 102,
      purchaseFormat: "SC",
      reviewPending: true,
      costChanged: true,
      stalePurchase: false,
      status: "COST_CHANGED",
    } as unknown as PricingAnalysis;

    // Antes da revisão: prod-1 e prod-2 estão em Custos alterados
    const listBefore = filterPricingAnalyses([itemPending, nextPending], "", "cost-changed");
    expect(listBefore.map((i) => i.id)).toEqual(["prod-1", "prod-2"]);

    // Após revisão do prod-1: prod-1 desaparece normalmente de Custos alterados
    // e o próximo produto (prod-2) fica no topo da lista sob o mesmo filtro cost-changed!
    const listAfter = filterPricingAnalyses([itemReviewed, nextPending], "", "cost-changed");
    expect(listAfter.map((i) => i.id)).toEqual(["prod-2"]);
  });

  it("14. todos os filtros existentes são suportados de forma bidirecional", () => {
    const allFilters: PricingFilter[] = ["all", "cost-changed", "stale-purchase", "not-reviewed", "reviewed"];
    for (const f of allFilters) {
      expect(isValidPricingFilter(f)).toBe(true);
      expect(parsePricingFilter(f)).toBe(f);
      const built = buildPricingListHref(f, "");
      if (f === "all") {
        expect(built).toBe("/gestor/precificacao");
      } else {
        expect(built).toBe(`/gestor/precificacao?filter=${f}`);
      }
    }
  });
});
