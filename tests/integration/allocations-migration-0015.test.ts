import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  closeBuyerCycle,
  readBuyerAllocationWorkspace,
  reopenBuyerCycle,
  saveSupplierAllocations,
} from "../../src/modules/purchasing/allocations/repository";
import { loadSupplierBillingReport } from "../../src/modules/purchasing/reports/supplier-billing/repository";
import {
  AllocationDestinationConflictError,
  CycleClosedError,
  ExclusivityViolationError,
  AllocationValidationError,
} from "../../src/modules/purchasing/allocations/domain";
import type { Principal } from "../../src/modules/identity";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Fase 3: Testes de Integração de Alocações, Faturamento e Fechamento", () => {
  const stamp = Date.now();
  const testDbName = `test_db_phase3_${stamp}`;
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

  async function captureConflictFingerprint(operation: Promise<unknown>): Promise<string> {
    try {
      await operation;
      throw new Error("Era esperado conflito de destinação entre fornecedores.");
    } catch (error) {
      expect(error).toBeInstanceOf(AllocationDestinationConflictError);
      const conflictError = error as AllocationDestinationConflictError;
      expect(conflictError.conflicts[0]?.fingerprint).toBeTruthy();
      return conflictError.conflicts[0].fingerprint;
    }
  }

  beforeAll(async () => {
    baseDatabaseUrl = process.env.DATABASE_URL!;
    adminClient = postgres(baseDatabaseUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);

    const url = new URL(baseDatabaseUrl);
    url.pathname = `/${testDbName}`;
    testDatabaseUrl = url.toString();

    // Roda todas as migrations de 0001 a 0015 no banco isolado
    await runMigrations({
      databaseUrl: testDatabaseUrl,
      migrationsDirectory: path.resolve("migrations"),
    });

    db = postgres(testDatabaseUrl, { max: 5 });

    // Configura DATABASE_URL para o cliente de banco da aplicação
    process.env.DATABASE_URL = testDatabaseUrl;

    // Garante que o usuário do comprador existe para foreign keys
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

  it("1. Compras adicionais sem pedido e independência dos custos", async () => {
    // Busca loja existente criada na migration 0001
    const [store] = await db<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'ponta-da-fruta'
    `;

    const [supplier] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Fornecedor Oportunidade Ltda', '11111111000111', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    const [productOportunidade] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (5001, 'Melancia Baby Oportunidade', 'CX', 'KG', 35.00, true)
      RETURNING id
    `;

    const cycleDate = "2026-10-20";

    // Destina 5 CX para a loja sem pedido original com confirmação explícita
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: productOportunidade.id,
          isOpportunityConfirmed: true,
          stores: [
            {
              storeId: store.id,
              destinedQuantity: "5.00",
              notes: "Compra de oportunidade no CEASA",
            },
          ],
        },
      ],
    });

    // Valida persistência
    const [alloc] = await db<{
      ordered_quantity: string;
      destined_quantity: string;
      is_additional_purchase: boolean;
    }[]>`
      SELECT ordered_quantity::text, destined_quantity::text, is_additional_purchase
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${cycleDate}::date
        AND supplier_id = ${supplier.id}::uuid
        AND product_id = ${productOportunidade.id}::uuid
    `;

    expect(alloc).toBeDefined();
    expect(alloc.ordered_quantity).toBe("0.00");
    expect(alloc.destined_quantity).toBe("5.00");
    expect(alloc.is_additional_purchase).toBe(true);

    // Valida que NÃO criou custo fictício na tabela purchase_cycle_product_costs
    const costRows = await db`
      SELECT * FROM purchase_cycle_product_costs
      WHERE purchase_cycle_date = ${cycleDate}::date
        AND product_id = ${productOportunidade.id}::uuid
    `;
    expect(costRows.length).toBe(0);

    // Valida que entra no fechamento operacional
    const closeRes = await closeBuyerCycle(buyerPrincipal, cycleDate);
    expect(closeRes.success).toBe(true);

    const [closure] = await db<{ status: string; total_allocated_products: number }[]>`
      SELECT status, total_allocated_products
      FROM purchase_cycle_buyer_closures
      WHERE purchase_cycle_date = ${cycleDate}::date
    `;
    expect(closure.status).toBe("CLOSED");
    expect(closure.total_allocated_products).toBe(1);

    // Reabre para próximos testes
    await reopenBuyerCycle(buyerPrincipal, cycleDate, "Ajuste para testes de integração");
  });

  it("2. Relatório de faturamento: não mistura pedidos com faturamento, suporta split purchase e adicionais", async () => {
    const cycleDate = "2026-10-21";

    // Setup: 2 Lojas existentes, 2 Fornecedores, 1 Produto em comum
    const [store1] = await db<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'balneario'
    `;
    const [store2] = await db<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'santa-monica'
    `;

    const [suppA] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Produtor A', '22222222000122', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
    const [suppB] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Produtor B', '33333333000133', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    const [productTomate] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (5002, 'Tomate Longa Vida', 'CX', 'KG', 35.00, true)
      RETURNING id
    `;

    // Cria pedidos nas lojas: Balneário pediu 10 CX, Santa Mônica pediu 15 CX
    const [order1] = await db<{ id: string }[]>`
      INSERT INTO orders (store_id, order_date, purchase_cycle_date, revision, submitted_by, submitted_at, cutoff_at)
      VALUES (${store1.id}, ${cycleDate}::date, ${cycleDate}::date, 1, ${buyerPrincipal.userId}::uuid, now(), now() + interval '1 hour')
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order1.id}, ${productTomate.id}, 0, 10.00, 5002, 'Tomate Longa Vida', 'KG')
    `;

    const [order2] = await db<{ id: string }[]>`
      INSERT INTO orders (store_id, order_date, purchase_cycle_date, revision, submitted_by, submitted_at, cutoff_at)
      VALUES (${store2.id}, ${cycleDate}::date, ${cycleDate}::date, 1, ${buyerPrincipal.userId}::uuid, now(), now() + interval '1 hour')
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order2.id}, ${productTomate.id}, 0, 15.00, 5002, 'Tomate Longa Vida', 'KG')
    `;

    // Marca o Tomate como comprado nos custos (Regra A)
    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      )
      VALUES (
        ${productTomate.id}, ${cycleDate}::date, 60.00, true, now(), ${buyerPrincipal.userId}::uuid
      )
    `;

    // SPLIT PURCHASE:
    // Comprador destina 6 CX de Balneário para o Produtor A, e 4 CX de Balneário para o Produtor B (total 10)
    // Comprador destina 10 CX de Santa Mônica para o Produtor A, e 5 CX para o Produtor B (total 15)
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppA.id,
      allocations: [
        {
          productId: productTomate.id,
          stores: [
            { storeId: store1.id, destinedQuantity: "6.00" },
            { storeId: store2.id, destinedQuantity: "10.00" },
          ],
        },
      ],
    });

    const splitFingerprint = await captureConflictFingerprint(saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppB.id,
      allocations: [
        {
          productId: productTomate.id,
          stores: [
            { storeId: store1.id, destinedQuantity: "4.00" },
            { storeId: store2.id, destinedQuantity: "5.00" },
          ],
        },
      ],
    }));
    const secondSplitFingerprint = await captureConflictFingerprint(saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppB.id,
      allocations: [{
        productId: productTomate.id,
        stores: [
          {
            storeId: store1.id,
            destinedQuantity: "4.00",
            conflictResolution: "SPLIT_CONFIRMED",
            conflictFingerprint: splitFingerprint,
          },
          { storeId: store2.id, destinedQuantity: "5.00" },
        ],
      }],
    }));
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: suppB.id,
      allocations: [{
        productId: productTomate.id,
        stores: [
          {
            storeId: store1.id,
            destinedQuantity: "4.00",
            conflictResolution: "SPLIT_CONFIRMED",
            conflictFingerprint: splitFingerprint,
          },
          {
            storeId: store2.id,
            destinedQuantity: "5.00",
            conflictResolution: "SPLIT_CONFIRMED",
            conflictFingerprint: secondSplitFingerprint,
          },
        ],
      }],
    });

    // Carrega relatório de faturamento do Produtor A
    const reportA = await loadSupplierBillingReport(suppA.id, cycleDate, db);
    expect(reportA.hasAllocations).toBe(true);
    // Produtor A deve ter exatamente 16 CX faturáveis (6 de Balneário + 10 de Santa Mônica)
    const itemA = reportA.consolidatedProducts.find((p) => p.productId === productTomate.id);
    expect(itemA).toBeDefined();
    expect(itemA?.totalQuantity).toBe("16.00");
    expect(itemA?.storeQuantities[store1.id]).toBe("6.00");
    expect(itemA?.storeQuantities[store2.id]).toBe("10.00");

    // Carrega relatório de faturamento do Produtor B
    const reportB = await loadSupplierBillingReport(suppB.id, cycleDate, db);
    expect(reportB.hasAllocations).toBe(true);
    // Produtor B deve ter exatamente 9 CX faturáveis (4 de Balneário + 5 de Santa Mônica)
    const itemB = reportB.consolidatedProducts.find((p) => p.productId === productTomate.id);
    expect(itemB).toBeDefined();
    expect(itemB?.totalQuantity).toBe("9.00");
    expect(itemB?.storeQuantities[store1.id]).toBe("4.00");
    expect(itemB?.storeQuantities[store2.id]).toBe("5.00");

    // Total consolidado somando os 2 fornecedores é exatamente 25 CX (sem duplicação!)
    const totalSplit = Number(itemA?.totalQuantity) + Number(itemB?.totalQuantity);
    expect(totalSplit).toBe(25);
  });

  it("3. Exclusividade JEB: bloqueia destinação de produto exclusivo para outro fornecedor", async () => {
    const cycleDate = "2026-10-22";

    const [jeb] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('JEB DISTRIBUIDORA DE ALIMENTOS LTDA', '48336863000160', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    const [outroFornecedor] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Fornecedor Concorrente Ltda', '44444444000144', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    const [prodExclusivo] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, exclusive_supplier, active)
      VALUES (5003, 'Alho Roxo JEB', 'CX', 'KG', 35.00, true, true)
      RETURNING id
    `;

    // Vincula explicitamente como exclusivo da JEB
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active)
      VALUES (${prodExclusivo.id}, ${jeb.id}, true, true, true)
    `;

    const [store] = await db<{ id: string }[]>`
      SELECT id FROM stores LIMIT 1
    `;

    // Tentar destinar para a JEB funciona normalmente
    await expect(
      saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: jeb.id,
        allocations: [
          {
            productId: prodExclusivo.id,
            isOpportunityConfirmed: true,
            stores: [{ storeId: store.id, destinedQuantity: "10.00" }],
          },
        ],
      }),
    ).resolves.toMatchObject({ success: true });

    // Tentar destinar para o outro fornecedor DEVE falhar com ExclusivityViolationError
    await expect(
      saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: outroFornecedor.id,
        allocations: [
          {
            productId: prodExclusivo.id,
            isOpportunityConfirmed: true,
            stores: [{
              storeId: store.id,
              destinedQuantity: "10.00",
              conflictResolution: "SPLIT_CONFIRMED",
              conflictFingerprint: "nao-pode-contornar-exclusividade",
            }],
          },
        ],
      }),
    ).rejects.toThrow(ExclusivityViolationError);
  });

  it("4. Fechamento e bloqueios: bloqueia fechamento com pendências e protege ciclo fechado", async () => {
    const cycleDate = "2026-10-23";

    const [productCompradoSemFornecedor] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (5004, 'Cenoura Especial', 'CX', 'KG', 35.00, true)
      RETURNING id
    `;

    // Marca como comprado na tela de custos com custo lançado
    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      )
      VALUES (
        ${productCompradoSemFornecedor.id}, ${cycleDate}::date, 50.00, true, now(), ${buyerPrincipal.userId}::uuid
      )
    `;

    // Tenta fechar o ciclo SEM ter destinado o produto para nenhum fornecedor
    await expect(
      closeBuyerCycle(buyerPrincipal, cycleDate),
    ).rejects.toThrow(AllocationValidationError);

    // Agora destina para um fornecedor
    const [supplier] = await db<{ id: string }[]>`SELECT id FROM suppliers LIMIT 1`;
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;

    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: productCompradoSemFornecedor.id,
          stores: [{ storeId: store.id, destinedQuantity: "8.00" }],
        },
      ],
    });

    // Agora o fechamento deve ter sucesso
    const closeRes = await closeBuyerCycle(buyerPrincipal, cycleDate);
    expect(closeRes.success).toBe(true);

    // Tentar alterar alocações de um ciclo fechado DEVE lançar CycleClosedError
    await expect(
      saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: supplier.id,
        allocations: [
          {
            productId: productCompradoSemFornecedor.id,
            stores: [{ storeId: store.id, destinedQuantity: "10.00" }],
          },
        ],
      }),
    ).rejects.toThrow(CycleClosedError);

    // Reabertura exige justificativa mínima (mínimo 5 caracteres)
    await expect(
      reopenBuyerCycle(buyerPrincipal, cycleDate, "abc"),
    ).rejects.toThrow(AllocationValidationError);

    // Reabertura válida
    const reopenRes = await reopenBuyerCycle(
      buyerPrincipal,
      cycleDate,
      "Correção de quantidade física após conferência de pátio",
    );
    expect(reopenRes.success).toBe(true);

    // Após reabertura, a alteração é permitida com sucesso
    const saveAfterReopen = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: productCompradoSemFornecedor.id,
          stores: [{ storeId: store.id, destinedQuantity: "10.00" }],
        },
      ],
    });
    expect(saveAfterReopen.success).toBe(true);
  });

  it("5. Compras de oportunidade: exige confirmação explícita, audita criação, permite alteração e zeramento sem bloqueio", async () => {
    const cycleDate = "2026-10-24";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [supplier] = await db<{ id: string }[]>`SELECT id FROM suppliers LIMIT 1`;

    const [prodOportunidade] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (6001, 'Uva Niágara Oportunidade', 'CX', 'KG', 30.00, true)
      RETURNING id
    `;

    // 1. Tentar salvar oportunidade SEM confirmação explícita DEVE falhar
    await expect(
      saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: supplier.id,
        allocations: [
          {
            productId: prodOportunidade.id,
            isOpportunityConfirmed: false,
            stores: [{ storeId: store.id, destinedQuantity: "4.00" }],
          },
        ],
      }),
    ).rejects.toThrow(/confirmação explícita/i);

    // 2. Salvar com confirmação explícita DEVE ter sucesso
    const saveRes = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: prodOportunidade.id,
          isOpportunityConfirmed: true,
          notes: "Oportunidade confirmada com fornecedor",
          stores: [{ storeId: store.id, destinedQuantity: "4.00" }],
        },
      ],
    });
    expect(saveRes.success).toBe(true);

    // Confirma auditoria de criação de oportunidade
    const [auditCreate] = await db<{
      action: string;
      metadata: { destinedQuantity: string; isOpportunityConfirmed: boolean };
    }[]>`
      SELECT action, metadata
      FROM audit_events
      WHERE entity_type = 'purchase_cycle_product_allocation'
        AND action = 'OPPORTUNITY_ALLOCATION_CREATED'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(auditCreate).toBeDefined();
    expect(auditCreate.metadata.destinedQuantity).toBe("4.00");
    expect(auditCreate.metadata.isOpportunityConfirmed).toBe(true);

    // 3. Alterar quantidade de oportunidade salva (de 4.00 para 2.00) deve funcionar sem travar
    const updateRes = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: prodOportunidade.id,
          stores: [{ storeId: store.id, destinedQuantity: "2.00" }],
        },
      ],
    });
    expect(updateRes.success).toBe(true);

    // 4. Zerar destinação de oportunidade salva deve funcionar sem travar na regra de quantidade positiva
    const zeroRes = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: prodOportunidade.id,
          notes: "Cancelamento da compra de oportunidade",
          stores: [{ storeId: store.id, destinedQuantity: "0.00" }],
        },
      ],
    });
    expect(zeroRes.success).toBe(true);

    // Confirma que foi registrado evento ALLOCATION_ZEROED na tabela audit_events
    const [auditZero] = await db<{ action: string; actor_id: string; metadata: Record<string, unknown> }[]>`
      SELECT action, actor_id, metadata
      FROM audit_events
      WHERE entity_type = 'purchase_cycle_product_allocation'
        AND action = 'ALLOCATION_ZEROED'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(auditZero).toBeDefined();
    expect(auditZero.actor_id).toBe(buyerPrincipal.userId);
    expect(auditZero.metadata.previousDestinedQuantity).toBe("2.00");
    expect(auditZero.metadata.newDestinedQuantity).toBe("0.00");
    expect(auditZero.metadata.reason).toContain("Cancelamento da compra de oportunidade");
  });

  it("6. Auditoria de zeramento de destinação indevida (Regra C)", async () => {
    const cycleDate = "2026-10-25";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [supplier] = await db<{ id: string }[]>`SELECT id FROM suppliers LIMIT 1`;

    const [prodCaqui] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (6002, 'Caqui Rama Forte Auditoria', 'CX', 'KG', 30.00, true)
      RETURNING id
    `;

    // Cria pedido de loja no ciclo para o Caqui
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (store_id, order_date, purchase_cycle_date, revision, submitted_by, submitted_at, cutoff_at)
      VALUES (${store.id}::uuid, ${cycleDate}::date, ${cycleDate}::date, 1, ${buyerPrincipal.userId}::uuid, now(), now() + interval '1 hour')
      RETURNING id
    `;

    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${prodCaqui.id}::uuid, 0, 5.00, 6002, 'Caqui Rama Forte Auditoria', 'CX')
    `;

    // Custo marcado como NÃO comprado
    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      )
      VALUES (
        ${prodCaqui.id}, ${cycleDate}::date, 40.00, false, null, ${buyerPrincipal.userId}::uuid
      )
    `;

    // Simula destinação indevida pré-existente
    const [prevAlloc] = await db<{ id: string }[]>`
      INSERT INTO purchase_cycle_product_allocations (
        purchase_cycle_date, supplier_id, product_id, store_id,
        ordered_quantity, destined_quantity, purchase_format,
        created_by, updated_by
      )
      VALUES (
        ${cycleDate}::date, ${supplier.id}::uuid, ${prodCaqui.id}::uuid, ${store.id}::uuid,
        5.00, 3.00, 'CX',
        ${buyerPrincipal.userId}::uuid, ${buyerPrincipal.userId}::uuid
      )
      RETURNING id
    `;

    // Tentar salvar quantidade positiva DEVE ser bloqueado
    await expect(
      saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: supplier.id,
        allocations: [
          {
            productId: prodCaqui.id,
            stores: [{ storeId: store.id, destinedQuantity: "3.00" }],
          },
        ],
      }),
    ).rejects.toThrow(/não está marcado como comprado na tela de custos/i);

    // Zerar a destinação indevida DEVE ser permitido
    const zeroRes = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: prodCaqui.id,
          notes: "Correção de erro: produto não foi comprado",
          stores: [{ storeId: store.id, destinedQuantity: "0.00" }],
        },
      ],
    });
    expect(zeroRes.success).toBe(true);

    // Confirma rastreabilidade completa no audit_events
    const [auditZero] = await db<{
      action: string;
      actor_id: string;
      metadata: { previousDestinedQuantity: string; newDestinedQuantity: string; reason: string };
    }[]>`
      SELECT action, actor_id, metadata
      FROM audit_events
      WHERE entity_type = 'purchase_cycle_product_allocation'
        AND action = 'ALLOCATION_ZEROED'
        AND entity_id = ${prevAlloc.id}::text
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(auditZero).toBeDefined();
    expect(auditZero.actor_id).toBe(buyerPrincipal.userId);
    expect(auditZero.metadata.previousDestinedQuantity).toBe("3.00");
    expect(auditZero.metadata.newDestinedQuantity).toBe("0.00");
    expect(auditZero.metadata.reason).toContain("Correção de erro: produto não foi comprado");
  });

  it("7. Validação de pedidos em closeBuyerCycle utiliza a última revisão válida das lojas", async () => {
    const cycleDate = "2026-10-26";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [supplier] = await db<{ id: string }[]>`SELECT id FROM suppliers LIMIT 1`;

    const [prodSubstituido] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (6003, 'Abobrinha Revisao Histórica', 'CX', 'KG', 25.00, true)
      RETURNING id
    `;

    // Revisão 1: solicitava 10 CX de Abobrinha
    const [orderRev1] = await db<{ id: string }[]>`
      INSERT INTO orders (store_id, order_date, purchase_cycle_date, revision, submitted_by, submitted_at, cutoff_at)
      VALUES (${store.id}::uuid, ${cycleDate}::date, ${cycleDate}::date, 1, ${buyerPrincipal.userId}::uuid, now() - interval '1 hour', now() + interval '1 hour')
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${orderRev1.id}::uuid, ${prodSubstituido.id}::uuid, 0, 10.00, 6003, 'Abobrinha Revisao Histórica', 'CX')
    `;

    // Revisão 2 (mais recente): a loja cancelou a solicitação de Abobrinha (não inclui item de abobrinha)
    const [orderRev2] = await db<{ id: string }[]>`
      INSERT INTO orders (store_id, order_date, purchase_cycle_date, revision, submitted_by, submitted_at, cutoff_at)
      VALUES (${store.id}::uuid, ${cycleDate}::date, ${cycleDate}::date, 2, ${buyerPrincipal.userId}::uuid, now(), now() + interval '1 hour')
      RETURNING id
    `;
    // Outro produto na revisão 2
    const [prodComprado] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (6004, 'Batata Inglesa Rev2', 'SC', 'KG', 20.00, true)
      RETURNING id
    `;
    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${orderRev2.id}::uuid, ${prodComprado.id}::uuid, 0, 8.00, 6004, 'Batata Inglesa Rev2', 'SC')
    `;

    // Custo de Batata comprado nos custos
    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      )
      VALUES (
        ${prodComprado.id}, ${cycleDate}::date, 30.00, true, now(), ${buyerPrincipal.userId}::uuid
      )
    `;

    // Custo de Abobrinha marcado como NÃO comprado
    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      )
      VALUES (
        ${prodSubstituido.id}, ${cycleDate}::date, 25.00, false, null, ${buyerPrincipal.userId}::uuid
      )
    `;

    // Destina a Batata comprada
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: prodComprado.id,
          stores: [{ storeId: store.id, destinedQuantity: "8.00" }],
        },
      ],
    });

    // Se a Abobrinha tivesse destinação residual como compra de oportunidade (ou antes),
    // simula destinação residual de 2 CX
    await db`
      INSERT INTO purchase_cycle_product_allocations (
        purchase_cycle_date, supplier_id, product_id, store_id,
        ordered_quantity, destined_quantity, purchase_format,
        created_by, updated_by
      )
      VALUES (
        ${cycleDate}::date, ${supplier.id}::uuid, ${prodSubstituido.id}::uuid, ${store.id}::uuid,
        0.00, 2.00, 'CX',
        ${buyerPrincipal.userId}::uuid, ${buyerPrincipal.userId}::uuid
      )
    `;

    // O fechamento NÃO deve considerar a Abobrinha como "produto pedido e não comprado",
    // porque na última revisão válida (revisão 2) o pedido é ZERO!
    const closeRes = await closeBuyerCycle(buyerPrincipal, cycleDate);
    expect(closeRes.success).toBe(true);
  });

  it("8. Concorrência real entre gravação e fechamento no mesmo ciclo", async () => {
    const cycleDate = "2026-10-27";
    const [store] = await db<{ id: string }[]>`SELECT id FROM stores LIMIT 1`;
    const [supplier] = await db<{ id: string }[]>`SELECT id FROM suppliers LIMIT 1`;

    const [prod] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (6005, 'Alface Concorrente', 'CX', 'UN', 15.00, true)
      RETURNING id
    `;

    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      )
      VALUES (
        ${prod.id}, ${cycleDate}::date, 10.00, true, now(), ${buyerPrincipal.userId}::uuid
      )
    `;

    // Pré-destina o produto para permitir fechamento
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: prod.id,
          stores: [{ storeId: store.id, destinedQuantity: "5.00" }],
        },
      ],
    });

    // Dispara gravação e fechamento simultaneamente em transações paralelas
    const [resSave, resClose] = await Promise.allSettled([
      saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: supplier.id,
        allocations: [
          {
            productId: prod.id,
            stores: [{ storeId: store.id, destinedQuantity: "6.00" }],
          },
        ],
      }),
      closeBuyerCycle(buyerPrincipal, cycleDate),
    ]);

    // Ambas não podem provocar deadlock ou dados corrompidos.
    // O lock transacional serializa as duas operações:
    // Se o fechamento rodou primeiro, saveSupplierAllocations é rejeitado com CycleClosedError.
    // Se a gravação rodou primeiro, ambas têm sucesso.
    if (resClose.status === "fulfilled") {
      expect(resClose.value.success).toBe(true);
      if (resSave.status === "rejected") {
        expect(resSave.reason).toBeInstanceOf(CycleClosedError);
      } else {
        expect(resSave.value.success).toBe(true);
      }
    } else {
      expect(resSave.status).toBe("fulfilled");
    }
  });

  it("9. Auditoria completa de destinações: criação, alteração positiva (5 CX -> 3 CX), zeramento, mudança de fornecedor e deduplicação", async () => {
    const cycleDate = "2026-10-28";
    const [store] = await db<{ id: string; name: string }[]>`
      SELECT id, name FROM stores WHERE slug = 'ponta-da-fruta'
    `;

    const [supplierGordinho] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Fornecedor Gordinho Ltda', '77777777000177', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    const [supplierBenassi] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Fornecedor Benassi Ltda', '88888888000188', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;

    const [productMaracuja] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (7001, 'Maracujá Azedo Especial', 'CX', 'KG', 40.00, true)
      RETURNING id
    `;

    // Custo marcado como comprado
    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      )
      VALUES (
        ${productMaracuja.id}, ${cycleDate}::date, 45.00, true, now(), ${buyerPrincipal.userId}::uuid
      )
    `;

    // Pedido da loja Ponta da Fruta para o Maracujá: 5 CX
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (store_id, order_date, purchase_cycle_date, revision, submitted_by, submitted_at, cutoff_at)
      VALUES (${store.id}::uuid, ${cycleDate}::date, ${cycleDate}::date, 1, ${buyerPrincipal.userId}::uuid, now(), now() + interval '1 hour')
      RETURNING id
    `;

    await db`
      INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
      VALUES (${order.id}::uuid, ${productMaracuja.id}::uuid, 0, 5.00, 7001, 'Maracujá Azedo Especial', 'CX')
    `;

    // ETAPA 1: Criação de destinação normal inicial (0.00 -> 5.00 CX) no Fornecedor Gordinho
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierGordinho.id,
      allocations: [
        {
          productId: productMaracuja.id,
          stores: [{ storeId: store.id, destinedQuantity: "5.00", notes: "Lote selecionado na Ceasa" }],
        },
      ],
    });

    const eventsStep1 = await db<
      {
        action: string;
        actor_id: string;
        created_at: Date;
        metadata: {
          cycleDate: string;
          supplierId: string;
          supplierName: string;
          productId: string;
          productName: string;
          storeId: string;
          storeName: string;
          previousDestinedQuantity: string;
          newDestinedQuantity: string;
          reason: string;
        };
      }[]
    >`
      SELECT action, actor_id, created_at, metadata
      FROM audit_events
      WHERE entity_type = 'purchase_cycle_product_allocation'
        AND metadata->>'productId' = ${productMaracuja.id}
      ORDER BY created_at ASC
    `;

    expect(eventsStep1).toHaveLength(1);
    expect(eventsStep1[0].action).toBe("ALLOCATION_CREATED");
    expect(eventsStep1[0].actor_id).toBe(buyerPrincipal.userId);
    expect(eventsStep1[0].metadata.cycleDate).toBe(cycleDate);
    expect(eventsStep1[0].metadata.supplierId).toBe(supplierGordinho.id);
    expect(eventsStep1[0].metadata.supplierName).toBe("Fornecedor Gordinho Ltda");
    expect(eventsStep1[0].metadata.storeId).toBe(store.id);
    expect(eventsStep1[0].metadata.storeName).toBe(store.name);
    expect(eventsStep1[0].metadata.previousDestinedQuantity).toBe("0.00");
    expect(eventsStep1[0].metadata.newDestinedQuantity).toBe("5.00");
    expect(eventsStep1[0].metadata.reason).toBe("Lote selecionado na Ceasa");

    // ETAPA 2: Alteração de quantidade positiva para outra positiva (5.00 CX -> 3.00 CX)
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierGordinho.id,
      allocations: [
        {
          productId: productMaracuja.id,
          stores: [{ storeId: store.id, destinedQuantity: "3.00", notes: "Ajuste de corte na doca" }],
        },
      ],
    });

    const eventsStep2 = await db<
      {
        action: string;
        actor_id: string;
        created_at: Date;
        metadata: {
          previousDestinedQuantity: string;
          newDestinedQuantity: string;
          supplierId: string;
          reason: string;
        };
      }[]
    >`
      SELECT action, actor_id, created_at, metadata
      FROM audit_events
      WHERE entity_type = 'purchase_cycle_product_allocation'
        AND metadata->>'productId' = ${productMaracuja.id}
      ORDER BY created_at ASC
    `;

    expect(eventsStep2).toHaveLength(2);
    expect(eventsStep2[1].action).toBe("ALLOCATION_UPDATED");
    expect(eventsStep2[1].actor_id).toBe(buyerPrincipal.userId);
    expect(eventsStep2[1].metadata.previousDestinedQuantity).toBe("5.00");
    expect(eventsStep2[1].metadata.newDestinedQuantity).toBe("3.00");
    expect(eventsStep2[1].metadata.supplierId).toBe(supplierGordinho.id);
    expect(eventsStep2[1].metadata.reason).toBe("Ajuste de corte na doca");

    // ETAPA 3: Deduplicação - salvar novamente 3.00 CX sem alteração de quantidade não gera evento duplicado
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierGordinho.id,
      allocations: [
        {
          productId: productMaracuja.id,
          stores: [{ storeId: store.id, destinedQuantity: "3.00", notes: "Sem alteração" }],
        },
      ],
    });

    const eventsStep3 = await db`
      SELECT id FROM audit_events
      WHERE entity_type = 'purchase_cycle_product_allocation'
        AND metadata->>'productId' = ${productMaracuja.id}
    `;
    expect(eventsStep3).toHaveLength(2); // Inalterado!

    // ETAPA 4: Mudança de fornecedor (Transferência de Gordinho para Benassi)
    // 4.1: Zeramento no fornecedor Gordinho (3.00 CX -> 0.00 CX)
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierGordinho.id,
      allocations: [
        {
          productId: productMaracuja.id,
          stores: [{ storeId: store.id, destinedQuantity: "0.00", notes: "Transferido para Benassi por melhor preço" }],
        },
      ],
    });

    const eventsStep4A = await db<
      {
        action: string;
        metadata: {
          previousDestinedQuantity: string;
          newDestinedQuantity: string;
          supplierId: string;
          reason: string;
        };
      }[]
    >`
      SELECT action, metadata
      FROM audit_events
      WHERE entity_type = 'purchase_cycle_product_allocation'
        AND metadata->>'productId' = ${productMaracuja.id}
      ORDER BY created_at ASC
    `;

    expect(eventsStep4A).toHaveLength(3);
    expect(eventsStep4A[2].action).toBe("ALLOCATION_ZEROED");
    expect(eventsStep4A[2].metadata.previousDestinedQuantity).toBe("3.00");
    expect(eventsStep4A[2].metadata.newDestinedQuantity).toBe("0.00");
    expect(eventsStep4A[2].metadata.supplierId).toBe(supplierGordinho.id);
    expect(eventsStep4A[2].metadata.reason).toBe("Transferido para Benassi por melhor preço");

    // 4.2: Inclusão no novo fornecedor Benassi (0.00 -> 3.00 CX)
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierBenassi.id,
      allocations: [
        {
          productId: productMaracuja.id,
          stores: [{ storeId: store.id, destinedQuantity: "3.00", notes: "Entrada pelo Fornecedor Benassi" }],
        },
      ],
    });

    const eventsStep4B = await db<
      {
        action: string;
        metadata: {
          cycleDate: string;
          supplierId: string;
          supplierName: string;
          storeId: string;
          storeName: string;
          previousDestinedQuantity: string;
          newDestinedQuantity: string;
          reason: string;
        };
      }[]
    >`
      SELECT action, metadata
      FROM audit_events
      WHERE entity_type = 'purchase_cycle_product_allocation'
        AND metadata->>'productId' = ${productMaracuja.id}
      ORDER BY created_at ASC
    `;

    // Total de 4 eventos no histórico com rastreabilidade cronológica completa
    expect(eventsStep4B).toHaveLength(4);

    // Evento 1: Criação em Gordinho
    expect(eventsStep4B[0].action).toBe("ALLOCATION_CREATED");
    expect(eventsStep4B[0].metadata.supplierId).toBe(supplierGordinho.id);
    expect(eventsStep4B[0].metadata.newDestinedQuantity).toBe("5.00");

    // Evento 2: Redução em Gordinho (5 -> 3)
    expect(eventsStep4B[1].action).toBe("ALLOCATION_UPDATED");
    expect(eventsStep4B[1].metadata.supplierId).toBe(supplierGordinho.id);
    expect(eventsStep4B[1].metadata.previousDestinedQuantity).toBe("5.00");
    expect(eventsStep4B[1].metadata.newDestinedQuantity).toBe("3.00");

    // Evento 3: Zeramento em Gordinho (3 -> 0)
    expect(eventsStep4B[2].action).toBe("ALLOCATION_ZEROED");
    expect(eventsStep4B[2].metadata.supplierId).toBe(supplierGordinho.id);
    expect(eventsStep4B[2].metadata.previousDestinedQuantity).toBe("3.00");
    expect(eventsStep4B[2].metadata.newDestinedQuantity).toBe("0.00");

    // Evento 4: Criação em Benassi (0 -> 3)
    expect(eventsStep4B[3].action).toBe("ALLOCATION_CREATED");
    expect(eventsStep4B[3].metadata.supplierId).toBe(supplierBenassi.id);
    expect(eventsStep4B[3].metadata.supplierName).toBe("Fornecedor Benassi Ltda");
    expect(eventsStep4B[3].metadata.previousDestinedQuantity).toBe("0.00");
    expect(eventsStep4B[3].metadata.newDestinedQuantity).toBe("3.00");
    expect(eventsStep4B[3].metadata.reason).toBe("Entrada pelo Fornecedor Benassi");
  });

  it("10. Quantidade sugerida do pedido permanece pendente e pode ser confirmada sem edição artificial", async () => {
    const cycleDate = "2026-11-03";
    const [store] = await db<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'balneario'
    `;
    const [supplier] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('União Frutas Teste', '91000000000191', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
    const [product] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9101, 'Uva Vitória Integração', 'CX', 'CX', 35.00, true)
      RETURNING id
    `;
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active)
      VALUES (${product.id}::uuid, ${supplier.id}::uuid, true, false, true)
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      ) VALUES (${product.id}::uuid, ${cycleDate}::date, 50, true, now(), ${buyerPrincipal.userId}::uuid)
    `;
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (
        store_id, order_date, purchase_cycle_date, revision, submitted_by, submitted_at, cutoff_at
      ) VALUES (
        ${store.id}::uuid, ${cycleDate}::date, ${cycleDate}::date, 1,
        ${buyerPrincipal.userId}::uuid, now(), now() + interval '1 hour'
      ) RETURNING id
    `;
    await db`
      INSERT INTO order_items (
        order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit
      ) VALUES (${order.id}::uuid, ${product.id}::uuid, 0, 5, 9101, 'Uva Vitória Integração', 'CX')
    `;

    const before = await readBuyerAllocationWorkspace(
      buyerPrincipal,
      cycleDate,
      supplier.id,
      store.id,
    );
    const suggestion = before.destinationData?.products.find((item) => item.productId === product.id);
    expect(before.cycleStoreOrders[product.id]?.[store.id]).toBe("5.00");
    expect(suggestion?.stores[store.id]).toMatchObject({
      orderedQuantity: "5.00",
      destinedQuantity: "5.00",
      persistedDestinedQuantity: null,
    });

    const saved = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      storeId: store.id,
      allocations: [{
        productId: product.id,
        stores: [{ storeId: store.id, destinedQuantity: "5.00" }],
      }],
    });
    expect(saved.affectedProductsCount).toBe(1);

    const after = await readBuyerAllocationWorkspace(
      buyerPrincipal,
      cycleDate,
      supplier.id,
      store.id,
    );
    expect(
      after.destinationData?.products.find((item) => item.productId === product.id)?.stores[store.id],
    ).toMatchObject({
      orderedQuantity: "5.00",
      destinedQuantity: "5.00",
      persistedDestinedQuantity: "5.00",
    });

    const unchanged = await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      storeId: store.id,
      allocations: [{
        productId: product.id,
        stores: [{ storeId: store.id, destinedQuantity: "5.00" }],
      }],
    });
    expect(unchanged.affectedProductsCount).toBe(0);
    const [stored] = await db<{ version: number }[]>`
      SELECT version FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${cycleDate}::date
        AND supplier_id = ${supplier.id}::uuid
        AND product_id = ${product.id}::uuid
        AND store_id = ${store.id}::uuid
    `;
    expect(stored.version).toBe(1);
  });

  it("11. Exige escolha explícita, audita split e transfere entre fornecedores atomicamente", async () => {
    const cycleDate = "2026-11-04";
    const [store] = await db<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'ponta-da-fruta'
    `;
    const suppliers = await db<{ id: string; corporate_name: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES
        ('Fornecedor Divisão A', '92000000000192', 'CNPJ', 'STANDARD', true),
        ('Fornecedor Divisão B', '93000000000193', 'CNPJ', 'STANDARD', true),
        ('Fornecedor Transferência C', '94000000000194', 'CNPJ', 'STANDARD', true)
      RETURNING id, corporate_name
    `;
    const [supplierA, supplierB, supplierC] = suppliers;
    const [product] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9201, 'Banana Divisão Integração', 'CX', 'KG', 35.00, true)
      RETURNING id
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      ) VALUES (${product.id}::uuid, ${cycleDate}::date, 75, true, now(), ${buyerPrincipal.userId}::uuid)
    `;
    const [order] = await db<{ id: string }[]>`
      INSERT INTO orders (
        store_id, order_date, purchase_cycle_date, revision, submitted_by, submitted_at, cutoff_at
      ) VALUES (
        ${store.id}::uuid, ${cycleDate}::date, ${cycleDate}::date, 1,
        ${buyerPrincipal.userId}::uuid, now(), now() + interval '1 hour'
      ) RETURNING id
    `;
    await db`
      INSERT INTO order_items (
        order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit
      ) VALUES (${order.id}::uuid, ${product.id}::uuid, 0, 6, 9201, 'Banana Divisão Integração', 'CX')
    `;

    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierA.id,
      storeId: store.id,
      allocations: [{
        productId: product.id,
        stores: [{ storeId: store.id, destinedQuantity: "6.00" }],
      }],
    });

    const splitFingerprint = await captureConflictFingerprint(saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierB.id,
      storeId: store.id,
      allocations: [{
        productId: product.id,
        stores: [{ storeId: store.id, destinedQuantity: "6.00" }],
      }],
    }));

    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierA.id,
      storeId: store.id,
      allocations: [{
        productId: product.id,
        stores: [{ storeId: store.id, destinedQuantity: "5.00" }],
      }],
    });

    const refreshedSplitFingerprint = await captureConflictFingerprint(
      saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: supplierB.id,
        storeId: store.id,
        allocations: [{
          productId: product.id,
          stores: [{
            storeId: store.id,
            destinedQuantity: "6.00",
            conflictResolution: "SPLIT_CONFIRMED",
            conflictFingerprint: splitFingerprint,
          }],
        }],
      }),
    );

    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierB.id,
      storeId: store.id,
      allocations: [{
        productId: product.id,
        stores: [{
          storeId: store.id,
          destinedQuantity: "6.00",
          conflictResolution: "SPLIT_CONFIRMED",
          conflictFingerprint: refreshedSplitFingerprint,
        }],
      }],
    });

    const splitRows = await db<{ supplier_id: string; destined_quantity: string }[]>`
      SELECT supplier_id, destined_quantity::text
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${cycleDate}::date
        AND product_id = ${product.id}::uuid
        AND store_id = ${store.id}::uuid
        AND destined_quantity > 0
      ORDER BY supplier_id
    `;
    expect(splitRows).toHaveLength(2);
    expect(splitRows.map((row) => row.destined_quantity).sort()).toEqual(["5.00", "6.00"]);

    const [splitAudit] = await db<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata FROM audit_events
      WHERE action = 'ALLOCATION_SPLIT_CONFIRMED'
        AND metadata->>'productId' = ${product.id}
    `;
    expect(splitAudit.metadata).toMatchObject({
      orderedQuantity: "6.00",
      intendedQuantity: "6.00",
      resolution: "SPLIT_CONFIRMED",
    });

    const transferFingerprint = await captureConflictFingerprint(saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierC.id,
      storeId: store.id,
      allocations: [{
        productId: product.id,
        stores: [{ storeId: store.id, destinedQuantity: "7.00" }],
      }],
    }));
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplierC.id,
      storeId: store.id,
      allocations: [{
        productId: product.id,
        stores: [{
          storeId: store.id,
          destinedQuantity: "7.00",
          conflictResolution: "TRANSFER",
          conflictFingerprint: transferFingerprint,
        }],
      }],
    });

    const transferredRows = await db<{ supplier_id: string; destined_quantity: string }[]>`
      SELECT supplier_id, destined_quantity::text
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${cycleDate}::date
        AND product_id = ${product.id}::uuid
        AND store_id = ${store.id}::uuid
      ORDER BY supplier_id
    `;
    expect(transferredRows).toHaveLength(3);
    expect(transferredRows.filter((row) => row.destined_quantity === "0.00")).toHaveLength(2);
    expect(transferredRows).toContainEqual({
      supplier_id: supplierC.id,
      destined_quantity: "7.00",
    });

    const transferAudits = await db`
      SELECT id FROM audit_events
      WHERE action = 'ALLOCATION_TRANSFERRED'
        AND metadata->>'productId' = ${product.id}
        AND metadata->>'destinationSupplierId' = ${supplierC.id}
    `;
    expect(transferAudits).toHaveLength(2);
  });

  it("12. Serializa gravações concorrentes e impede duplicação silenciosa", async () => {
    const cycleDate = "2026-11-05";
    const [store] = await db<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'santa-monica'
    `;
    const suppliers = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES
        ('Fornecedor Concorrente A', '95000000000195', 'CNPJ', 'STANDARD', true),
        ('Fornecedor Concorrente B', '96000000000196', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
    const [product] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9301, 'Produto Concorrente Integração', 'CX', 'KG', 35.00, true)
      RETURNING id
    `;
    await db`
      INSERT INTO purchase_cycle_product_costs (
        product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
      ) VALUES (${product.id}::uuid, ${cycleDate}::date, 40, true, now(), ${buyerPrincipal.userId}::uuid)
    `;

    const outcomes = await Promise.allSettled(suppliers.map((supplier) =>
      saveSupplierAllocations(buyerPrincipal, {
        cycleDate,
        supplierId: supplier.id,
        storeId: store.id,
        allocations: [{
          productId: product.id,
          isOpportunityConfirmed: true,
          stores: [{ storeId: store.id, destinedQuantity: "4.00" }],
        }],
      }),
    ));

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toBeDefined();
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(AllocationDestinationConflictError);
    }
    const positiveRows = await db`
      SELECT id FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${cycleDate}::date
        AND product_id = ${product.id}::uuid
        AND store_id = ${store.id}::uuid
        AND destined_quantity > 0
    `;
    expect(positiveRows).toHaveLength(1);
  });
});
