import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  closeBuyerCycle,
  closeStoreCycle,
  concludeSupplierStoreReview,
  readBuyerAllocationWorkspace,
  reopenBuyerCycle,
  reopenStoreCycle,
  revertProductSupplierDecision,
  saveSupplierAllocations,
  setProductSupplierDecision,
} from "../../src/modules/purchasing/allocations/repository";
import {
  AllocationDestinationConflictError,
  AllocationValidationError,
  CycleClosedError,
  ExclusivityViolationError,
} from "../../src/modules/purchasing/allocations/domain";
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
    const [suppJeb] = await db<{ id: string }[]>`
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
    const closePontaResult = await closeStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: storePonta.id,
    });
    expect(closePontaResult.success).toBe(true);

    // 9. TESTE CRÍTICO DO CODEX:
    // Tenta fechar o ciclo geral do comprador.
    // Balneário e Santa Mônica ainda não foram conferidas.
    // DEVE SER BLOQUEADO!
    await expect(
      closeBuyerCycle(buyerPrincipal, cycleDate),
    ).rejects.toThrow(AllocationValidationError);

    // 10. Balneário: comprador confere os cortes
    const closeBalnearioResult = await closeStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: storeBalneario.id,
    });
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
    const closeSMResult = await closeStoreCycle(buyerPrincipal, {
      cycleDate,
      storeId: storeSantaMonica.id,
    });
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
    await closeStoreCycle(buyerPrincipal, { cycleDate, storeId: store.id });

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
    await closeStoreCycle(buyerPrincipal, { cycleDate, storeId: store.id });
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
    await closeStoreCycle(buyerPrincipal, { cycleDate, storeId: store.id });

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
    const [auditLog] = await db<{ action: string; metadata: any }[]>`
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
    const closeRes = await closeStoreCycle(buyerPrincipal, { cycleDate, storeId: store.id });
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
    const closeRes = await closeStoreCycle(buyerPrincipal, { cycleDate, storeId: store.id });
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
});
