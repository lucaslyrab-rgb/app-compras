import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import { currentPurchaseCycle } from "@/modules/ordering/calendar/service";
import { persistPurchaseCost, readPurchaseCostStates } from "@/modules/purchasing/costs/repository";
import { loadPricingAnalyses, loadPricingAnalysis, reviewPricingProduct } from "@/modules/pricing/analysis/service";
import { listPricingProducts, readPricingSettings, savePricingSettings, saveProductPricing } from "@/modules/pricing/parameters/service";
import { persistProducts } from "../../scripts/import-products";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("precificação no PostgreSQL", () => {
  const manager: Principal = { userId: "", role: "GESTOR", storeId: null };
  const buyer: Principal = { userId: "", role: "COMPRADOR", storeId: null };
  const store: Principal = { userId: "", role: "LOJA", storeId: "00000000-0000-0000-0000-000000000000" };
  let productId = "";
  let secondProductId = "";
  let noCostProductId = "";
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
    const [secondProduct] = await database().sql<{ id: string }[]>`
      INSERT INTO products(erp_code, name, unit, purchase_format, markup, active)
      VALUES (${940000 + (stamp % 10000)}, 'ALFACE PRECIFICAÇÃO', 'UND', 'UND', 0, true)
      RETURNING id
    `;
    secondProductId = secondProduct.id;
    const [noCostProduct] = await database().sql<{ id: string }[]>`
      INSERT INTO products(erp_code, name, unit, purchase_format, markup, active)
      VALUES (${950000 + (stamp % 10000)}, 'BETERRABA PRECIFICAÇÃO', 'KG', 'CX', 0, true)
      RETURNING id
    `;
    noCostProductId = noCostProduct.id;
    await database().sql`
      INSERT INTO product_pricing_parameters(product_id, sale_unit, conversion_quantity, conversion_origin, beneficiation_loss_percent)
      VALUES (${productId}, 'KG', 20, 'PROVISIONAL', 40),
             (${secondProductId}, 'UND', 1, 'UNIT', 0),
             (${noCostProductId}, 'KG', 20, 'PROVISIONAL', 0)
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
    const cycleDate = (await currentPurchaseCycle(new Date("2026-09-25T18:00:00.000Z"))).cycleDate;
    expect(cycleDate).toBe("2026-09-28");
    const saved = await persistPurchaseCost(buyer, { productId, cycleDate, cost: "5.00", costIsUnit: true, purchased: false, expectedVersion: 0 });
    expect(saved).toMatchObject({ cost: "5.00", costIsUnit: true, purchased: false, version: 1 });
    const [state] = await readPurchaseCostStates(buyer, [productId], cycleDate);
    expect(state).toMatchObject({ currentCost: "5.00", costIsUnit: true, purchased: false, version: 1 });
  });

  it("mantém o custo oficial anterior diante de draft e troca somente após a compra", async () => {
    const friday = new Date("2026-09-25T18:00:00.000Z");
    const saturday = new Date("2026-09-26T18:00:00.000Z");
    const monday = new Date("2026-09-28T18:00:00.000Z");
    const cycleDate = (await currentPurchaseCycle(friday)).cycleDate;
    expect(cycleDate).toBe("2026-09-28");
    const [draft] = await database().sql<{ version: number }[]>`
      SELECT version FROM purchase_cycle_product_costs WHERE product_id = ${productId} AND purchase_cycle_date = ${cycleDate}::date
    `;
    await database().sql`
      INSERT INTO purchase_cycle_product_costs(product_id, purchase_cycle_date, cost, cost_is_unit, purchased, purchased_at, updated_by)
      VALUES (${productId}, '2026-09-25', 40, false, true, now() - interval '1 day', ${manager.userId})
    `;
    const analysis = await loadPricingAnalysis(manager, productId, friday);
    expect(analysis).toMatchObject({
      referenceCycleDate: "2026-09-25",
      stalePurchase: false,
      status: "COST_CHANGED",
      costChanged: true,
      reviewPending: true,
      officialCost: { cost: "40.00", costIsUnit: false, cycleDate: "2026-09-25" },
    });
    expect(analysis?.calculation).toBeTruthy();
    const review = await reviewPricingProduct(manager, { productId, expectedFingerprint: analysis!.fingerprint!, appliedPrice: "6.49" }, friday);
    expect(review.id).toBeTruthy();
    expect(review.appliedPrice).toBe("6.49");
    expect((await loadPricingAnalysis(manager, productId, friday))?.status).toBe("REVIEWED");
    const [storedReview] = await database().sql<{ suggestedPrice: string; appliedPrice: string }[]>`
      SELECT suggested_price::text AS "suggestedPrice", applied_price::text AS "appliedPrice"
      FROM pricing_reviews WHERE id = ${review.id}
    `;
    expect(storedReview).toMatchObject({ appliedPrice: "6.49" });
    expect(storedReview.suggestedPrice).not.toBe(storedReview.appliedPrice);
    await expect(database().sql`UPDATE pricing_reviews SET suggested_price = 99.99 WHERE id = ${review.id}`).rejects.toThrow(/imutáveis/);
    await expect(database().sql`DELETE FROM pricing_reviews WHERE id = ${review.id}`).rejects.toThrow(/imutáveis/);
    const draftUpdated = await persistPurchaseCost(buyer, { productId, cycleDate, cost: "8.00", costIsUnit: true, purchased: false, expectedVersion: draft.version });
    const stillCurrent = await loadPricingAnalysis(manager, productId, saturday);
    expect(stillCurrent).toMatchObject({
      referenceCycleDate: "2026-09-25",
      status: "REVIEWED",
      stalePurchase: false,
      officialCost: { cost: "40.00", cycleDate: "2026-09-25" },
    });

    await database().sql`
      INSERT INTO purchase_cycle_product_costs(product_id, purchase_cycle_date, cost, cost_is_unit, purchased, purchased_at, updated_by)
      VALUES (${secondProductId}, '2026-09-24', 3, true, true, now() - interval '2 days', ${manager.userId}),
             (${secondProductId}, '2026-09-29', 999, true, true, now(), ${manager.userId})
    `;
    const beforePurchase = await loadPricingAnalyses(manager, friday);
    expect(beforePurchase.find((item) => item.id === productId)).toMatchObject({
      referenceCycleDate: "2026-09-25",
      stalePurchase: false,
      officialCost: { cycleDate: "2026-09-25" },
    });
    expect(beforePurchase.find((item) => item.id === secondProductId)).toMatchObject({
      referenceCycleDate: "2026-09-25",
      stalePurchase: true,
      officialCost: { cost: "3.00", cycleDate: "2026-09-24" },
    });
    expect(beforePurchase.find((item) => item.id === noCostProductId)).toMatchObject({
      referenceCycleDate: "2026-09-25",
      stalePurchase: false,
      status: "NO_COST",
      officialCost: null,
    });

    await persistPurchaseCost(buyer, { productId, cycleDate, cost: "8.00", costIsUnit: true, purchased: true, expectedVersion: draftUpdated.version });
    expect(await loadPricingAnalysis(manager, productId, friday)).toMatchObject({
      referenceCycleDate: "2026-09-25",
      stalePurchase: false,
      officialCost: { cost: "40.00", cycleDate: "2026-09-25" },
    });

    const afterPurchase = await loadPricingAnalyses(manager, monday);
    expect(afterPurchase.find((item) => item.id === productId)).toMatchObject({
      status: "PARAMETERS_CHANGED",
      costChanged: true,
      parametersChanged: true,
      reviewPending: true,
      referenceCycleDate: "2026-09-28",
      stalePurchase: false,
      officialCost: { cost: "8.00", costIsUnit: true, cycleDate },
    });
    expect(afterPurchase.find((item) => item.id === secondProductId)).toMatchObject({
      referenceCycleDate: "2026-09-28",
      stalePurchase: true,
      officialCost: { cost: "3.00", costIsUnit: true, cycleDate: "2026-09-24" },
    });
  });
});
