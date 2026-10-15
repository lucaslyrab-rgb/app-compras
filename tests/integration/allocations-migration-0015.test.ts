import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  closeBuyerCycle,
  reopenBuyerCycle,
  saveSupplierAllocations,
} from "../../src/modules/purchasing/allocations/repository";
import { loadSupplierBillingReport } from "../../src/modules/purchasing/reports/supplier-billing/repository";
import {
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

    // Destina 5 CX para a loja sem pedido original
    await saveSupplierAllocations(buyerPrincipal, {
      cycleDate,
      supplierId: supplier.id,
      allocations: [
        {
          productId: productOportunidade.id,
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

    await saveSupplierAllocations(buyerPrincipal, {
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
            stores: [{ storeId: store.id, destinedQuantity: "10.00" }],
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
});
