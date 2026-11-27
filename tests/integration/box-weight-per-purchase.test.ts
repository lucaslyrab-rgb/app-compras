import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  readBuyerAllocationWorkspace,
  saveSupplierAllocations,
  setCycleBoxWeight,
} from "../../src/modules/purchasing/allocations/repository";
import { AllocationValidationError, CycleClosedError } from "../../src/modules/purchasing/allocations/domain";
import { setSupplierBoxWeight } from "../../src/modules/suppliers/product-suppliers-repository";
import type { Principal } from "../../src/modules/identity";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Peso da caixa por compra (0027)", () => {
  const testDbName = `test_db_box_weight_${Date.now()}`;
  const originalUrl = process.env.DATABASE_URL!;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  const cycleDate = "2026-11-30";
  const buyer: Principal = {
    userId: "91000000-0000-0000-0000-000000000001",
    role: "COMPRADOR",
    storeId: null,
    permissions: ["compras:destinacao", "compras:custos", "compras:fornecedores"],
  };
  let ponta: string;
  let balneario: string;
  let santa: string;
  let maca: string;
  let couve: string;
  let vale: string;
  let bomPreco: string;

  const factors = async (productId: string, supplierId: string) =>
    db<{ store_id: string; factor: string; origin: string | null }[]>`
      SELECT store_id, conversion_factor_kg::float8::text AS factor, conversion_origin AS origin
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${cycleDate}::date AND product_id = ${productId}::uuid AND supplier_id = ${supplierId}::uuid
      ORDER BY store_id
    `;

  beforeAll(async () => {
    adminClient = postgres(originalUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);
    const url = new URL(originalUrl);
    url.pathname = `/${testDbName}`;
    await runMigrations({ databaseUrl: url.toString(), migrationsDirectory: path.resolve("migrations") });
    db = postgres(url.toString(), { max: 5 });
    process.env.DATABASE_URL = url.toString();

    const stores = await db<{ id: string; slug: string }[]>`SELECT id, slug FROM stores`;
    ponta = stores.find((s) => s.slug === "ponta-da-fruta")!.id;
    balneario = stores.find((s) => s.slug === "balneario")!.id;
    santa = stores.find((s) => s.slug === "santa-monica")!.id;
    await db`
      INSERT INTO users (id, name, email, password_hash, role, store_id, permissions, active)
      VALUES (${buyer.userId}, 'Christian', 'christian.bw@multishow.local', '$scrypt$x', 'COMPRADOR', NULL,
        ARRAY['compras:destinacao','compras:custos','compras:fornecedores']::text[], true)
    `;
    [{ id: maca }] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9501, 'MACA GALA BW', 'CX', 'KG', 25, true) RETURNING id
    `;
    [{ id: couve }] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9502, 'COUVE BW', 'CX', 'UND', 25, true) RETURNING id
    `;
    await db`
      INSERT INTO product_pricing_parameters (product_id, sale_unit, conversion_quantity, conversion_origin, beneficiation_loss_percent)
      VALUES (${maca}, 'KG', 18, 'MANUAL', 0), (${couve}, 'UND', 12, 'MANUAL', 0)
      ON CONFLICT (product_id) DO UPDATE SET sale_unit = EXCLUDED.sale_unit, conversion_quantity = EXCLUDED.conversion_quantity
    `;
    [{ id: vale }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Frutas do Vale Ltda', 'Frutas do Vale', '66666666000166', 'CNPJ', 'STANDARD', true) RETURNING id
    `;
    [{ id: bomPreco }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Comercial Bom Preco Ltda', 'Bom Preco', '77777777000177', 'CNPJ', 'STANDARD', true) RETURNING id
    `;
    await db`
      INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active)
      VALUES (${maca}, ${vale}, true, false, true), (${maca}, ${bomPreco}, false, false, true)
    `;
    for (const storeId of [ponta, balneario, santa]) {
      const [order] = await db<{ id: string }[]>`
        INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
        VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storeId}::uuid, 1, now(), ${buyer.userId}::uuid)
        RETURNING id
      `;
      await db`
        INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
        VALUES (${order.id}::uuid, ${maca}::uuid, 0, 2, 9501, 'MACA GALA BW', 'CX'),
               (${order.id}::uuid, ${couve}::uuid, 0, 1, 9502, 'COUVE BW', 'CX')
      `;
    }
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${maca}::uuid, 150.00, true, now(), ${buyer.userId}::uuid),
             (${cycleDate}::date, ${couve}::uuid, 30.00, true, now(), ${buyer.userId}::uuid)
    `;
  });

  afterAll(async () => {
    try {
      await database().sql.end({ timeout: 5 });
    } catch {}
    process.env.DATABASE_URL = originalUrl;
    if (db) await db.end({ timeout: 5 });
    if (adminClient) {
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
      await adminClient.end({ timeout: 5 });
    }
  });

  it("sem ajuste: a destinação guarda a conversão do produto e a tela mostra 18 kg", async () => {
    await saveSupplierAllocations(buyer, {
      cycleDate,
      supplierId: vale,
      allocations: [{ productId: maca, stores: [{ storeId: ponta, destinedQuantity: "1.00" }, { storeId: balneario, destinedQuantity: "2.00" }] }],
    });
    expect((await factors(maca, vale)).map((r) => r.factor)).toEqual(["18", "18"]);
    const ws = await readBuyerAllocationWorkspace(buyer, cycleDate, vale, ponta);
    const item = ws.destinationData!.products.find((p) => p.productId === maca)!;
    expect(item.boxWeight).toEqual({ kg: "18", source: "PRODUCT", defaultKg: "18", defaultSource: "PRODUCT", lastKg: null, supplierLinked: true });
  });

  it("peso da compra vale para todas as lojas do fornecedor, inclusive as destinadas depois", async () => {
    const result = await setCycleBoxWeight(buyer, { cycleDate, supplierId: vale, productId: maca, weightKg: "10" });
    expect(result).toEqual({ weightKg: "10", updatedAllocations: 2, savedAsDefault: false });
    expect((await factors(maca, vale)).map((r) => [r.factor, r.origin])).toEqual([
      ["10", "CYCLE_BOX_WEIGHT"],
      ["10", "CYCLE_BOX_WEIGHT"],
    ]);

    await saveSupplierAllocations(buyer, {
      cycleDate,
      supplierId: vale,
      allocations: [{ productId: maca, stores: [{ storeId: santa, destinedQuantity: "2.00" }] }],
    });
    expect((await factors(maca, vale)).map((r) => r.factor)).toEqual(["10", "10", "10"]);

    const ws = await readBuyerAllocationWorkspace(buyer, cycleDate, vale, santa);
    expect(ws.destinationData!.products.find((p) => p.productId === maca)!.boxWeight).toMatchObject({
      kg: "10", source: "CYCLE", defaultKg: "18",
    });
    // Outro fornecedor do mesmo produto não muda.
    const [{ count }] = await db<{ count: string }[]>`
      SELECT count(*)::text FROM purchase_cycle_box_weights WHERE supplier_id = ${bomPreco}::uuid
    `;
    expect(count).toBe("0");
  });

  it("padrão do fornecedor: salvo pela Destinação e pelo cadastro, usado na próxima compra", async () => {
    const result = await setCycleBoxWeight(buyer, { cycleDate, supplierId: vale, productId: maca, weightKg: "12,5", makeSupplierDefault: true });
    expect(result.savedAsDefault).toBe(true);
    const [link] = await db<{ kg: string }[]>`
      SELECT box_weight_kg::float8::text AS kg FROM product_suppliers WHERE product_id = ${maca}::uuid AND supplier_id = ${vale}::uuid
    `;
    expect(link.kg).toBe("12.5");

    const link2 = await setSupplierBoxWeight({ productId: maca, supplierId: bomPreco, weightKg: 20, actorId: buyer.userId });
    expect(link2.boxWeightKg).toBe("20");
    await saveSupplierAllocations(buyer, {
      cycleDate,
      supplierId: bomPreco,
      allocations: [{ productId: maca, stores: [{ storeId: ponta, destinedQuantity: "1.00" }] }],
    });
    expect((await factors(maca, bomPreco)).map((r) => [r.factor, r.origin])).toEqual([["20", "SUPPLIER_BOX_WEIGHT"]]);

  });

  it("recusa produto vendido por unidade, peso inválido e ciclo fechado", async () => {
    await expect(setCycleBoxWeight(buyer, { cycleDate, supplierId: vale, productId: couve, weightKg: "12" })).rejects.toBeInstanceOf(AllocationValidationError);
    await expect(setCycleBoxWeight(buyer, { cycleDate, supplierId: vale, productId: maca, weightKg: "0" })).rejects.toBeInstanceOf(AllocationValidationError);
    await db`
      INSERT INTO purchase_cycle_buyer_closures (purchase_cycle_date, status, closed_at, closed_by)
      VALUES (${cycleDate}::date, 'CLOSED', now(), ${buyer.userId}::uuid)
      ON CONFLICT (purchase_cycle_date) DO UPDATE SET status = 'CLOSED'
    `;
    await expect(setCycleBoxWeight(buyer, { cycleDate, supplierId: vale, productId: maca, weightKg: "11" })).rejects.toBeInstanceOf(CycleClosedError);
  });
});
