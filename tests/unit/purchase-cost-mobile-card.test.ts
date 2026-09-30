import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { PurchaseCostsWorkspace } from "@/modules/purchasing/cost-workspace";
import type { PurchaseCostsData } from "@/modules/purchasing/costs/domain";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@/modules/purchasing/costs/actions", () => ({
  savePurchaseCostAction: vi.fn(),
}));

const mockData: PurchaseCostsData = {
  cycleDate: "2026-09-23",
  cycles: ["2026-09-22", "2026-09-23"],
  loadedAt: "2026-09-23T10:00:00.000Z",
  stores: [
    { id: "s1", slug: "ponta-da-fruta", name: "MultiShow Ponta da Fruta", order: null },
    { id: "s2", slug: "balneario", name: "MultiShow Balneário", order: null },
    { id: "s3", slug: "santa-monica", name: "MultiShow Santa Mônica", order: null },
  ],
  products: [
    {
      id: "prod-banana",
      erpCode: 101,
      name: "BANANA PRATA",
      purchaseFormat: "CX",
      active: true,
      exclusiveSupplier: true,
      currentCost: "70.00",
      inheritedCost: false,
      costIsUnit: true,
      purchased: true,
      version: 3,
      updatedAt: "2026-09-23T10:00:00.000Z",
      previousCost: "75.00",
      previousCycleDate: "2026-09-22",
      total: "23",
      photoKey: "products/prod-banana/photo-1.webp",
      photoUpdatedAt: "2026-09-23T10:00:00.000Z",
      imageUrl: null,
      stores: {
        s1: { quantity: "10.00", stock: "0.00" },
        s2: { quantity: "5.00", stock: "0.00" },
        s3: { quantity: "8.00", stock: "0.00" },
      },
    },
    {
      id: "prod-abacate",
      erpCode: 102,
      name: "ABACATE KG",
      purchaseFormat: "KG",
      active: true,
      exclusiveSupplier: false,
      currentCost: null,
      inheritedCost: false,
      costIsUnit: false,
      purchased: false,
      version: 1,
      updatedAt: null,
      previousCost: null,
      previousCycleDate: null,
      total: "15",
      photoKey: null,
      photoUpdatedAt: null,
      imageUrl: null,
      stores: {
        s1: { quantity: "5.00", stock: "0.00" },
        s2: { quantity: "5.00", stock: "0.00" },
        s3: { quantity: "5.00", stock: "0.00" },
      },
    },
  ],
};

describe("Layout Mobile Aprovado — Comprador → Lançamento de Custos", () => {
  it("renderiza os cards mobile com a estrutura e ordem visual aprovadas", () => {
    const html = renderToString(React.createElement(PurchaseCostsWorkspace, { data: mockData }));

    // 1. Verifica presença dos cards mobile
    expect(html).toContain("cost-mobile-list");
    expect(html).toContain("cost-card");

    // 2. Área superior: resumo do produto e destaque do Total com formato
    const cleanHtml = html.replace(/<!--.*?-->/g, "");
    expect(html).toContain("cost-card-summary");
    expect(html).toContain("cost-card-info");
    expect(html).toContain("cost-store-badges");
    expect(html).toContain("cost-total-badge");
    expect(cleanHtml).toContain("Total 23 CX");
    expect(cleanHtml).toContain("Total 15 KG");

    // 3. Unidade/formato isolada foi removida do canto superior direito do header do card mobile
    const mobileCardProductRegex = /<header class="cost-card-product">([\s\S]*?)<\/header>/;
    const match = html.match(mobileCardProductRegex);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain("<strong>CX</strong>");
    expect(match![1]).not.toContain("<strong>KG</strong>");

    // 4. Badge EXCLUSIVO quando aplicável
    expect(html).toContain("EXCLUSIVO");

    // 5. Linha inferior do card: ordem visual aprovada
    // 1. Custo unitário → 2. Custo anterior → 3. Comprado → 4. Campo de custo atual
    const idxMobileList = html.indexOf('class="cost-mobile-list"');
    expect(idxMobileList).toBeGreaterThan(-1);
    const mobileHtml = html.slice(idxMobileList);

    const idxUnit = mobileHtml.indexOf("cost-card-field-unit");
    const idxPrev = mobileHtml.indexOf("cost-previous-field");
    const idxPurchased = mobileHtml.indexOf("cost-card-field-purchased");
    const idxCurrent = mobileHtml.indexOf("cost-current-field");

    expect(idxUnit).toBeGreaterThan(-1);
    expect(idxPrev).toBeGreaterThan(-1);
    expect(idxPurchased).toBeGreaterThan(-1);
    expect(idxCurrent).toBeGreaterThan(-1);

    // Valida sequência estrita
    expect(idxUnit).toBeLessThan(idxPrev);
    expect(idxPrev).toBeLessThan(idxPurchased);
    expect(idxPurchased).toBeLessThan(idxCurrent);

    // 6. Texto do toggle no card mobile deve ser 'Custo unitário' (não 'Custo informado é unitário')
    const mobileUnitSection = mobileHtml.slice(idxUnit, idxPrev);
    expect(mobileUnitSection).toContain("Custo unitário");
    expect(mobileUnitSection).not.toContain("Custo informado é unitário");

    // 7. Custo anterior compacto com 'Ant.'
    const mobilePrevSection = mobileHtml.slice(idxPrev, idxPurchased);
    expect(mobilePrevSection).toContain("Ant.");
    expect(mobilePrevSection).toContain("75,00");

    // 8. Campo atual contém 'Atual' e input
    const mobileCurrentSection = mobileHtml.slice(idxCurrent);
    expect(mobileCurrentSection).toContain("Atual");
    expect(mobileCurrentSection).toMatch(/inputmode="decimal"/i);

    // 9. No desktop (tabela), o layout original com 'Custo informado é unitário' é preservado
    expect(html).toContain("cost-table");
    expect(html).toContain("Custo informado é unitário");
  });
});
