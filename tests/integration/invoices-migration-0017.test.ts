import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  createInvoiceRecord,
  deleteInvoiceRecord,
  getInvoiceById,
  listInvoicesForCycleAndStore,
} from "../../src/modules/purchasing/invoices/repository";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Fase 4: Migração 0017 e Repositório de Notas Fiscais", () => {
  const stamp = Date.now();
  const testDbName = `test_db_invoices_${stamp}`;
  let baseDatabaseUrl: string;
  let testDatabaseUrl: string;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  const storeId = "10000000-0000-0000-0000-000000000001";
  const supplierId = "20000000-0000-0000-0000-000000000001";
  const productId = "30000000-0000-0000-0000-000000000001";
  const userId = "40000000-0000-0000-0000-000000000001";
  const cycleDate = "2026-10-27";

  beforeAll(async () => {
    baseDatabaseUrl = process.env.DATABASE_URL!;
    adminClient = postgres(baseDatabaseUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE ${testDbName}`);

    const url = new URL(baseDatabaseUrl);
    url.pathname = `/${testDbName}`;
    testDatabaseUrl = url.toString();

    await runMigrations({
      databaseUrl: testDatabaseUrl,
      migrationsDirectory: path.resolve("migrations"),
    });

    db = postgres(testDatabaseUrl, { max: 5 });
    process.env.DATABASE_URL = testDatabaseUrl;

    // Seed básico para foreign keys
    await db`
      INSERT INTO stores (id, name, slug)
      VALUES (${storeId}, 'MultiShow Ponta da Fruta', 'ponta-da-fruta')
    `;

    await db`
      INSERT INTO suppliers (id, corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES (${supplierId}, 'Simão Frutas LTDA', 'Simão', '12345678000199', 'CNPJ', 'STANDARD', true)
    `;

    await db`
      INSERT INTO products (id, erp_code, name, unit, purchase_format, markup, active)
      VALUES (${productId}, 101, 'Banana Prata', 'KG', 'CX', 30.00, true)
    `;

    await db`
      INSERT INTO users (id, name, email, password_hash, role, active, permissions)
      VALUES (${userId}, 'Comprador Teste', 'comprador@multishow.com', 'hash', 'COMPRADOR', true, ARRAY['compras:destinacao']::text[])
    `;
  });

  afterAll(async () => {
    if (db) await db.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP DATABASE IF EXISTS ${testDbName}`);
      await adminClient.end();
    }
  });

  it("insere nota fiscal vinculada a ciclo, loja e fornecedor com itens", async () => {
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

  it("exclui nota fiscal e remove em cascata os itens vinculados", async () => {
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

    const deleted = await deleteInvoiceRecord(toDelete.id);
    expect(deleted).not.toBeNull();
    expect(deleted?.id).toBe(toDelete.id);

    const check = await getInvoiceById(toDelete.id);
    expect(check).toBeNull();
  });
});
