import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import { purchaseCycle } from "@/modules/ordering/repository";
import { persistPurchaseCost, readPurchaseCostStates } from "@/modules/purchasing/costs/repository";
import { loadPricingAnalysis, reviewPricingProduct } from "@/modules/pricing/analysis/service";
import { listPricingProducts, readPricingSettings, savePricingSettings, saveProductPricing } from "@/modules/pricing/parameters/service";
import { persistProducts } from "../../scripts/import-products";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("precificação no PostgreSQL", () => {
  const manager: Principal = { userId: "", role: "GESTOR", storeId: null };
  const buyer: Principal = { userId: "", role: "COMPRADOR", storeId: null };
  const store: Principal = { userId: "", role: "LOJA", storeId: "00000000-0000-0000-0000-000000000000" };
  let productId = "";
  const stamp = Date.now();

  beforeAll(async () => {
    const [managerUser, buyerUser] = await database().sql<{ id: string }[]>`
      INSERT INTO users(email, name, password_hash, role)
      VALUES (${`pricing-manager-${stamp}@example.com`}, 'Gestor Pricing', 'hash', 'GESTOR'),
             (${`pricing-buyer-${stamp}@example.com`}, 'Buyer Pricing', 'hash', 'COMPRADOR')
      RETURNING id
    `;
    manager.userId = managerUser.id;
    buyer.userId = buyerUser.id;
    const [product] = await database().sql<{ id: string }[]>`
      INSERT INTO products(erp_code, name, unit, purchase_format, markup, active)
      VALUES (${930000 + (stamp % 10000)}, 'REPOLHO PRECIFICAÇÃO', 'KG', 'CX', 0, true)
      RETURNING id
    `;
    productId = product.id;
    await database().sql`
      INSERT INTO product_pricing_parameters(product_id, sale_unit, conversion_quantity, conversion_origin, beneficiation_loss_percent)
      VALUES (${productId}, 'KG', 20, 'PROVISIONAL', 40)
    `;
  });

  afterAll(async () => { await database().sql.end(); });

  it("inicializa catálogo e configuração global sem sobrescrever manual", async () => {
    const [{ total, provisional, unitary }] = await database().sql<{ total: number; provisional: number; unitary: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE conversion_origin = 'PROVISIONAL')::int AS provisional,
             count(*) FILTER (WHERE conversion_origin = 'UNIT')::int AS unitary
      FROM product_pricing_parameters
    `;
    expect(total).toBeGreaterThanOrEqual(75);
    expect(provisional).toBeGreaterThan(0);
    expect(unitary).toBeGreaterThan(0);
    expect(await readPricingSettings(manager)).toMatchObject({ operatingCostPercent: "23.0000", defaultMarginPercent: "20.0000" });

    const current = await saveProductPricing(manager, { productId, saleUnit: "KG", conversionQuantity: "18", beneficiationLossPercent: "40", specificMarginPercent: "25", expectedVersion: 1 });
    expect(current).toMatchObject({ conversionQuantity: "18.000000", conversionOrigin: "MANUAL", specificMarginPercent: "25.0000", version: 2 });
    await persistProducts(process.env.DATABASE_URL!, [{ erpCode: 930000 + (stamp % 10000), name: "REPOLHO PRECIFICAÇÃO", unit: "KG", purchaseFormat: "CX", markup: 0, exclusiveSupplier: false }]);
    const preserved = (await listPricingProducts(manager)).find((product) => product.id === productId);
    expect(preserved).toMatchObject({ conversionQuantity: "18.000000", conversionOrigin: "MANUAL", version: 2 });
  });

  it("aplica concorrência e RBAC a parâmetros e configurações", async () => {
    await expect(saveProductPricing(manager, { productId, saleUnit: "KG", conversionQuantity: "20", beneficiationLossPercent: "20", specificMarginPercent: null, expectedVersion: 1 })).rejects.toThrow(/outra sessão/i);
    await expect(listPricingProducts(buyer)).rejects.toThrow(/Gestor/);
    await expect(listPricingProducts(store)).rejects.toThrow(/Gestor/);
    await expect(saveProductPricing(buyer, { productId, saleUnit: "KG", conversionQuantity: "18", beneficiationLossPercent: "40", specificMarginPercent: "25", expectedVersion: 2 })).rejects.toThrow(/Gestor/);
    const settings = await readPricingSettings(manager);
    await expect(savePricingSettings(store, { operatingCostPercent: "23", defaultMarginPercent: "20", expectedVersion: settings.version })).rejects.toThrow(/Gestor/);
    const updated = await savePricingSettings(manager, { operatingCostPercent: "23", defaultMarginPercent: "20", expectedVersion: settings.version });
    await expect(savePricingSettings(manager, { operatingCostPercent: "24", defaultMarginPercent: "20", expectedVersion: settings.version })).rejects.toThrow(/outra sessão/i);
    expect(updated.version).toBe(settings.version + 1);
  });

  it("persiste cost_is_unit atomicamente com o custo", async () => {
    const cycleDate = purchaseCycle().cycleDate;
    const saved = await persistPurchaseCost(buyer, { productId, cycleDate, cost: "5.00", costIsUnit: true, purchased: false, expectedVersion: 0 });
    expect(saved).toMatchObject({ cost: "5.00", costIsUnit: true, purchased: false, version: 1 });
    const [state] = await readPurchaseCostStates(buyer, [productId], cycleDate);
    expect(state).toMatchObject({ currentCost: "5.00", costIsUnit: true, purchased: false, version: 1 });
  });

  it("ignora draft, usa último custo oficial e registra revisão imutável", async () => {
    const cycleDate = purchaseCycle().cycleDate;
    const [draft] = await database().sql<{ version: number }[]>`
      SELECT version FROM purchase_cycle_product_costs WHERE product_id = ${productId} AND purchase_cycle_date = ${cycleDate}::date
    `;
    await database().sql`
      INSERT INTO purchase_cycle_product_costs(product_id, purchase_cycle_date, cost, cost_is_unit, purchased, purchased_at, updated_by)
      VALUES (${productId}, ${cycleDate}::date - 1, 40, false, true, now() - interval '1 day', ${manager.userId})
    `;
    const analysis = await loadPricingAnalysis(manager, productId);
    expect(analysis).toMatchObject({ stalePurchase: true, status: "NOT_REVIEWED", officialCost: { cost: "40.00", costIsUnit: false } });
    expect(analysis?.calculation).toBeTruthy();
    const review = await reviewPricingProduct(manager, { productId, expectedFingerprint: analysis!.fingerprint! });
    expect(review.id).toBeTruthy();
    expect((await loadPricingAnalysis(manager, productId))?.status).toBe("REVIEWED");
    await expect(database().sql`UPDATE pricing_reviews SET suggested_price = 99.99 WHERE id = ${review.id}`).rejects.toThrow(/imutáveis/);
    await expect(database().sql`DELETE FROM pricing_reviews WHERE id = ${review.id}`).rejects.toThrow(/imutáveis/);
    await persistPurchaseCost(buyer, { productId, cycleDate, cost: "8.00", costIsUnit: true, purchased: false, expectedVersion: draft.version });
    expect((await loadPricingAnalysis(manager, productId))?.status).toBe("REVIEWED");
    const historical = await database().sql<{ cycleDate: string; version: number }[]>`
      SELECT purchase_cycle_date::text AS "cycleDate", version FROM purchase_cycle_product_costs
      WHERE product_id = ${productId} AND purchased ORDER BY purchase_cycle_date DESC LIMIT 1
    `;
    await persistPurchaseCost(buyer, { productId, cycleDate: historical[0].cycleDate, cost: "45.00", costIsUnit: false, purchased: true, expectedVersion: historical[0].version });
    expect((await loadPricingAnalysis(manager, productId))?.status).toBe("COST_CHANGED");
  });
});
