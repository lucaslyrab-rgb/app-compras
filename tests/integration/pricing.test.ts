import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import { currentPurchaseCycle } from "@/modules/ordering/calendar/service";
import { persistPurchaseCost, readPurchaseCostStates } from "@/modules/purchasing/costs/repository";
import { setProductActive } from "@/modules/catalog/repository";
import { pricingPrintRows } from "@/modules/pricing/analysis/domain";
import { loadPricingAnalyses, loadPricingAnalysis, loadPricingReviewDecisions, reviewPricingProduct } from "@/modules/pricing/analysis/service";
import { createProduct, listPricingProducts, readPricingSettings, savePricingSettings, saveProductPricing } from "@/modules/pricing/parameters/service";
import { persistProducts } from "../../scripts/import-products";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("precificação no PostgreSQL", () => {
  const manager: Principal = { userId: "", role: "GESTOR", storeId: null };
  const buyer: Principal = { userId: "", role: "COMPRADOR", storeId: null };
  const store: Principal = { userId: "", role: "LOJA", storeId: "00000000-0000-0000-0000-000000000000" };
  let productId = "";
  let secondProductId = "";
  let noCostProductId = "";
  let manualProductId = "";
  let reportProductId = "";
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
    const [manualProduct] = await database().sql<{ id: string }[]>`
      INSERT INTO products(erp_code, name, unit, purchase_format, markup, active)
      VALUES (${960000 + (stamp % 10000)}, 'BATATA DECISÃO COMERCIAL', 'KG', 'CX', 0, true)
      RETURNING id
    `;
    manualProductId = manualProduct.id;
    const [reportProduct] = await database().sql<{ id: string }[]>`
      INSERT INTO products(erp_code, name, unit, purchase_format, markup, active)
      VALUES (${970000 + (stamp % 10000)}, 'ABACATE ALTERAÇÃO DA RODADA', 'KG', 'CX', 0, true)
      RETURNING id
    `;
    reportProductId = reportProduct.id;
    await database().sql`
      INSERT INTO product_pricing_parameters(product_id, sale_unit, conversion_quantity, conversion_origin, beneficiation_loss_percent)
      VALUES (${productId}, 'KG', 20, 'PROVISIONAL', 40),
             (${secondProductId}, 'UND', 1, 'UNIT', 0),
             (${noCostProductId}, 'KG', 20, 'PROVISIONAL', 0),
             (${manualProductId}, 'KG', 20, 'MANUAL', 0),
             (${reportProductId}, 'KG', 20, 'MANUAL', 0)
    `;
    await database().sql`
      UPDATE pricing_settings
      SET operating_cost_percent = '23.00', default_margin_percent = '20.00', version = 1
      WHERE id = 'FLV'
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

    const master = (await listPricingProducts(manager)).find((product) => product.id === productId)!;
    const current = await saveProductPricing(manager, { productId, erpCode: master.erpCode, name: master.name, catalogUnit: master.catalogUnit, purchaseFormat: master.purchaseFormat, exclusiveSupplier: master.exclusiveSupplier, saleUnit: "KG", conversionQuantity: "18", beneficiationLossPercent: "40", specificMarginPercent: "25", expectedVersion: 1, expectedProductVersion: master.productVersion, confirmedFormatConversion: false });
    expect(current).toMatchObject({ conversionQuantity: "18.000000", conversionOrigin: "MANUAL", specificMarginPercent: "25.0000", version: 2 });
    await persistProducts(process.env.DATABASE_URL!, [{ erpCode: 930000 + (stamp % 10000), name: "REPOLHO PRECIFICAÇÃO", unit: "KG", purchaseFormat: "CX", markup: 0, exclusiveSupplier: false }]);
    const preserved = (await listPricingProducts(manager)).find((product) => product.id === productId);
    expect(preserved).toMatchObject({ conversionQuantity: "18.000000", conversionOrigin: "MANUAL", version: 2 });
  });

  it("aplica concorrência e RBAC a parâmetros e configurações", async () => {
    const master = (await listPricingProducts(manager)).find((product) => product.id === productId)!;
    await expect(saveProductPricing(manager, { productId, erpCode: master.erpCode, name: master.name, catalogUnit: master.catalogUnit, purchaseFormat: master.purchaseFormat, exclusiveSupplier: master.exclusiveSupplier, saleUnit: "KG", conversionQuantity: "20", beneficiationLossPercent: "20", specificMarginPercent: null, expectedVersion: 1, expectedProductVersion: master.productVersion, confirmedFormatConversion: false })).rejects.toThrow(/outra sessão/i);
    await expect(listPricingProducts(buyer)).rejects.toThrow(/Gestor/);
    await expect(listPricingProducts(store)).rejects.toThrow(/Gestor/);
    await expect(saveProductPricing(buyer, { productId, erpCode: master.erpCode, name: master.name, catalogUnit: master.catalogUnit, purchaseFormat: master.purchaseFormat, exclusiveSupplier: master.exclusiveSupplier, saleUnit: "KG", conversionQuantity: "18", beneficiationLossPercent: "40", specificMarginPercent: "25", expectedVersion: 2, expectedProductVersion: master.productVersion, confirmedFormatConversion: false })).rejects.toThrow(/Gestor/);
    const settings = await readPricingSettings(manager);
    await expect(savePricingSettings(store, { operatingCostPercent: "23", defaultMarginPercent: "20", expectedVersion: settings.version })).rejects.toThrow(/Gestor/);
    const updated = await savePricingSettings(manager, { operatingCostPercent: "23", defaultMarginPercent: "20", expectedVersion: settings.version });
    await expect(savePricingSettings(manager, { operatingCostPercent: "24", defaultMarginPercent: "20", expectedVersion: settings.version })).rejects.toThrow(/outra sessão/i);
    expect(updated.version).toBe(settings.version + 1);
  });

  it("cadastra, edita e ativa produtos sem alterar snapshots históricos", async () => {
    const erpCode = 980000 + (stamp % 10000);
    const created = await createProduct(manager, {
      erpCode, name: "produto gerencial", catalogUnit: "kg", purchaseFormat: "cx", exclusiveSupplier: true,
      saleUnit: "kg", conversionQuantity: "12", beneficiationLossPercent: "5", specificMarginPercent: null,
    });
    expect(created).toMatchObject({ erpCode, name: "PRODUTO GERENCIAL", catalogUnit: "KG", purchaseFormat: "CX", active: true, productVersion: 1, version: 1, conversionOrigin: "MANUAL", photoKey: null });
    const [{ markup, costs, reviews }] = await database().sql<{ markup: string; costs: number; reviews: number }[]>`
      SELECT p.markup::text AS markup,
        (SELECT count(*)::int FROM purchase_cycle_product_costs WHERE product_id = p.id) AS costs,
        (SELECT count(*)::int FROM pricing_reviews WHERE product_id = p.id) AS reviews
      FROM products p WHERE p.id = ${created.id}`;
    expect({ markup, costs, reviews }).toEqual({ markup: "0.00", costs: 0, reviews: 0 });
    await expect(createProduct(manager, {
      erpCode, name: "duplicado", catalogUnit: "KG", purchaseFormat: "CX", exclusiveSupplier: false,
      saleUnit: "KG", conversionQuantity: "1", beneficiationLossPercent: "0", specificMarginPercent: null,
    })).rejects.toThrow(/ERP/i);

    await expect(saveProductPricing(manager, {
      productId: created.id, erpCode, name: created.name, catalogUnit: created.catalogUnit, purchaseFormat: "SC",
      exclusiveSupplier: created.exclusiveSupplier, saleUnit: "KG", conversionQuantity: "15", beneficiationLossPercent: "5",
      specificMarginPercent: null, expectedVersion: 1, expectedProductVersion: 1, confirmedFormatConversion: false,
    })).rejects.toThrow(/conversão/i);
    const updated = await saveProductPricing(manager, {
      productId: created.id, erpCode: erpCode + 1, name: "produto gerencial editado", catalogUnit: "UND", purchaseFormat: "SC",
      exclusiveSupplier: false, saleUnit: "KG", conversionQuantity: "15", beneficiationLossPercent: "6",
      specificMarginPercent: "24", expectedVersion: 1, expectedProductVersion: 1, confirmedFormatConversion: true,
    });
    expect(updated).toMatchObject({ erpCode: erpCode + 1, name: "PRODUTO GERENCIAL EDITADO", catalogUnit: "UND", purchaseFormat: "SC", exclusiveSupplier: false, conversionQuantity: "15.000000", productVersion: 2, version: 2 });
    await expect(saveProductPricing(manager, {
      productId: created.id, erpCode, name: created.name, catalogUnit: created.catalogUnit, purchaseFormat: created.purchaseFormat,
      exclusiveSupplier: false, saleUnit: "KG", conversionQuantity: "12", beneficiationLossPercent: "5",
      specificMarginPercent: null, expectedVersion: 1, expectedProductVersion: 1, confirmedFormatConversion: false,
    })).rejects.toThrow(/outra sessão/i);

    const [storeRow] = await database().sql<{ id: string }[]>`SELECT id FROM stores ORDER BY id LIMIT 1`;
    const [draft] = await database().sql<{ id: string }[]>`
      INSERT INTO order_drafts(store_id, order_date, updated_by) VALUES (${storeRow.id}, '2040-01-02', ${manager.userId}) RETURNING id`;
    await database().sql`INSERT INTO order_draft_items(draft_id, product_id, stock, quantity) VALUES (${draft.id}, ${created.id}, 1, 0)`;
    await expect(setProductActive(manager, created.id, false, updated.productVersion)).rejects.toThrow(/rascunho/i);
    await database().sql`DELETE FROM order_draft_items WHERE draft_id = ${draft.id} AND product_id = ${created.id}`;
    const inactive = await setProductActive(manager, created.id, false, updated.productVersion);
    expect(inactive.active).toBe(false);
    const active = await setProductActive(manager, created.id, true, inactive.version);
    expect(active.active).toBe(true);

    const [order] = await database().sql<{ id: string }[]>`
      INSERT INTO orders(store_id, order_date, purchase_cycle_date, cutoff_at, revision, submitted_by)
      VALUES (${storeRow.id}, '2040-01-03', '2040-01-04', '2040-01-03T12:00:00Z', 1, ${manager.userId}) RETURNING id`;
    await database().sql`INSERT INTO order_items(order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}, ${created.id}, 0, 1, ${erpCode + 1}, 'PRODUTO GERENCIAL EDITADO', 'UND')`;
    const latest = (await listPricingProducts(manager)).find((product) => product.id === created.id)!;
    await saveProductPricing(manager, { productId: latest.id, erpCode: latest.erpCode, name: "NOVO NOME", catalogUnit: "KG", purchaseFormat: latest.purchaseFormat,
      exclusiveSupplier: latest.exclusiveSupplier, saleUnit: latest.saleUnit, conversionQuantity: latest.conversionQuantity,
      beneficiationLossPercent: latest.beneficiationLossPercent, specificMarginPercent: latest.specificMarginPercent,
      expectedVersion: latest.version, expectedProductVersion: latest.productVersion, confirmedFormatConversion: false });
    const [snapshot] = await database().sql<{ erp: number; name: string; unit: string }[]>`
      SELECT snapshot_erp_code AS erp, snapshot_name AS name, snapshot_unit AS unit FROM order_items WHERE order_id = ${order.id} AND product_id = ${created.id}`;
    expect(snapshot).toEqual({ erp: erpCode + 1, name: "PRODUTO GERENCIAL EDITADO", unit: "UND" });
  });

  it("importador preserva cadastro gerenciado por padrão", async () => {
    const erpCode = 990000 + (stamp % 10000);
    const created = await createProduct(manager, { erpCode, name: "NOME MANUAL", catalogUnit: "KG", purchaseFormat: "CX", exclusiveSupplier: true,
      saleUnit: "KG", conversionQuantity: "7", beneficiationLossPercent: "2", specificMarginPercent: null });
    await persistProducts(process.env.DATABASE_URL!, [{ erpCode, name: "NOME DA PLANILHA", unit: "UND", purchaseFormat: "PCT", markup: 99, exclusiveSupplier: false }]);
    const preserved = (await listPricingProducts(manager)).find((product) => product.id === created.id)!;
    expect(preserved).toMatchObject({ name: "NOME MANUAL", catalogUnit: "KG", purchaseFormat: "CX", exclusiveSupplier: true, conversionQuantity: "7.000000", productVersion: 1, version: 1 });
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
    const review = await reviewPricingProduct(manager, { productId, expectedFingerprint: analysis!.fingerprint!, decidedPrice: "6.49" }, friday);
    expect(review.id).toBeTruthy();
    expect(review.appliedPrice).toBe("6.49");
    expect(review.decidedPrice).toBe("6.49");
    expect((await loadPricingAnalysis(manager, productId, friday))?.status).toBe("REVIEWED");
    const [storedReview] = await database().sql<{ suggestedPrice: string; appliedPrice: string; decidedPrice: string; decisionOrigin: string }[]>`
      SELECT suggested_price::text AS "suggestedPrice", applied_price::text AS "appliedPrice",
             decided_price::text AS "decidedPrice", decision_origin AS "decisionOrigin"
      FROM pricing_reviews WHERE id = ${review.id}
    `;
    expect(storedReview).toMatchObject({ appliedPrice: "6.49", decidedPrice: "6.49", decisionOrigin: "MANUAL" });
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

  it("imprime somente a mudança de custo revisada da rodada atual", async () => {
    const friday = new Date("2026-09-25T10:00:00-03:00");
    const monday = new Date("2026-09-28T10:00:00-03:00");
    await database().sql`
      INSERT INTO purchase_cycle_product_costs(product_id, purchase_cycle_date, cost, cost_is_unit, purchased, purchased_at, updated_by)
      VALUES (${reportProductId}, '2026-09-24', 50, false, true, now() - interval '2 days', ${manager.userId}),
             (${reportProductId}, '2026-09-25', 60, false, true, now() - interval '1 day', ${manager.userId})
    `;
    const pending = await loadPricingAnalysis(manager, reportProductId, friday);
    expect(pending).toMatchObject({ status: "COST_CHANGED", referenceCycleDate: "2026-09-25" });
    expect(pricingPrintRows(await loadPricingAnalyses(manager, friday)).some((row) => row.productId === reportProductId)).toBe(false);

    const review = await reviewPricingProduct(manager, {
      productId: reportProductId,
      expectedFingerprint: pending!.fingerprint!,
      decidedPrice: "9.99",
    }, friday);
    const reviewedRows = pricingPrintRows(await loadPricingAnalyses(manager, friday));
    expect(reviewedRows).toContainEqual(expect.objectContaining({
      reviewId: review.id,
      productId: reportProductId,
      decidedPrice: "9.99",
      decisionOrigin: "MANUAL",
    }));

    await database().sql`
      INSERT INTO purchase_cycle_product_costs(product_id, purchase_cycle_date, cost, cost_is_unit, purchased, purchased_at, updated_by)
      VALUES (${reportProductId}, '2026-09-28', 60, false, true, now(), ${manager.userId})
    `;
    const nextCycle = await loadPricingAnalysis(manager, reportProductId, monday);
    expect(nextCycle).toMatchObject({ status: "REVIEWED", referenceCycleDate: "2026-09-28" });
    expect(pricingPrintRows(await loadPricingAnalyses(manager, monday)).some((row) => row.productId === reportProductId)).toBe(false);
  });

  it("persiste decisão manual sem mudança de custo sem levá-la ao relatório da rodada", async () => {
    const friday = new Date("2026-09-25T10:00:00-03:00");
    await database().sql`
      INSERT INTO purchase_cycle_product_costs(product_id, purchase_cycle_date, cost, cost_is_unit, purchased, purchased_at, updated_by)
      VALUES (${manualProductId}, '2026-09-24', 100, false, true, now() - interval '2 days', ${manager.userId}),
             (${manualProductId}, '2026-09-25', 100, false, true, now() - interval '1 day', ${manager.userId})
    `;
    const before = await loadPricingAnalysis(manager, manualProductId, friday);
    expect(before).toMatchObject({ status: "NOT_REVIEWED", costChanged: false, officialCost: { cost: "100.00" } });
    await expect(reviewPricingProduct(manager, {
      productId: manualProductId,
      expectedFingerprint: `${before!.fingerprint!}-stale`,
      decidedPrice: "7.99",
    }, friday)).rejects.toThrow(/mudaram/i);

    const manual = await reviewPricingProduct(manager, {
      productId: manualProductId,
      expectedFingerprint: before!.fingerprint!,
      decidedPrice: "7.99",
    }, friday);
    expect(manual).toMatchObject({ decidedPrice: "7.99", decisionOrigin: "MANUAL" });
    const after = await loadPricingAnalysis(manager, manualProductId, friday);
    expect(after).toMatchObject({
      status: "REVIEWED",
      latestReview: { id: manual.id, decidedPrice: "7.99", decisionOrigin: "MANUAL" },
    });
    const [printDecision] = await loadPricingReviewDecisions(manager, [manual.id]);
    expect(printDecision).toMatchObject({
      id: manual.id,
      productId: manualProductId,
      decidedPrice: "7.99",
      decisionOrigin: "MANUAL",
    });
    expect(printDecision.decidedPrice).not.toBe(printDecision.suggestedPrice);
    expect(pricingPrintRows(await loadPricingAnalyses(manager, friday)).some((row) => row.productId === manualProductId)).toBe(false);

    const accepted = await reviewPricingProduct(manager, {
      productId: manualProductId,
      expectedFingerprint: after!.fingerprint!,
      decidedPrice: after!.calculation!.suggestedPrice,
    }, friday);
    expect(accepted).toMatchObject({
      decidedPrice: after!.calculation!.suggestedPrice,
      decisionOrigin: "SUGGESTED",
    });
  });

  it("mantém compatibilidade com revisões históricas sem decisão explícita", async () => {
    const friday = new Date("2026-09-25T10:00:00-03:00");
    const current = await loadPricingAnalysis(manager, manualProductId, friday);
    const [legacy] = await database().sql<{ id: string }[]>`
      INSERT INTO pricing_reviews (
        product_id, official_cost_id, official_cost_version,
        official_purchase_cycle_date, official_cost, cost_is_unit,
        sale_unit, conversion_quantity, conversion_origin,
        beneficiation_loss_percent, parameter_version,
        operating_cost_percent, desired_margin_percent, margin_origin,
        settings_version, gross_unit_cost, effective_unit_cost,
        calculated_price, suggested_price, input_fingerprint,
        reviewed_by, reviewed_at
      )
      SELECT product_id, official_cost_id, official_cost_version,
             official_purchase_cycle_date, official_cost, cost_is_unit,
             sale_unit, conversion_quantity, conversion_origin,
             beneficiation_loss_percent, parameter_version,
             operating_cost_percent, desired_margin_percent, margin_origin,
             settings_version, gross_unit_cost, effective_unit_cost,
             calculated_price, suggested_price, input_fingerprint,
             reviewed_by, now() + interval '1 second'
      FROM pricing_reviews
      WHERE id = ${current!.latestReview!.id}
      RETURNING id
    `;
    const reloaded = await loadPricingAnalysis(manager, manualProductId, friday);
    expect(reloaded?.latestReview).toMatchObject({
      id: legacy.id,
      appliedPrice: null,
      decidedPrice: null,
      decisionOrigin: null,
    });
    expect(reloaded?.reviewPending).toBe(true);
    expect(reloaded?.status).toBe("NOT_REVIEWED");

    const [printDecision] = await loadPricingReviewDecisions(manager, [legacy.id]);
    expect(printDecision).toMatchObject({
      id: legacy.id,
      decidedPrice: null,
      decisionOrigin: null,
    });

    // Caminho completo Repository -> Domain -> UI/Relatório
    const allAnalyses = await loadPricingAnalyses(manager, friday);
    const pendingItem = allAnalyses.find((a) => a.id === manualProductId);
    expect(pendingItem?.reviewPending).toBe(true);
    expect(pendingItem?.status).toBe("NOT_REVIEWED");
    expect(pendingItem?.latestReview?.decidedPrice).toBeNull();
    expect(pricingPrintRows(allAnalyses).some((row) => row.productId === manualProductId)).toBe(false);
  });
});
