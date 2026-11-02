import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../../src/db/client";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  readBuyerAllocationWorkspace,
  saveSupplierAllocations,
} from "../../src/modules/purchasing/allocations/repository";
import { CycleClosedError } from "../../src/modules/purchasing/allocations/domain";
import { getStoreConference, listStoreConferenceCycles } from "../../src/modules/purchasing/conferences/repository";
import { archiveCycle, listCyclesPendingClosure } from "../../src/modules/purchasing/cycle-archive/repository";
import { CycleArchiveError } from "../../src/modules/purchasing/cycle-archive/domain";
import type { Principal } from "../../src/modules/identity";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Destinação e ciclos: fornecedores inativos, sem fornecedor por loja e encerrar ciclo", () => {
  const stamp = Date.now();
  const testDbName = `test_db_dest_cycles_${stamp}`;
  const originalUrl = process.env.DATABASE_URL!;
  let adminClient: postgres.Sql;
  let db: postgres.Sql;

  const cycleDate = "2026-10-20";
  const buyer: Principal = {
    userId: "90000000-0000-0000-0000-000000000001",
    role: "COMPRADOR",
    storeId: null,
    permissions: ["compras:destinacao", "compras:custos", "compras:fornecedores"],
  };
  const gestorId = "90000000-0000-0000-0000-000000000002";
  const lojaId = "90000000-0000-0000-0000-000000000003";
  let ponta: string;
  let balneario: string;
  let batata: string;
  let activeSupplier: string;
  let inactiveSupplier: string;

  beforeAll(async () => {
    adminClient = postgres(originalUrl, { max: 1 });
    await adminClient.unsafe(`CREATE DATABASE "${testDbName}"`);
    const url = new URL(originalUrl);
    url.pathname = `/${testDbName}`;
    const testDatabaseUrl = url.toString();
    await runMigrations({ databaseUrl: testDatabaseUrl, migrationsDirectory: path.resolve("migrations") });
    db = postgres(testDatabaseUrl, { max: 5 });
    process.env.DATABASE_URL = testDatabaseUrl;
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

  it("prepara o cenário: 2 lojas pedem Batata, comprador destina só para Ponta da Fruta", async () => {
    const stores = await db<{ id: string; slug: string }[]>`SELECT id, slug FROM stores`;
    ponta = stores.find((s) => s.slug === "ponta-da-fruta")!.id;
    balneario = stores.find((s) => s.slug === "balneario")!.id;

    await db`
      INSERT INTO users (id, name, email, password_hash, role, store_id, permissions, active) VALUES
        (${buyer.userId}, 'Christian', 'christian.dc@multishow.local', '$scrypt$x', 'COMPRADOR', NULL,
          ARRAY['compras:destinacao','compras:custos','compras:fornecedores']::text[], true),
        (${gestorId}, 'Gestor', 'gestor.dc@multishow.local', '$scrypt$x', 'GESTOR', NULL,
          ARRAY['gestor:configuracoes']::text[], true),
        (${lojaId}, 'Loja Ponta', 'loja.dc@multishow.local', '$scrypt$x', 'LOJA', ${ponta},
          ARRAY['pedidos:criar','loja:conferencia']::text[], true)
    `;
    [{ id: batata }] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (9301, 'BATATA DC', 'CX', 'KG', 25, true) RETURNING id
    `;
    [{ id: activeSupplier }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Ademar Kerckhoff Comercio de Hortifruti ME', 'Ademar', '44444444000144', 'CNPJ', 'STANDARD', true) RETURNING id
    `;
    [{ id: inactiveSupplier }] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('Fornecedor Antigo Ltda', 'Antigo', '55555555000155', 'CNPJ', 'STANDARD', false) RETURNING id
    `;

    for (const storeId of [ponta, balneario]) {
      const [order] = await db<{ id: string }[]>`
        INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
        VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storeId}::uuid, 1, now(), ${buyer.userId}::uuid)
        RETURNING id
      `;
      await db`
        INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
        VALUES (${order.id}::uuid, ${batata}::uuid, 0, 3, 9301, 'BATATA DC', 'CX')
      `;
    }
    await db`
      INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
      VALUES (${cycleDate}::date, ${batata}::uuid, 80.00, true, now(), ${buyer.userId}::uuid)
    `;
    await saveSupplierAllocations(buyer, {
      cycleDate,
      supplierId: activeSupplier,
      allocations: [{ productId: batata, stores: [{ storeId: ponta, destinedQuantity: "3.00" }] }],
    });
  });

  it("calcula 'sem fornecedor' por loja: Batata pendente no Balneário mesmo destinada à Ponta da Fruta", async () => {
    const wsPonta = await readBuyerAllocationWorkspace(buyer, cycleDate, null, ponta);
    expect(wsPonta.unassignedPurchasedProducts).toEqual([]);

    const wsBalneario = await readBuyerAllocationWorkspace(buyer, cycleDate, null, balneario);
    expect(wsBalneario.unassignedPurchasedProducts.map((p) => p.id)).toEqual([batata]);
  });

  it("não oferece fornecedor inativo e mostra o nome fantasia", async () => {
    const ws = await readBuyerAllocationWorkspace(buyer, cycleDate, null, ponta);
    const ids = ws.suppliers.map((s) => s.id);
    expect(ids).toContain(activeSupplier);
    expect(ids).not.toContain(inactiveSupplier);
    expect(ws.suppliers.find((s) => s.id === activeSupplier)?.displayName).toBe("Ademar");
  });

  it("lista o ciclo antigo em aberto e o encerra inteiro (Destinação + conferência)", async () => {
    const conference = (await getStoreConference(ponta, cycleDate))!;
    expect(conference.header.status).toBe("IN_PROGRESS");

    const pending = await listCyclesPendingClosure();
    const summary = pending.cycles.find((c) => c.cycleDate === cycleDate)!;
    expect(summary.buyerStatus).toBe("OPEN");
    expect(summary.stores.find((s) => s.storeId === ponta)).toMatchObject({ hasOrder: true, conference: "IN_PROGRESS" });
    expect(summary.stores.find((s) => s.storeId === balneario)).toMatchObject({ hasOrder: true, conference: "NOT_STARTED" });

    await archiveCycle({ cycleDate, reason: "ciclo de teste da implantação", userId: gestorId });

    const [closure] = await db`SELECT status, closed_by FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${cycleDate}::date`;
    expect(closure).toMatchObject({ status: "CLOSED", closed_by: gestorId });
    const [conf] = await db`SELECT status, cancellation_reason FROM store_delivery_conferences WHERE id = ${conference.header.id}`;
    expect(conf.status).toBe("CANCELLED");
    expect(conf.cancellation_reason).toBe("Ciclo encerrado pelo Gestor: ciclo de teste da implantação");
    const [archive] = await db`SELECT reason, archived_by FROM purchase_cycle_archives WHERE purchase_cycle_date = ${cycleDate}::date`;
    expect(archive).toMatchObject({ reason: "ciclo de teste da implantação", archived_by: gestorId });
    expect(await db`SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.purchase_cycle_date = ${cycleDate}::date`).toHaveLength(2);
  });

  it("o ciclo encerrado some da Conferência, da lista de pendentes e do seletor da Destinação", async () => {
    expect((await listStoreConferenceCycles(ponta)).map((c) => c.cycleDate)).not.toContain(cycleDate);
    expect((await listStoreConferenceCycles(balneario)).map((c) => c.cycleDate)).not.toContain(cycleDate);
    expect((await listCyclesPendingClosure()).cycles.map((c) => c.cycleDate)).not.toContain(cycleDate);

    const ws = await readBuyerAllocationWorkspace(buyer, undefined, null, ponta);
    expect(ws.cycles).not.toContain(cycleDate);
    const wsAll = await readBuyerAllocationWorkspace(buyer, undefined, null, ponta, { showClosedCycles: true });
    expect(wsAll.cycles).toContain(cycleDate);
  });

  it("bloqueia alterações na Destinação do ciclo encerrado e não encerra duas vezes nem o ciclo de hoje", async () => {
    await expect(
      saveSupplierAllocations(buyer, {
        cycleDate,
        supplierId: activeSupplier,
        allocations: [{ productId: batata, stores: [{ storeId: balneario, destinedQuantity: "3.00" }] }],
      }),
    ).rejects.toBeInstanceOf(CycleClosedError);

    await expect(archiveCycle({ cycleDate, reason: "de novo", userId: gestorId })).rejects.toBeInstanceOf(CycleArchiveError);
    const [{ today }] = await db<{ today: string }[]>`SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today`;
    await expect(archiveCycle({ cycleDate: today, reason: "ciclo de hoje", userId: gestorId })).rejects.toBeInstanceOf(CycleArchiveError);
  });
});
