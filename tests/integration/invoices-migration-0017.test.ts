import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  createInvoiceRecord,
  deleteInvoiceRecord,
  getInvoiceById,
  listInvoicesForCycleAndStore,
} from "../../src/modules/purchasing/invoices/repository";
import {
  CycleClosedError,
  InvoiceValidationError,
} from "../../src/modules/purchasing/invoices/domain";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Fase 4: Migração 0017 e Repositório de Notas Fiscais", () => {
  const stamp = Date.now();
  const testDbName = `test_db_invoices_${stamp}`;
  let baseDatabaseUrl: string;
  let testDatabaseUrl: string;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  let storeId: string;
  const supplierId = "20000000-0000-0000-0000-000000000001";
  const productId = "30000000-0000-0000-0000-000000000001";
  const unallocatedProductId = "30000000-0000-0000-0000-000000000002";
  const userId = "40000000-0000-0000-0000-000000000001";
  const cycleDate = "2026-10-27";

  beforeAll(async () => {
    baseDatabaseUrl = process.env.DATABASE_URL!;
    adminClient = postgres(baseDatabaseUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);

    const url = new URL(baseDatabaseUrl);
    url.pathname = `/${testDbName}`;
    testDatabaseUrl = url.toString();

    await runMigrations({
      databaseUrl: testDatabaseUrl,
      migrationsDirectory: path.resolve("migrations"),
    });

    db = postgres(testDatabaseUrl, { max: 5 });
    process.env.DATABASE_URL = testDatabaseUrl;

    // 1. Reutiliza loja existente criada pela migração 0001
    const [existingStore] = await db<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'ponta-da-fruta'
    `;
    storeId = existingStore.id;

    // 2. Cria fornecedor
    await db`
      INSERT INTO suppliers (id, corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES (${supplierId}, 'Simão Frutas LTDA', 'Simão', '12345678000199', 'CNPJ', 'STANDARD', true)
    `;

    // 3. Cria produtos
    await db`
      INSERT INTO products (id, erp_code, name, unit, purchase_format, markup, active)
      VALUES 
        (${productId}, 101, 'Banana Prata', 'KG', 'CX', 30.00, true),
        (${unallocatedProductId}, 102, 'Maçã Fuji', 'KG', 'CX', 35.00, true)
    `;

    // 4. Cria usuário com permissão de destinação
    await db`
      INSERT INTO users (id, name, email, password_hash, role, active, permissions)
      VALUES (${userId}, 'Comprador Teste', 'comprador@multishow.com', 'hash', 'COMPRADOR', true, ARRAY['compras:destinacao']::text[])
    `;

    // 5. Cria destinação positiva para o produto 101 (necessária para vincular nota na Fase 4)
    await db`
      INSERT INTO purchase_cycle_product_allocations (
        purchase_cycle_date,
        supplier_id,
        product_id,
        store_id,
        destined_quantity,
        version
      ) VALUES (
        ${cycleDate}::date,
        ${supplierId}::uuid,
        ${productId}::uuid,
        ${storeId}::uuid,
        15.00,
        1
      )
    `;
  });

  afterAll(async () => {
    try {
      database().sql.end({ timeout: 2 }).catch(() => {});
    } catch {
      // Ignora erro de encerramento do pool da app
    }
    if (db) await db.end({ timeout: 2 });
    if (adminClient) {
      await adminClient.unsafe(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${testDbName}' AND pid <> pg_backend_pid()
      `);
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${testDbName}"`);
      await adminClient.end({ timeout: 2 });
    }
    process.env.DATABASE_URL = baseDatabaseUrl;
  });

  it("insere nota fiscal vinculada a ciclo, loja e fornecedor com validação de produtos destinados", async () => {
    const created = await createInvoiceRecord({
      cycleDate,
      storeId,
      supplierId,
      invoiceNumber: "NF-99881",
      imageS3Key: `invoices/${cycleDate}/${storeId}/${supplierId}/uuid1.webp`,
      contentType: "image/webp",
      fileSizeBytes: 245000,
      notes: "Nota entregue na parte da manhã",
      createdBy: userId,
      productIds: [productId],
    });

    expect(created.id).toBeTruthy();
    expect(created.invoiceNumber).toBe("NF-99881");
    expect(created.itemProductIds).toEqual([productId]);

    // Consulta pelo ID
    const found = await getInvoiceById(created.id);
    expect(found).not.toBeNull();
    expect(found?.invoiceNumber).toBe("NF-99881");
    expect(found?.fileSizeBytes).toBe(245000);
    expect(found?.itemProductIds).toContain(productId);

    // Consulta por ciclo e loja
    const list = await listInvoicesForCycleAndStore(cycleDate, storeId);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(created.id);

    // Confirma gravação atômica da auditoria
    const [audit] = await db<{ action: string; entity_id: string }[]>`
      SELECT action, entity_id
      FROM audit_events
      WHERE entity_id = ${created.id}
    `;
    expect(audit).toBeDefined();
    expect(audit.action).toBe("INVOICE_REGISTERED");
  });

  it("rejeita vincular produto sem destinação positiva para a loja/fornecedor", async () => {
    await expect(
      createInvoiceRecord({
        cycleDate,
        storeId,
        supplierId,
        invoiceNumber: "NF-INVALID-PROD",
        imageS3Key: `invoices/${cycleDate}/${storeId}/${supplierId}/uuid-err.webp`,
        contentType: "image/webp",
        fileSizeBytes: 100000,
        createdBy: userId,
        productIds: [unallocatedProductId], // Sem destinação
      })
    ).rejects.toThrow(InvoiceValidationError);
  });

  it("impede duplicação do mesmo número de nota fiscal no mesmo ciclo, loja e fornecedor", async () => {
    await expect(
      createInvoiceRecord({
        cycleDate,
        storeId,
        supplierId,
        invoiceNumber: "NF-99881",
        imageS3Key: `invoices/${cycleDate}/${storeId}/${supplierId}/uuid2.webp`,
        contentType: "image/webp",
        fileSizeBytes: 120000,
        createdBy: userId,
      })
    ).rejects.toThrow();
  });

  it("permite registrar uma segunda nota diferente para a mesma loja e fornecedor", async () => {
    const second = await createInvoiceRecord({
      cycleDate,
      storeId,
      supplierId,
      invoiceNumber: "NF-99882",
      imageS3Key: `invoices/${cycleDate}/${storeId}/${supplierId}/uuid3.webp`,
      contentType: "image/webp",
      fileSizeBytes: 310000,
      createdBy: userId,
    });

    expect(second.invoiceNumber).toBe("NF-99882");
    const list = await listInvoicesForCycleAndStore(cycleDate, storeId);
    expect(list.length).toBe(2);
  });

  it("exclui nota fiscal e grava auditoria atomicamente", async () => {
    const toDelete = await createInvoiceRecord({
      cycleDate,
      storeId,
      supplierId,
      invoiceNumber: "NF-DELETE-ME",
      imageS3Key: `invoices/${cycleDate}/${storeId}/${supplierId}/uuid-del.webp`,
      contentType: "image/webp",
      fileSizeBytes: 50000,
      createdBy: userId,
      productIds: [productId],
    });

    const deleted = await deleteInvoiceRecord(toDelete.id, userId);
    expect(deleted).not.toBeNull();
    expect(deleted?.id).toBe(toDelete.id);

    const check = await getInvoiceById(toDelete.id);
    expect(check).toBeNull();

    // Confirma auditoria de exclusão
    const [audit] = await db<{ action: string }[]>`
      SELECT action FROM audit_events WHERE entity_id = ${toDelete.id} AND action = 'INVOICE_DELETED'
    `;
    expect(audit).toBeDefined();
    expect(audit.action).toBe("INVOICE_DELETED");
  });

  it("impede exclusão de nota fiscal quando o ciclo estiver fechado", async () => {
    const inv = await createInvoiceRecord({
      cycleDate,
      storeId,
      supplierId,
      invoiceNumber: "NF-LOCKED-CYCLE",
      imageS3Key: `invoices/${cycleDate}/${storeId}/${supplierId}/uuid-locked.webp`,
      contentType: "image/webp",
      fileSizeBytes: 50000,
      createdBy: userId,
    });

    // Simula fechamento do ciclo
    await db`
      INSERT INTO purchase_cycle_buyer_closures (
        purchase_cycle_date,
        status,
        closed_at,
        closed_by,
        total_purchased_products,
        total_allocated_products,
        version
      ) VALUES (
        ${cycleDate}::date,
        'CLOSED',
        now(),
        ${userId}::uuid,
        1,
        1,
        1
      )
    `;

    await expect(deleteInvoiceRecord(inv.id, userId)).rejects.toThrow(CycleClosedError);

    // Reabre para não sujar próximos testes
    await db`
      DELETE FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${cycleDate}::date
    `;
  });
});
