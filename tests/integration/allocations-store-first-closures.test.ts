import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  closeBuyerCycle,
  closeStoreCycle,
  concludeSupplierStoreReview,
  getSupplierEligibleProductIds,
  readBuyerAllocationWorkspace,
  reopenStoreCycle,
  revertProductSupplierDecision,
  resolveParticipatingStores,
  saveSupplierAllocations,
  setProductSupplierDecision,
} from "../../src/modules/purchasing/allocations/repository";
import {
  AllocationDestinationConflictError,
  AllocationValidationError,
  BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE,
  CycleClosedError,
  ExclusivityViolationError,
  type CloseStoreCycleInput,
} from "../../src/modules/purchasing/allocations/domain";
import { persistPurchaseCost } from "../../src/modules/purchasing/costs/repository";
import type { Principal } from "../../src/modules/identity";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Fase 3: Testes de Integração — Experiência Operacional Store-First e Fechamentos", () => {
  const stamp = Date.now();
  const testDbName = `test_db_store_first_${stamp}`;
  let baseDatabaseUrl: string;
  let testDatabaseUrl: string;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  const buyerPrincipal: Principal = {
    userId: "00000000-0000-0000-0000-000000000001",
    role: "COMPRADOR",
    storeId: null,
    permissions: ["compras:destinacao", "compras:custos", "compras:consolidado", "compras:fornecedores"],
  };

  beforeAll(async () => {
    baseDatabaseUrl = process.env.DATABASE_URL!;
    adminClient = postgres(baseDatabaseUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);

    const url = new URL(baseDatabaseUrl);
    url.pathname = `/${testDbName}`;
    testDatabaseUrl = url.toString();

    // Roda todas as migrations de 0001 a 0016
    await runMigrations({
      databaseUrl: testDatabaseUrl,
      migrationsDirectory: path.resolve("migrations"),
    });

    db = postgres(testDatabaseUrl, { max: 5 });
    process.env.DATABASE_URL = testDatabaseUrl;

    // Usuário comprador para constraints de auditoria
    await db`
      INSERT INTO users (id, name, email, password_hash, role, active, permissions)
      VALUES (
        ${buyerPrincipal.userId}::uuid,
        'Comprador Teste',
        'buyer@test.com',
        'hash123',
        'COMPRADOR',
        true,
        ARRAY['compras:destinacao', 'compras:custos', 'compras:fornecedores']::text[]
      )
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
    if (db) await db.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
      await adminClient.end();
    }
    process.env.DATABASE_URL = baseDatabaseUrl;
  });

  async function closeStoreWithPreview(
    principal: Principal,
    cycle: string,
    storeId: string,
    override?: Partial<CloseStoreCycleInput>,
  ) {
    const ws = await readBuyerAllocationWorkspace(principal, cycle, null, storeId);
    const sc = ws.storeClosures[storeId];
    return await closeStoreCycle(principal, {
      cycleDate: cycle,
      storeId,
      expectedOrderId: override?.expectedOrderId !== undefined ? override.expectedOrderId : sc.previewOrderId,
      expectedOrderRevision: override?.expectedOrderRevision !== undefined ? override.expectedOrderRevision : sc.previewOrderRevision,
      expectedAllocationsHash: override?.expectedAllocationsHash !== undefined ? override.expectedAllocationsHash : sc.previewAllocationsHash,
      expectedCostsHash: override?.expectedCostsHash !== undefined ? override.expectedCostsHash : sc.previewCostsHash,
    });
  }

  it("1 e 2. CENÁRIO REAL DA AUDITORIA CODEX: Banana Prata em Ponta da Fruta + Cortes em Balneário e Santa Mônica", async () => {
    const cycleDate = "2026-10-20";

    // 1. Busca as 3 lojas
    const stores = await db<{ id: string; slug: string; name: string }[]>`
      SELECT id, slug, name FROM stores ORDER BY name ASC
    `;
    expect(stores.length).toBeGreaterThanOrEqual(3);
    const storePonta = stores.find((s) => s.slug === "ponta-da-fruta")!;
    const storeBalneario = stores.find((s) => s.slug === "balneario")!;
    const storeSantaMonica = stores.find((s) => s.slug === "santa-monica")!;

    // 2. Cria produtos: Banana Prata (ERP 35) e Cenoura (ERP 42)
    const [prodBanana] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (35, 'BANANA PRATA ERP 35', 'CX', 'KG', 30.00, true)
      RETURNING id
    `;
    const [prodCenoura] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (42, 'CENOURA ERP 42', 'CX', 'KG', 30.00, true)
      RETURNING id
    `;

    // 3. Cria fornecedores União Frutas e JEB
    const [suppUniao] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('União Frutas Ltda', '11111111000199', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
    await db`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('JEB Distribuidora', '22222222000199', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // 4. Cria pedidos das 3 lojas no ciclo 20/10/2026:
    // - Ponta da Fruta: Banana Prata 7 CX, Cenoura 5 CX
    // - Balneário: Banana Prata 8 CX, Cenoura 4 CX
    // - Santa Mônica: Banana Prata 6 CX, Cenoura 3 CX
    const [orderPonta] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storePonta.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES
        (${orderPonta.id}::uuid, ${prodBanana.id}::uuid, 0.00, 7.00, 35, 'BANANA PRATA ERP 35', 'CX'),
        (${orderPonta.id}::uuid, ${prodCenoura.id}::uuid, 0.00, 5.00, 42, 'CENOURA ERP 42', 'CX')
    `;

    const [orderBalneario] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storeBalneario.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES
        (${orderBalneario.id}::uuid, ${prodBanana.id}::uuid, 0.00, 8.00, 35, 'BANANA PRATA ERP 35', 'CX'),
        (${orderBalneario.id}::uuid, ${prodCenoura.id}::uuid, 0.00, 4.00, 42, 'CENOURA ERP 42', 'CX')
    `;

    const [orderSantaMonica] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storeSantaMonica.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES
        (${orderSantaMonica.id}::uuid, ${prodBanana.id}::uuid, 0.00, 6.00, 35, 'BANANA PRATA ERP 35', 'CX'),
        (${orderSantaMonica.id}::uuid, ${prodCenoura.id}::uuid, 0.00, 3.00, 42, 'CENOURA ERP 42', 'CX')
    `;

    // 5. Marca os dois produtos como comprados nos custos do ciclo
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES
        (${cycleDate}::date, ${prodBanana.id}::uuid, 50.00, true, now(), ${buyerPrincipal.userId}::uuid),
        (${cycleDate}::date, ${prodCenoura.id}::uuid, 35.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // 6. Aloca Banana Prata: 7 CX para Ponta da Fruta no Fornecedor União Frutas
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppUniao.id,
      allocations: [
        {
          productId: prodBanana.id,
          stores: [{ storeId: storePonta.id, destinedQuantity: "7.00" }],
        },
      ],
    });

    // 7. Aloca Cenoura:
    // - Ponta da Fruta: 5 CX (atendimento integral) no União Frutas
    // - Balneário: compra de 2 das 4 CX no União Frutas (corte parcial de 2 CX)
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppUniao.id,
      allocations: [
        {
          productId: prodCenoura.id,
          stores: [
            { storeId: storePonta.id, destinedQuantity: "5.00" },
            { storeId: storeBalneario.id, destinedQuantity: "2.00" },
          ],
        },
      ],
    });

    // 8. Finaliza apenas a conferência de cortes de Ponta da Fruta
    const closePontaResult = await closeStoreWithPreview(buyerPrincipal, cycleDate, storePonta.id);
    expect(closePontaResult.success).toBe(true);

    // 9. TESTE CRÍTICO DO CODEX:
    // Tenta fechar o ciclo geral do comprador.
    // Balneário e Santa Mônica ainda não foram conferidas.
    // DEVE SER BLOQUEADO!
    await expect(
      closeBuyerCycle(buyerPrincipal, cycleDate),
    ).rejects.toThrow(AllocationValidationError);

    // 10. Balneário: comprador confere os cortes
    const closeBalnearioResult = await closeStoreWithPreview(buyerPrincipal, cycleDate, storeBalneario.id);
    expect(closeBalnearioResult.success).toBe(true);
    expect(closeBalnearioResult.cuts).toHaveLength(2);

    const cenouraBalneario = closeBalnearioResult.cuts.find((c) => c.productId === prodCenoura.id);
    expect(cenouraBalneario?.status).toBe("PARTIAL_CUT");
    expect(cenouraBalneario?.orderedQuantity).toBe("4.00");
    expect(cenouraBalneario?.destinedQuantity).toBe("2.00");
    expect(cenouraBalneario?.cutQuantity).toBe("2.00");

    const bananaBalneario = closeBalnearioResult.cuts.find((c) => c.productId === prodBanana.id);
    expect(bananaBalneario?.status).toBe("TOTAL_CUT");
    expect(bananaBalneario?.orderedQuantity).toBe("8.00");
    expect(bananaBalneario?.destinedQuantity).toBe("0.00");
    expect(bananaBalneario?.cutQuantity).toBe("8.00");

    // Ainda não pode fechar o ciclo geral porque Santa Mônica não finalizou
    await expect(
      closeBuyerCycle(buyerPrincipal, cycleDate),
    ).rejects.toThrow(AllocationValidationError);

    // 11. Santa Mônica: finaliza conferência de cortes (Banana 6 CX corte total, Cenoura 3 CX corte total)
    const closeSMResult = await closeStoreWithPreview(buyerPrincipal, cycleDate, storeSantaMonica.id);
    expect(closeSMResult.success).toBe(true);
    expect(closeSMResult.totalCutItems).toBe(2);

    // 12. Agora com as 3 lojas finalizadas, o fechamento geral é autorizado com sucesso!
    const closeCycleResult = await closeBuyerCycle(buyerPrincipal, cycleDate);
    expect(closeCycleResult.success).toBe(true);

    // Verifica workspace após fechamento
    const ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, storePonta.id);
    expect(ws.closure.status).toBe("CLOSED");
    expect(ws.closure.canClose).toBe(true);
  });

  it("3 e 4. Decisões de Não Compra por fornecedor sem afetar outros fornecedores", async () => {
    const cycleDate = "2026-10-21";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (6001, 'MAÇÃ GALA', 'CX', 'KG', 30.00, true)
      RETURNING id
    `;
    const [suppA] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Pomar Sul', '33333333000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
    const [suppB] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Pomar Norte', '44444444000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // Cria pedido para a loja
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 5.00, 6001, 'MAÇÃ GALA', 'CX')
    `;

    // Marca como comprado nos custos
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod.id}::uuid, 60.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // Marca NÃO COMPRADO no Fornecedor A
    const decA = await setProductSupplierDecision(buyerPrincipal, {
      cycleDate,
      supplierId: suppA.id,
      storeId: store.id,
      productId: prod.id,
      decision: "NOT_PURCHASED",
    });
    expect(decA.success).toBe(true);

    // Fornecedor B vende 5 CX para a loja
    const saveB = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppB.id,
      allocations: [
        {
          productId: prod.id,
          stores: [{ storeId: store.id, destinedQuantity: "5.00" }],
        },
      ],
    });
    expect(saveB.success).toBe(true);

    // Workspace do Fornecedor A mostra NOT_PURCHASED
    const wsA = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, suppA.id, store.id);
    const pA = wsA.destinationData?.products.find((p) => p.productId === prod.id);
    expect(pA?.supplierDecision).toBe("NOT_PURCHASED");

    // Workspace do Fornecedor B mostra 5.00 CX destinada e SEM decisão de não compra
    const wsB = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, suppB.id, store.id);
    const pB = wsB.destinationData?.products.find((p) => p.productId === prod.id);
    expect(pB?.stores[store.id].destinedQuantity).toBe("5.00");
    expect(pB?.supplierDecision).toBeNull();
  });

  it("5 e 6. Conclusão em lote preservando destinações positivas e reversão de decisão", async () => {
    const cycleDate = "2026-10-22";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [supp] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Horti Vale', '55555555000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
    const [prodPositive] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (7001, 'ALFACE AMERICANA', 'CX', 'UN', 30.00, true)
      RETURNING id
    `;
    const [prodZero] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (7002, 'RÚCULA HIDROPÔNICA', 'CX', 'UN', 30.00, true)
      RETURNING id
    `;

    // Vincula ambos os produtos ao fornecedor Horti Vale
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active)
      VALUES
        (${prodPositive.id}::uuid, ${supp.id}::uuid, true, false, true),
        (${prodZero.id}::uuid, ${supp.id}::uuid, true, false, true)
    `;

    // Pedido dos produtos
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES
        (${order.id}::uuid, ${prodPositive.id}::uuid, 0.00, 10.00, 7001, 'ALFACE AMERICANA', 'CX'),
        (${order.id}::uuid, ${prodZero.id}::uuid, 0.00, 5.00, 7002, 'RÚCULA HIDROPÔNICA', 'CX')
    `;

    // Marca ambos como comprados nos custos
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES
        (${cycleDate}::date, ${prodPositive.id}::uuid, 20.00, true, now(), ${buyerPrincipal.userId}::uuid),
        (${cycleDate}::date, ${prodZero.id}::uuid, 15.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // Salva 10 CX para prodPositive
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [
        {
          productId: prodPositive.id,
          stores: [{ storeId: store.id, destinedQuantity: "10.00" }],
        },
      ],
    });

    // Conclusão em lote do fornecedor para esta loja
    const batchResult = await concludeSupplierStoreReview(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      storeId: store.id,
      expectedProductIds: [prodZero.id],
    });
    expect(batchResult.success).toBe(true);

    // Lê workspace para verificar que:
    // - prodPositive continuou com 10.00 CX
    // - prodZero foi marcado como NOT_PURCHASED
    const ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, supp.id, store.id);
    const itemPos = ws.destinationData?.products.find((p) => p.productId === prodPositive.id);
    expect(itemPos?.stores[store.id].destinedQuantity).toBe("10.00");
    expect(itemPos?.supplierDecision).toBeNull();

    const itemZero = ws.destinationData?.products.find((p) => p.productId === prodZero.id);
    expect(itemZero?.supplierDecision).toBe("NOT_PURCHASED");

    // Testa Reversão da decisão em prodZero
    const revResult = await revertProductSupplierDecision(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      storeId: store.id,
      productId: prodZero.id,
    });
    expect(revResult.success).toBe(true);

    const wsAfterRev = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, supp.id, store.id);
    const itemZeroAfter = wsAfterRev.destinationData?.products.find((p) => p.productId === prodZero.id);
    expect(itemZeroAfter?.supplierDecision).toBeNull();
  });

  it("11 e 12. Invalidação automática (Staleness) após alteração de pedido ou destinações", async () => {
    const cycleDate = "2026-10-23";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (8001, 'BATATA INGLESA', 'SC', 'KG', 25.00, true)
      RETURNING id
    `;
    const [supp] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Batateira Central', '66666666000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // Cria pedido inicial
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 20.00, 8001, 'BATATA INGLESA', 'SC')
    `;

    // Marca como comprado nos custos
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod.id}::uuid, 40.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // Destina 20 SC
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [
        {
          productId: prod.id,
          stores: [{ storeId: store.id, destinedQuantity: "20.00" }],
        },
      ],
    });

    // Finaliza conferência da loja
    await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);

    // Estado antes da alteração: CLOSED e NÃO stale
    let ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    expect(ws.storeSummary[store.id].closureStatus).toBe("CLOSED");
    expect(ws.storeSummary[store.id].isStale).toBe(false);

    // Alteração de destinação: comprador ajusta para 18 SC
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [
        {
          productId: prod.id,
          stores: [{ storeId: store.id, destinedQuantity: "18.00" }],
        },
      ],
    });

    // Estado após alteração de destinação: detecta STALENESS
    ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    expect(ws.storeSummary[store.id].isStale).toBe(true);
    expect(ws.storeSummary[store.id].staleReason).toContain("Destinações da loja foram alteradas");

    // Reconferência e novo fechamento resolve o staleness
    await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);
    ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    expect(ws.storeSummary[store.id].isStale).toBe(false);

    // Alteração de pedido: nova revisão do pedido submetida pela loja (revisão 2)
    await db`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 2, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // Estado após novo pedido: detecta STALENESS
    ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    expect(ws.storeSummary[store.id].isStale).toBe(true);
    expect(ws.storeSummary[store.id].staleReason).toContain("Pedido da loja foi atualizado");
  });

  it("14. Trava de segurança para descarte de destinação positiva", async () => {
    const cycleDate = "2026-10-24";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9001, 'LARANJA PERA', 'CX', 'KG', 25.00, true)
      RETURNING id
    `;
    const [supp] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Citrus Brasil', '77777777000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // Cria pedido
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 15.00, 9001, 'LARANJA PERA', 'CX')
    `;

    // Marca como comprado nos custos
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod.id}::uuid, 30.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // Destina 15 CX
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [
        {
          productId: prod.id,
          stores: [{ storeId: store.id, destinedQuantity: "15.00" }],
        },
      ],
    });

    // Tentativa de marcar NOT_PURCHASED sem confirmação explícita (confirmRemoveDestined = false)
    await expect(
      setProductSupplierDecision(buyerPrincipal, {
        cycleDate,
        supplierId: supp.id,
        storeId: store.id,
        productId: prod.id,
        decision: "NOT_PURCHASED",
        confirmRemoveDestined: false,
      }),
    ).rejects.toThrow(AllocationValidationError);

    // Com confirmação explícita (confirmRemoveDestined = true), destinação é zerada e decisão registrada
    const result = await setProductSupplierDecision(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      storeId: store.id,
      productId: prod.id,
      decision: "NOT_PURCHASED",
      confirmRemoveDestined: true,
    });
    expect(result.success).toBe(true);

    const ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, supp.id, store.id);
    const p = ws.destinationData?.products.find((item) => item.productId === prod.id);
    expect(p?.stores[store.id].destinedQuantity).toBe("0.00");
    expect(p?.supplierDecision).toBe("NOT_PURCHASED");
  });

  it("15 e 16. Reabertura da conferência da loja com histórico e justificativa auditada", async () => {
    const cycleDate = "2026-10-25";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;

    // Fecha loja
    await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);

    // Reabre conferência da loja informando justificativa
    const reopenResult = await reopenStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: store.id,
      reason: "Correção de sobra de produto no caminhão",
    });
    expect(reopenResult.success).toBe(true);

    // Verifica que status voltou para OPEN e a justificativa foi registrada
    const ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    expect(ws.storeSummary[store.id].closureStatus).toBe("OPEN");
    expect(ws.storeClosures[store.id].status).toBe("OPEN");
    expect(ws.storeClosures[store.id].reopenReason).toBe("Correção de sobra de produto no caminhão");

    // Verifica registro de auditoria imutável em audit_events
    const [auditLog] = await db<{ action: string; metadata: { reason?: string } }[]>`
      SELECT action, metadata
      FROM audit_events
      WHERE action = 'STORE_CYCLE_REOPENED'
        AND entity_id = ${store.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(auditLog).toBeDefined();
    expect(auditLog.metadata.reason).toBe("Correção de sobra de produto no caminhão");
  });

  it("7 e 8. Transferência e Divisão de compras entre fornecedores com soma conjunta", async () => {
    const cycleDate = "2026-10-26";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9050, 'MELÃO REI', 'CX', 'UN', 30.00, true)
      RETURNING id
    `;
    const [suppA] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Melões do Vale', '88888888000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
    const [suppB] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Frutas Tropical', '99999999000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // Pedido de 10 CX
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 10.00, 9050, 'MELÃO REI', 'CX')
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod.id}::uuid, 40.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // 1. Salva 10 CX no Fornecedor A
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppA.id,
      allocations: [
        {
          productId: prod.id,
          stores: [{ storeId: store.id, destinedQuantity: "10.00" }],
        },
      ],
    });

    // 2. Tenta salvar no Fornecedor B sem resolução -> conflito detectado
    let conflictFingerprint: string | undefined;
    try {
      await saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: suppB.id,
        allocations: [
          {
            productId: prod.id,
            stores: [{ storeId: store.id, destinedQuantity: "10.00" }],
          },
        ],
      });
      throw new Error("Deveria ter lançado AllocationDestinationConflictError");
    } catch (err) {
      expect(err).toBeInstanceOf(AllocationDestinationConflictError);
      conflictFingerprint = (err as AllocationDestinationConflictError).conflicts[0].fingerprint;
    }

    // 3. Resolve conflito com TRANSFER: transfere tudo para o Fornecedor B
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppB.id,
      allocations: [
        {
          productId: prod.id,
          stores: [
            {
              storeId: store.id,
              destinedQuantity: "10.00",
              conflictResolution: "TRANSFER",
              conflictFingerprint,
            },
          ],
        },
      ],
    });

    // Fornecedor A foi zerado e Fornecedor B tem 10 CX
    const wsSuppA = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, suppA.id, store.id);
    const pSuppA = wsSuppA.destinationData?.products.find((p) => p.productId === prod.id);
    expect(pSuppA?.stores[store.id].destinedQuantity).toBe("0.00");

    const wsSuppB = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, suppB.id, store.id);
    const pSuppB = wsSuppB.destinationData?.products.find((p) => p.productId === prod.id);
    expect(pSuppB?.stores[store.id].destinedQuantity).toBe("10.00");

    // 4. Divisão entre fornecedores: Fornecedor A recebe 4 CX e Fornecedor B 6 CX com SPLIT_CONFIRMED
    let splitFingerprintA: string | undefined;
    try {
      await saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: suppA.id,
        allocations: [
          {
            productId: prod.id,
            stores: [{ storeId: store.id, destinedQuantity: "4.00" }],
          },
        ],
      });
      throw new Error("Deveria ter lançado conflito");
    } catch (err) {
      expect(err).toBeInstanceOf(AllocationDestinationConflictError);
      splitFingerprintA = (err as AllocationDestinationConflictError).conflicts[0].fingerprint;
    }

    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppA.id,
      allocations: [
        {
          productId: prod.id,
          stores: [
            {
              storeId: store.id,
              destinedQuantity: "4.00",
              conflictResolution: "SPLIT_CONFIRMED",
              conflictFingerprint: splitFingerprintA,
            },
          ],
        },
      ],
    });

    let splitFingerprintB: string | undefined;
    try {
      await saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: suppB.id,
        allocations: [
          {
            productId: prod.id,
            stores: [{ storeId: store.id, destinedQuantity: "6.00" }],
          },
        ],
      });
      throw new Error("Deveria ter lançado conflito");
    } catch (err) {
      expect(err).toBeInstanceOf(AllocationDestinationConflictError);
      splitFingerprintB = (err as AllocationDestinationConflictError).conflicts[0].fingerprint;
    }

    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppB.id,
      allocations: [
        {
          productId: prod.id,
          stores: [
            {
              storeId: store.id,
              destinedQuantity: "6.00",
              conflictResolution: "SPLIT_CONFIRMED",
              conflictFingerprint: splitFingerprintB,
            },
          ],
        },
      ],
    });

    // Fecha conferência da loja: soma dos fornecedores é 4 + 6 = 10 CX (FULFILLED sem cortes!)
    const closeRes = await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);
    const cutItem = closeRes.cuts.find((c) => c.productId === prod.id);
    expect(cutItem?.status).toBe("FULFILLED");
    expect(cutItem?.destinedQuantity).toBe("10.00");
    expect(cutItem?.cutQuantity).toBe("0.00");
  });

  it("9. Validação estrita de Exclusividade de fornecedor", async () => {
    const cycleDate = "2026-10-27";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prodExcl] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9060, 'PRODUTO EXCLUSIVO A', 'CX', 'KG', 30.00, true)
      RETURNING id
    `;
    const [suppExcl] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Fornecedor Dono Exclusivo', '12121212000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
    const [suppOutro] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Fornecedor Intruso', '13131313000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // Vincula exclusividade em product_suppliers
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active)
      VALUES (${prodExcl.id}::uuid, ${suppExcl.id}::uuid, true, true, true)
    `;

    // Pedido
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prodExcl.id}::uuid, 0.00, 5.00, 9060, 'PRODUTO EXCLUSIVO A', 'CX')
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prodExcl.id}::uuid, 25.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // Tentar alocar no fornecedor intruso bloqueia com ExclusivityViolationError
    await expect(
      saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: suppOutro.id,
        allocations: [
          {
            productId: prodExcl.id,
            stores: [{ storeId: store.id, destinedQuantity: "5.00" }],
          },
        ],
      }),
    ).rejects.toThrow(ExclusivityViolationError);

    // Alocar no fornecedor exclusivo passa com sucesso
    const saveExcl = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppExcl.id,
      allocations: [
        {
          productId: prodExcl.id,
          stores: [{ storeId: store.id, destinedQuantity: "5.00" }],
        },
      ],
    });
    expect(saveExcl.success).toBe(true);
  });

  it("10. Compras de Oportunidade com snapshot ADDITIONAL na conferência", async () => {
    const cycleDate = "2026-10-28";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prodOpp] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9070, 'ABACAXI PEROLA OPORTUNIDADE', 'CX', 'UN', 30.00, true)
      RETURNING id
    `;
    const [supp] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Distribuidora de Abacaxi', '14141414000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // Salva compra de oportunidade (sem pedido) com isOpportunityConfirmed = true
    const saveOpp = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [
        {
          productId: prodOpp.id,
          isOpportunityConfirmed: true,
          stores: [{ storeId: store.id, destinedQuantity: "8.00" }],
        },
      ],
    });
    expect(saveOpp.success).toBe(true);

    // Fecha conferência da loja: o item aparece com status ADDITIONAL
    const closeRes = await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);
    const oppCut = closeRes.cuts.find((c) => c.productId === prodOpp.id);
    expect(oppCut).toBeDefined();
    expect(oppCut?.status).toBe("ADDITIONAL");
    expect(oppCut?.orderedQuantity).toBe("0.00");
    expect(oppCut?.destinedQuantity).toBe("8.00");
    expect(oppCut?.cutQuantity).toBe("0.00");
  });

  it("17. Compatibilidade dos ciclos históricos sem registros em store_closures", async () => {
    const historicCycleDate = "2026-09-01";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;

    // Insere fechamento histórico antigo (migration 0015) sem registros na nova tabela 0016
    await db`
      INSERT INTO purchase_cycle_buyer_closures (purchase_cycle_date, status, closed_at, closed_by)
      VALUES (${historicCycleDate}::date, 'CLOSED', now(), ${buyerPrincipal.userId}::uuid)
    `;

    // O sistema carrega o ciclo histórico sem crash e preserva status CLOSED
    const ws = await readBuyerAllocationWorkspace(buyerPrincipal, historicCycleDate, null, store.id);
    expect(ws.closure.status).toBe("CLOSED");
    expect(ws.storeClosures).toBeDefined();
    // Loja histórica não é invalidada nem impede leitura
    expect(ws.cycleDate).toBe(historicCycleDate);
  });

  it("18. Concorrência otimista: alteração de custos invalida fechamento pendente da loja (costs_hash)", async () => {
    const cycleDate = "2026-10-29";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9080, 'MELÃO REI', 'CX', 'UN', 30.00, true)
      RETURNING id
    `;
    const [supp] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Distribuidora Rei', '15151515000199', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // 1. Cria pedido para a loja
    const [order] = await db<{ id: string; revision: number }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id, revision
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 10.00, 9080, 'MELÃO REI', 'CX')
    `;

    // 2. Registra compra nos custos e destina produto
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod.id}::uuid, 50.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [{ productId: prod.id, stores: [{ storeId: store.id, destinedQuantity: "10.00" }] }],
    });

    // 3. Lê workspace e obtém custos_hash corrente
    const wsBefore = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, supp.id, store.id);
    const cutsSummaryBefore = wsBefore.storeClosures[store.id];
    const originalCostsHash = cutsSummaryBefore.costsHash;

    // 4. Simula comprador mantendo tela aberta enquanto custos mudam (desmarca produto como comprado)
    await db`
      UPDATE purchase_cycle_product_costs
      SET purchased = false, purchased_at = NULL, version = version + 1
      WHERE purchase_cycle_date = ${cycleDate}::date AND product_id = ${prod.id}::uuid
    `;

    // 5. Comprador tenta confirmar fechamento com expectedCostsHash antigo
    await expect(
      closeStoreCycle(buyerPrincipal, {
        cycleDate,
        storeId: store.id,
        expectedOrderId: cutsSummaryBefore.previewOrderId,
        expectedOrderRevision: cutsSummaryBefore.previewOrderRevision,
        expectedAllocationsHash: cutsSummaryBefore.previewAllocationsHash,
        expectedCostsHash: originalCostsHash!,
      }),
    ).rejects.toThrow(AllocationDestinationConflictError);

    // 6. Atualiza o workspace e confirma com o novo hash
    const wsAfter = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, supp.id, store.id);
    const newCostsHash = wsAfter.storeClosures[store.id].costsHash;
    expect(newCostsHash).not.toBe(originalCostsHash);

    const closeRes = await closeStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: store.id,
      expectedOrderId: wsAfter.storeClosures[store.id].previewOrderId,
      expectedOrderRevision: wsAfter.storeClosures[store.id].previewOrderRevision,
      expectedAllocationsHash: wsAfter.storeClosures[store.id].previewAllocationsHash,
      expectedCostsHash: newCostsHash!,
    });
    expect(closeRes.status).toBe("CLOSED");
  });

  it("19. Conclusão em lote rejeita operação se houver divergência em expectedProductIds", async () => {
    const cycleDate = "2026-10-30";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prodA] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9091, 'MANGA TOMMY', 'CX', 'UN', 30.00, true)
      RETURNING id
    `;
    const [prodB] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9092, 'MANGA PALMER', 'CX', 'UN', 30.00, true)
      RETURNING id
    `;
    const [supp] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Distribuidora de Mangas', '16161616000199', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // Vincula produtos ao fornecedor
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id)
      VALUES (${prodA.id}::uuid, ${supp.id}::uuid), (${prodB.id}::uuid, ${supp.id}::uuid)
    `;

    // Cria pedidos
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES
        (${order.id}::uuid, ${prodA.id}::uuid, 0.00, 5.00, 9091, 'MANGA TOMMY', 'CX'),
        (${order.id}::uuid, ${prodB.id}::uuid, 0.00, 5.00, 9092, 'MANGA PALMER', 'CX')
    `;

    // Marca ambos como comprados nos custos
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES
        (${cycleDate}::date, ${prodA.id}::uuid, 45.00, true, now(), ${buyerPrincipal.userId}::uuid),
        (${cycleDate}::date, ${prodB.id}::uuid, 48.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // Envia lista esperada incompleta (ex: apenas prodA quando o backend identifica prodA e prodB pendentes)
    await expect(
      concludeSupplierStoreReview(buyerPrincipal, {
        cycleDate,
        supplierId: supp.id,
        storeId: store.id,
        expectedProductIds: [prodA.id],
      }),
    ).rejects.toThrow(AllocationDestinationConflictError);

    // Envia a lista completa exata: sucesso
    const result = await concludeSupplierStoreReview(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      storeId: store.id,
      expectedProductIds: [prodA.id, prodB.id],
    });
    expect(result.success).toBe(true);
    expect(result.affectedCount).toBe(2);
  });

  it("20. Histórico append-only preserva versões imutáveis em purchase_cycle_store_closures", async () => {
    const cycleDate = "2026-10-31";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9095, 'UVA NIAGARA', 'CX', 'UN', 30.00, true)
      RETURNING id
    `;
    const [supp] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Uvas do Vale', '17171717000199', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 10.00, 9095, 'UVA NIAGARA', 'CX')
    `;

    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod.id}::uuid, 40.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [{ productId: prod.id, stores: [{ storeId: store.id, destinedQuantity: "6.00" }] }],
    });

    // 1. Primeiro fechamento (versão 1)
    const closureV1 = await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);
    expect(closureV1.version).toBe(1);
    expect(closureV1.isCurrent).toBe(true);

    // 2. Reabre conferência
    await reopenStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: store.id,
      reason: "Ajuste na quantidade de caixas recebidas",
    });

    // 3. Modifica destinação para 8.00
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [{ productId: prod.id, stores: [{ storeId: store.id, destinedQuantity: "8.00" }] }],
    });

    // 4. Segundo fechamento (versão 3, após versão 2 de reabertura)
    const closureV2 = await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);
    expect(closureV2.version).toBe(3);
    expect(closureV2.isCurrent).toBe(true);

    // 5. Verifica diretamente no banco que TODAS as versões existem de forma imutável (append-only)
    const closureRows = await db<{
      version: number;
      is_current: boolean;
      status: string;
      total_destined_items: number;
      total_cut_items: number;
    }[]>`
      SELECT version, is_current, status, total_destined_items, total_cut_items
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${cycleDate}::date
        AND store_id = ${store.id}::uuid
      ORDER BY version ASC
    `;

    expect(closureRows).toHaveLength(3);
    expect(closureRows[0].version).toBe(1);
    expect(closureRows[0].status).toBe("CLOSED");
    expect(closureRows[0].is_current).toBe(false);
    expect(closureRows[1].version).toBe(2);
    expect(closureRows[1].status).toBe("REOPENED");
    expect(closureRows[1].is_current).toBe(false);
    expect(closureRows[2].version).toBe(3);
    expect(closureRows[2].status).toBe("CLOSED");
    expect(closureRows[2].is_current).toBe(true);
  });

  it("21. Lojas participantes históricas são preservadas mesmo com inativação subsequente", async () => {
    const cycleDate = "2026-11-01";
    // 1. Cria uma loja temporária ativa
    const [tempStore] = await db<{ id: string; name: string }[]>`
      INSERT INTO stores (name, slug, active)
      VALUES ('MultiShow Filial Temporária', 'filial-temporaria', true)
      RETURNING id, name
    `;

    // 2. Cria pedido para a loja temporária no ciclo
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9099, 'PÊSSEGO NACIONAL', 'CX', 'UN', 30.00, true)
      RETURNING id
    `;
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${tempStore.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 2.00, 9099, 'PÊSSEGO NACIONAL', 'CX')
    `;

    // 3. Consulta workspace (registra tempStore como loja participante do ciclo 2026-11-01)
    const ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, tempStore.id);
    expect(ws.stores.some((s) => s.id === tempStore.id)).toBe(true);

    // 4. Inativa a loja posteriormente
    await db`UPDATE stores SET active = false WHERE id = ${tempStore.id}::uuid`;

    // 5. Nova leitura do workspace para o ciclo histórico continua identificando tempStore como participante
    const wsHistoric = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, tempStore.id);
    expect(wsHistoric.stores.some((s) => s.id === tempStore.id)).toBe(true);

    // 6. O fechamento geral do ciclo exige conferência de tempStore
    await expect(
      closeBuyerCycle(buyerPrincipal, cycleDate),
    ).rejects.toThrow(AllocationValidationError);
  });

  it("22. CRÍTICA H1: Lojas com atividade posterior não são ignoradas e impedem fechamento geral", async () => {
    const cycleDate = "2026-11-02";
    const stores = await db<{ id: string; slug: string; name: string }[]>`
      SELECT id, slug, name FROM stores WHERE active = true ORDER BY slug
    `;
    const storePonta = stores.find((s) => s.slug === "ponta-da-fruta")!;
    const storeBalneario = stores.find((s) => s.slug === "balneario")!;
    const storeSantaMonica = stores.find((s) => s.slug === "santa-monica")!;

    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9101, 'ABACAXI PEROLA', 'CX', 'UN', 25.00, true)
      RETURNING id
    `;

    // 1. Apenas Ponta da Fruta submete pedido inicialmente
    const [orderPonta] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storePonta.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${orderPonta.id}::uuid, ${prod.id}::uuid, 0.00, 5.00, 9101, 'ABACAXI PEROLA', 'CX')
    `;

    // 2. Primeira leitura do ciclo
    await resolveParticipatingStores(db, cycleDate);

    // 3. Ponta confere e finaliza cortes
    await closeStoreWithPreview(buyerPrincipal, cycleDate, storePonta.id);

    // 4. Balneário subseqüentemente insere um pedido ativo no ciclo
    const [orderBalneario] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storeBalneario.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${orderBalneario.id}::uuid, ${prod.id}::uuid, 0.00, 4.00, 9101, 'ABACAXI PEROLA', 'CX')
    `;

    // 5. Tentativa de fechamento geral do comprador DEVE SER BLOQUEADA
    await expect(
      closeBuyerCycle(buyerPrincipal, cycleDate),
    ).rejects.toThrow(AllocationValidationError);

    // 6. Confere Balneário e Santa Mônica
    await closeStoreWithPreview(buyerPrincipal, cycleDate, storeBalneario.id);
    await closeStoreWithPreview(buyerPrincipal, cycleDate, storeSantaMonica.id);

    // 7. Agora com todas as lojas participantes conferidas, fecha com sucesso
    const closeRes = await closeBuyerCycle(buyerPrincipal, cycleDate);
    expect(closeRes.success).toBe(true);
  });

  it("23. ALTA H2: Reconferência da loja após reabertura com os hashes da prévia exibida conclui com sucesso", async () => {
    const cycleDate = "2026-11-03";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9102, 'MELAO AMARELO', 'CX', 'UN', 20.00, true)
      RETURNING id
    `;
    const [supp] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Melões do Nordeste', '33333333000177', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 10.00, 9102, 'MELAO AMARELO', 'CX')
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod.id}::uuid, 35.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // 1. Destina 6 CX e fecha a loja (v1)
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [{ productId: prod.id, stores: [{ storeId: store.id, destinedQuantity: "6.00" }] }],
    });
    const closure1 = await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);
    expect(closure1.status).toBe("CLOSED");

    // 2. Reabre loja com justificativa
    await reopenStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: store.id,
      reason: "Chegada de lote complementar pelo fornecedor",
    });

    // 3. Altera destinação de 6.00 para 8.00
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [{ productId: prod.id, stores: [{ storeId: store.id, destinedQuantity: "8.00" }] }],
    });

    // 4. Lê workspace para obter a prévia recalculada exibida ao usuário
    const ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, supp.id, store.id);
    const storeClosureSummary = ws.storeClosures[store.id];
    expect(storeClosureSummary.status).toBe("OPEN");

    // O previewAllocationsHash DEVE ser o hash das 8 CX, e NÃO o hash das 6 CX do fechamento anterior!
    expect(storeClosureSummary.previewAllocationsHash).toBeDefined();

    // 5. Confirmação usando os hashes fornecidos na leitura (exatamente como o front-end envia)
    const reconferenceResult = await closeStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: store.id,
      expectedOrderId: storeClosureSummary.previewOrderId,
      expectedOrderRevision: storeClosureSummary.previewOrderRevision,
      expectedAllocationsHash: storeClosureSummary.previewAllocationsHash,
      expectedCostsHash: storeClosureSummary.previewCostsHash,
    });

    expect(reconferenceResult.success).toBe(true);
    expect(reconferenceResult.status).toBe("CLOSED");
  });

  it("24. CRÍTICA H3: Concorrência real entre persistPurchaseCost e closeBuyerCycle (ambas as ordens serializadas)", async () => {
    const cycleDate = "2026-11-04";
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9103, 'MANGA PALMER', 'CX', 'UN', 25.00, true)
      RETURNING id
    `;

    // Garante que o namespace é 424242
    expect(BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE).toBe(424242);

    // Ordem A: persistPurchaseCost adquire a trava de ciclo primeiro.
    // closeBuyerCycle tenta fechar concorrentemente e fica bloqueado até o commit do custo.
    const clientA = postgres(testDatabaseUrl, { max: 1 });
    const clientB = postgres(testDatabaseUrl, { max: 1 });

    try {
      let costTxAcquiredLock = false;

      const costPromise = clientA.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${cycleDate}::text))`;
        costTxAcquiredLock = true;
        // Simula processamento com trava retida
        await new Promise((r) => setTimeout(r, 200));

        await tx`
          INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by, version)
          VALUES (${cycleDate}::date, ${prod.id}::uuid, 42.00, true, now(), ${buyerPrincipal.userId}::uuid, 1)
        `;
      });

      // Aguarda Client A adquirir a trava
      while (!costTxAcquiredLock) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // Client B tenta fechar o ciclo enquanto Client A segura a trava
      let clientBStarted = false;
      let clientBFinished = false;

      const closePromise = clientB.begin(async (tx) => {
        clientBStarted = true;
        await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${cycleDate}::text))`;
        clientBFinished = true;
        const [existing] = await tx<{ status: string }[]>`
          SELECT status FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${cycleDate}::date
        `;
        return existing?.status ?? null;
      });

      while (!clientBStarted) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(clientBFinished).toBe(false);

      await Promise.all([costPromise, closePromise]);
      expect(clientBFinished).toBe(true);

      // Ordem B: Fechamento adquire a trava e fecha o ciclo primeiro.
      // persistPurchaseCost tenta salvar custo concorrentemente e é bloqueado.
      // Ao adquirir a trava, encontra ciclo fechado e lança CycleClosedError.
      await db`
        INSERT INTO purchase_cycle_buyer_closures (purchase_cycle_date, status, closed_at, closed_by)
        VALUES (${cycleDate}::date, 'CLOSED', now(), ${buyerPrincipal.userId}::uuid)
        ON CONFLICT (purchase_cycle_date) DO UPDATE SET status = 'CLOSED'
      `;

      await expect(
        persistPurchaseCost(buyerPrincipal, {
          cycleDate,
          productId: prod.id,
          cost: "50.00",
          purchased: true,
          expectedVersion: 1,
        }),
      ).rejects.toThrow(CycleClosedError);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("25. ALTA H4: closeStoreCycle exige estritamente todos os watermarks e rejeita chamadas inseguras", async () => {
    const cycleDate = "2026-11-05";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9104, 'KIWI NACIONAL', 'CX', 'UN', 45.00, true)
      RETURNING id
    `;
    const [order] = await db<{ id: string; revision: number }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id, revision
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 3.00, 9104, 'KIWI NACIONAL', 'CX')
    `;

    const ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    const sc = ws.storeClosures[store.id];

    // 1. Rejeita se expectedAllocationsHash for vazio ou ausente
    await expect(
      closeStoreCycle(buyerPrincipal, {
        cycleDate,
        storeId: store.id,
        expectedOrderId: sc.previewOrderId,
        expectedOrderRevision: sc.previewOrderRevision,
        expectedAllocationsHash: "",
        expectedCostsHash: sc.previewCostsHash,
      }),
    ).rejects.toThrow(AllocationDestinationConflictError);

    // 2. Rejeita se expectedCostsHash for vazio ou ausente
    await expect(
      closeStoreCycle(buyerPrincipal, {
        cycleDate,
        storeId: store.id,
        expectedOrderId: sc.previewOrderId,
        expectedOrderRevision: sc.previewOrderRevision,
        expectedAllocationsHash: sc.previewAllocationsHash,
        expectedCostsHash: "",
      }),
    ).rejects.toThrow(AllocationDestinationConflictError);

    // 3. Rejeita se expectedOrderId divergir do pedido atual
    await expect(
      closeStoreCycle(buyerPrincipal, {
        cycleDate,
        storeId: store.id,
        expectedOrderId: "00000000-0000-0000-0000-000000000099",
        expectedOrderRevision: sc.previewOrderRevision,
        expectedAllocationsHash: sc.previewAllocationsHash,
        expectedCostsHash: sc.previewCostsHash,
      }),
    ).rejects.toThrow(AllocationDestinationConflictError);

    // 4. Rejeita se expectedOrderRevision divergir da revisão atual
    await expect(
      closeStoreCycle(buyerPrincipal, {
        cycleDate,
        storeId: store.id,
        expectedOrderId: sc.previewOrderId,
        expectedOrderRevision: 99,
        expectedAllocationsHash: sc.previewAllocationsHash,
        expectedCostsHash: sc.previewCostsHash,
      }),
    ).rejects.toThrow(AllocationDestinationConflictError);

    // 5. Sucesso com todos os watermarks válidos da prévia
    const successRes = await closeStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: store.id,
      expectedOrderId: sc.previewOrderId,
      expectedOrderRevision: sc.previewOrderRevision,
      expectedAllocationsHash: sc.previewAllocationsHash,
      expectedCostsHash: sc.previewCostsHash,
    });
    expect(successRes.success).toBe(true);
  });

  it("26. ALTA H5: Precedência de Exclusividade entre exibição/lote e gravação (moderna vs legada)", async () => {
    const cycleDate = "2026-11-06";
    const [suppJeb] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('JEB DISTRIBUIDORA LTDA', '48336863000160', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
    const [suppOutro] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Hortifruti Alternativo', '44444444000166', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    // Produto 1: flag legada JEB (exclusive_supplier=true) MAS tem exclusividade moderna ativa para 'suppOutro'
    const [prod1] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active, exclusive_supplier)
      VALUES (9105, 'PRODUTO EXCL MODERNO OUTRO', 'CX', 'UN', 20.00, true, true)
      RETURNING id
    `;
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id, is_exclusive, is_primary, active)
      VALUES (${prod1.id}::uuid, ${suppOutro.id}::uuid, true, true, true)
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod1.id}::uuid, 20.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // Produto 2: flag legada JEB (exclusive_supplier=true), SEM exclusividade moderna, vinculado a 'suppOutro'
    const [prod2] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active, exclusive_supplier)
      VALUES (9106, 'PRODUTO EXCL LEGADO JEB', 'CX', 'UN', 20.00, true, true)
      RETURNING id
    `;
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id, is_exclusive, active)
      VALUES (${prod2.id}::uuid, ${suppOutro.id}::uuid, false, true)
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod2.id}::uuid, 22.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    // Consulta elegibilidade para JEB:
    // Prod 1 NÃO PODE ser elegível para JEB (porque modernamente é exclusivo de suppOutro)
    // Prod 2 DEVE ser elegível para JEB (porque é legado JEB)
    const eligibleJeb = await getSupplierEligibleProductIds(db, {
      cycleDate,
      supplierId: suppJeb.id,
    });
    expect(eligibleJeb.has(prod1.id)).toBe(false);
    expect(eligibleJeb.has(prod2.id)).toBe(true);

    // Consulta elegibilidade para 'suppOutro':
    // Prod 1 DEVE ser elegível para suppOutro (exclusividade ativa dele)
    // Prod 2 NÃO PODE ser elegível para suppOutro (pertence à JEB por regra legada)
    const eligibleOutro = await getSupplierEligibleProductIds(db, {
      cycleDate,
      supplierId: suppOutro.id,
    });
    expect(eligibleOutro.has(prod1.id)).toBe(true);
    expect(eligibleOutro.has(prod2.id)).toBe(false);
  });

  it("27. ALTA H6: Mudanças de valor, cost_is_unit ou version alteram fingerprint e invalidam conferência da loja", async () => {
    const cycleDate = "2026-11-07";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9107, 'BATATA ASTERIX', 'SC', 'KG', 15.00, true)
      RETURNING id
    `;
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 10.00, 9107, 'BATATA ASTERIX', 'SC')
    `;

    // 1. Custo inicial: R$ 50.00, cost_is_unit=false, version=1
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, cost_is_unit, purchased, purchased_at, updated_by, version)
      VALUES (${cycleDate}::date, ${prod.id}::uuid, 50.00, false, true, now(), ${buyerPrincipal.userId}::uuid, 1)
    `;

    // Fecha a loja
    await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);

    let ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    expect(ws.storeClosures[store.id].isStale).toBe(false);

    // 2. Altera valor de 50.00 para 60.00 mantendo purchased=true
    await db`
      UPDATE purchase_cycle_product_costs
      SET cost = 60.00, version = 2, updated_at = now()
      WHERE purchase_cycle_date = ${cycleDate}::date AND product_id = ${prod.id}::uuid
    `;

    ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    expect(ws.storeClosures[store.id].isStale).toBe(true);
    expect(ws.storeClosures[store.id].staleReason).toContain("Custos ou status de compra de produtos da loja foram alterados");

    // Reconferência resolve staleness
    await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);
    ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    expect(ws.storeClosures[store.id].isStale).toBe(false);

    // 3. Altera cost_is_unit de false para true
    await db`
      UPDATE purchase_cycle_product_costs
      SET cost_is_unit = true, version = 3, updated_at = now()
      WHERE purchase_cycle_date = ${cycleDate}::date AND product_id = ${prod.id}::uuid
    `;

    ws = await readBuyerAllocationWorkspace(buyerPrincipal, cycleDate, null, store.id);
    expect(ws.storeClosures[store.id].isStale).toBe(true);
  });

  it("28. MÉDIA ALTA 5: Snapshot anterior fechado permanece com status e dados intactos após reabertura", async () => {
    const cycleDate = "2026-11-08";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9108, 'CEBOLA NACIONAL', 'SC', 'KG', 18.00, true)
      RETURNING id
    `;
    const [supp] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Distribuidora Cebola Dourada', '55555555000155', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
      VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${store.id}::uuid, 1, now(), ${buyerPrincipal.userId}::uuid)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prod.id}::uuid, 0.00, 10.00, 9108, 'CEBOLA NACIONAL', 'SC')
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${prod.id}::uuid, 25.00, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supp.id,
      allocations: [{ productId: prod.id, stores: [{ storeId: store.id, destinedQuantity: "6.00" }] }],
    });

    // 1. Fecha conferência inicial (versão 1)
    await closeStoreWithPreview(buyerPrincipal, cycleDate, store.id);

    // Salva o snapshot exato da versão 1
    const [snapV1Before] = await db<{
      id: string;
      version: number;
      status: string;
      allocations_hash: string;
      costs_hash: string;
      closed_at: string;
      closed_by: string;
      reopened_at: string | null;
      reopen_reason: string | null;
      cut_summary: unknown;
    }[]>`
      SELECT id, version, status, allocations_hash, costs_hash, closed_at::text, closed_by, reopened_at::text, reopen_reason, cut_summary
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${cycleDate}::date AND store_id = ${store.id}::uuid AND version = 1
    `;
    expect(snapV1Before.status).toBe("CLOSED");

    // 2. Reabre conferência
    await reopenStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: store.id,
      reason: "Auditoria de divergência no pedido",
    });

    // 3. Consulta novamente o registro da versão 1
    const [snapV1After] = await db<{
      id: string;
      version: number;
      status: string;
      allocations_hash: string;
      costs_hash: string;
      closed_at: string;
      closed_by: string;
      reopened_at: string | null;
      reopen_reason: string | null;
      cut_summary: unknown;
      is_current: boolean;
    }[]>`
      SELECT id, version, status, allocations_hash, costs_hash, closed_at::text, closed_by, reopened_at::text, reopen_reason, cut_summary, is_current
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${cycleDate}::date AND store_id = ${store.id}::uuid AND version = 1
    `;

    // A LINHA DA VERSÃO 1 DEVE SER RIGOROSAMENTE IMUTÁVEL!
    // status CONTINUA 'CLOSED' (não foi alterado para 'REOPENED' in-place)
    expect(snapV1After.status).toBe("CLOSED");
    expect(snapV1After.allocations_hash).toBe(snapV1Before.allocations_hash);
    expect(snapV1After.costs_hash).toBe(snapV1Before.costs_hash);
    expect(snapV1After.closed_at).toBe(snapV1Before.closed_at);
    expect(snapV1After.closed_by).toBe(snapV1Before.closed_by);
    expect(snapV1After.reopened_at).toBeNull();
    expect(snapV1After.reopen_reason).toBeNull();
    expect(snapV1After.cut_summary).toEqual(snapV1Before.cut_summary);
    expect(snapV1After.is_current).toBe(false);

    // 4. A versão 2 é o registro da reabertura
    const [snapV2] = await db<{
      version: number;
      status: string;
      reopen_reason: string;
      is_current: boolean;
    }[]>`
      SELECT version, status, reopen_reason, is_current
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${cycleDate}::date AND store_id = ${store.id}::uuid AND version = 2
    `;
    expect(snapV2.version).toBe(2);
    expect(snapV2.status).toBe("REOPENED");
    expect(snapV2.reopen_reason).toBe("Auditoria de divergência no pedido");
    expect(snapV2.is_current).toBe(true);
  });
});
