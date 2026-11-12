/**
 * Monta um ciclo COMPLETO de teste no ambiente LOCAL (docs/desenvolvimento-local.md),
 * pelos mesmos caminhos das telas, para testar o Fechamento integrado:
 *
 *   1. pedidos das lojas (npm run dev:pedidos);
 *   2. custos: quase tudo comprado, 2 produtos não comprados e 1 comprado sem destinação;
 *   3. destinação por fornecedor, com um corte parcial, um corte total e um adicional;
 *   4. nota fiscal de cada loja × fornecedor (imagem de teste na pasta local);
 *   5. conferência: duas lojas finalizadas (uma pesagem 12% abaixo e um item não
 *      recebido) e a terceira em andamento.
 *
 *   npm run dev:ciclo
 *
 * Só roda com DATABASE_URL apontando para localhost. Se o ciclo atual já tiver
 * destinação, não mexe em nada.
 */
import "dotenv/config";
import postgres from "postgres";
import sharp from "sharp";
import { assertLocalDatabaseUrl } from "../src/lib/dev-safety";
import { localStorageRoot } from "../src/lib/local-object-storage";
import { database } from "../src/db/client";
import { ROLE_DEFAULT_PERMISSIONS, type Principal } from "../src/modules/identity/domain";
import { saveSupplierAllocations } from "../src/modules/purchasing/allocations/repository";
import { finalizeConference, getStoreConference, saveConferenceDraft } from "../src/modules/purchasing/conferences/repository";
import { registerInvoiceService } from "../src/modules/purchasing/invoices/service";
import { createTestOrders, TEST_SUPPLIERS } from "./dev-orders";
import { isMainModule } from "./is-main";

const JEB_TEST_SUPPLIER = "JEB DISTRIBUIDORA (teste)";

type OrderedRow = {
  store_id: string;
  product_id: string;
  quantity: string;
  name: string;
  purchase_format: string;
  exclusive_supplier: boolean;
  sale_unit: string | null;
  conversion_quantity: string | null;
};

/** Custo plausível por formato de compra, variando pelo índice do produto. */
function testCost(format: string, index: number): string {
  const f = format.toUpperCase();
  if (f === "KG") return (2.5 + (index % 7) * 0.9).toFixed(2);
  if (f === "CX" || f === "SC") return (38 + (index % 9) * 9.5).toFixed(2);
  return (2 + (index % 6) * 1.75).toFixed(2);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export type TestCycleResult = {
  cycleDate: string;
  skipped: boolean;
  notPurchased: number;
  purchasedNotDestined: number;
  destinedProducts: number;
  invoices: number;
  finalizedStores: number;
  inProgressStores: number;
};

export async function createTestCycle(
  databaseUrl: string,
  now = new Date(),
  log: (line: string) => void = console.log,
): Promise<TestCycleResult> {
  const orders = await createTestOrders(databaseUrl, now, log);
  const cycleDate = orders.cycleDate;
  const sql = postgres(databaseUrl, { max: 1 });
  const result: TestCycleResult = {
    cycleDate, skipped: false, notPurchased: 0, purchasedNotDestined: 0, destinedProducts: 0, invoices: 0, finalizedStores: 0, inProgressStores: 0,
  };
  try {
    const [{ existing }] = await sql<{ existing: number }[]>`
      SELECT count(*)::int AS existing FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${cycleDate}::date AND destined_quantity > 0
    `;
    if (existing > 0) {
      log(`\nO ciclo ${cycleDate} já tem destinação; nada foi alterado. Para um ciclo novo, recomece o banco (ver guia).`);
      return { ...result, skipped: true };
    }

    await sql`
      INSERT INTO suppliers (corporate_name, trade_name, active)
      SELECT ${JEB_TEST_SUPPLIER}, 'JEB (teste)', true
      WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE corporate_name = ${JEB_TEST_SUPPLIER})
    `;
    const suppliers = await sql<{ id: string; corporate_name: string }[]>`
      SELECT id, corporate_name FROM suppliers WHERE corporate_name = ANY(${[...TEST_SUPPLIERS, JEB_TEST_SUPPLIER]})
    `;
    const supplierId = new Map(suppliers.map((s) => [s.corporate_name, s.id]));
    const regular = TEST_SUPPLIERS.map((name) => supplierId.get(name)!);
    const jeb = supplierId.get(JEB_TEST_SUPPLIER)!;

    const [buyerRow] = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE role = 'COMPRADOR' AND active
      ORDER BY (email LIKE '%@local.test') DESC, created_at LIMIT 1
    `;
    if (!buyerRow) throw new Error("Sem usuário comprador. Rode antes: npm run dev:setup");
    const buyer: Principal = { userId: buyerRow.id, role: "COMPRADOR", storeId: null, permissions: [...ROLE_DEFAULT_PERMISSIONS.COMPRADOR] };

    const ordered = await sql<OrderedRow[]>`
      WITH current_orders AS (
        SELECT DISTINCT ON (o.store_id) o.id, o.store_id
        FROM orders o
        WHERE o.purchase_cycle_date = ${cycleDate}::date AND o.cancelled_at IS NULL
        ORDER BY o.store_id, o.revision DESC
      )
      SELECT co.store_id, oi.product_id, oi.quantity::text AS quantity, p.name, p.purchase_format,
             COALESCE(p.exclusive_supplier, false) AS exclusive_supplier,
             pp.sale_unit, pp.conversion_quantity::text AS conversion_quantity
      FROM current_orders co
      JOIN order_items oi ON oi.order_id = co.id AND oi.quantity > 0
      JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_pricing_parameters pp ON pp.product_id = p.id
      ORDER BY p.name
    `;
    const productIds = [...new Set(ordered.map((r) => r.product_id))];
    const info = new Map(ordered.map((r) => [r.product_id, r]));
    const storeIds = [...new Set(ordered.map((r) => r.store_id))].sort();

    // 2. Custos
    const notPurchased = new Set(productIds.slice(0, 2));
    const purchasedNotDestined = productIds[2];
    for (const [index, productId] of productIds.entries()) {
      if (notPurchased.has(productId)) continue;
      await sql`
        INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
        VALUES (${cycleDate}::date, ${productId}, ${testCost(info.get(productId)!.purchase_format, index)}, true, now(), ${buyer.userId})
        ON CONFLICT (product_id, purchase_cycle_date) DO UPDATE
          SET cost = EXCLUDED.cost, purchased = true, purchased_at = now(), updated_by = EXCLUDED.updated_by
      `;
    }
    result.notPurchased = notPurchased.size;
    result.purchasedNotDestined = purchasedNotDestined ? 1 : 0;
    log(`\nCustos: ${productIds.length - notPurchased.size} comprados, ${notPurchased.size} não comprados.`);

    // 3. Destinação (plano por loja × produto)
    const plan = new Map<string, number>(); // `${store}|${product}` → quantidade destinada
    const destinedIds = productIds.slice(3);
    for (const [index, productId] of destinedIds.entries()) {
      const rows = ordered.filter((r) => r.product_id === productId);
      for (const [storeIndex, row] of rows.entries()) {
        let qty = Math.round(Number(row.quantity));
        if (index === 0 && storeIndex === 0 && qty > 1) qty -= 1; // corte parcial
        if (index === 1 && storeIndex === 0 && rows.length > 1) qty = 0; // corte total em uma loja
        if (index === 2 && storeIndex === 0) qty += 1; // adicional sobre o pedido
        if (qty > 0) plan.set(`${row.store_id}|${productId}`, qty);
      }
      if (index === 3) {
        const extra = storeIds.find((s) => !rows.some((r) => r.store_id === s));
        if (extra) plan.set(`${extra}|${productId}`, 1); // adicional sem pedido da loja
      }
    }
    const bySupplier = new Map<string, Map<string, { storeId: string; destinedQuantity: string }[]>>();
    for (const [key, qty] of plan) {
      const [storeId, productId] = key.split("|");
      const index = destinedIds.indexOf(productId);
      const supplier = info.get(productId)!.exclusive_supplier ? jeb : regular[index % regular.length];
      const products = bySupplier.get(supplier) ?? new Map();
      const list = products.get(productId) ?? [];
      list.push({ storeId, destinedQuantity: qty.toFixed(2) });
      products.set(productId, list);
      bySupplier.set(supplier, products);
    }
    for (const [supplier, products] of bySupplier) {
      await saveSupplierAllocations(buyer, {
        cycleDate,
        supplierId: supplier,
        allocations: [...products.entries()].map(([productId, stores]) => ({ productId, stores, isOpportunityConfirmed: true })),
      });
    }
    result.destinedProducts = new Set([...plan.keys()].map((k) => k.split("|")[1])).size;
    log(`Destinação: ${result.destinedProducts} produtos em ${bySupplier.size} fornecedores (com corte parcial, corte total e adicionais).`);

    // 4. Notas fiscais (só com armazenamento local, para não enviar nada ao S3)
    if (localStorageRoot()) {
      const image = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#F4F6F8" } }).jpeg().toBuffer();
      let number = 4500;
      for (const [supplier, products] of bySupplier) {
        const stores = new Map<string, string[]>();
        for (const [productId, list] of products) {
          for (const entry of list) stores.set(entry.storeId, [...(stores.get(entry.storeId) ?? []), productId]);
        }
        for (const [storeId, ids] of stores) {
          number += 17;
          await registerInvoiceService({
            cycleDate, storeId, supplierId: supplier, invoiceNumber: String(number), imageBuffer: image, createdBy: buyer.userId, productIds: ids,
          });
          result.invoices += 1;
        }
      }
      log(`Notas fiscais: ${result.invoices} (imagem de teste em branco).`);
    } else {
      log("Notas fiscais: puladas (defina LOCAL_STORAGE_DIR no .env para criá-las).");
    }

    // 5. Conferência: duas lojas finalizadas, a última em andamento
    const storeUsers = await sql<{ store_id: string; id: string }[]>`
      SELECT DISTINCT ON (store_id) store_id, id FROM users
      WHERE role = 'LOJA' AND active AND store_id = ANY(${storeIds}::uuid[])
      ORDER BY store_id, (email LIKE '%@local.test') DESC, created_at
    `;
    const userByStore = new Map(storeUsers.map((u) => [u.store_id, u.id]));
    for (const [storeIndex, storeId] of storeIds.entries()) {
      const userId = userByStore.get(storeId);
      const conf = userId ? await getStoreConference(storeId, cycleDate) : null;
      if (!userId || !conf) continue;
      let destinedSeen = 0;
      const items = conf.items.map((item) => {
        const destined = plan.get(`${storeId}|${item.productId}`) ?? 0;
        if (destined <= 0) return { productId: item.productId, receivedWeightKg: null, isUnreceived: true };
        destinedSeen += 1;
        const p = info.get(item.productId);
        const perUnit = p?.sale_unit === "KG" && Number(p.conversion_quantity) > 0 ? Number(p.conversion_quantity) : 1;
        const expected = p?.purchase_format.toUpperCase() === "KG" ? destined : destined * perUnit;
        if (storeIndex === 1 && destinedSeen === 2) return { productId: item.productId, receivedWeightKg: null, isUnreceived: true };
        const factor = storeIndex === 0 && destinedSeen === 1 ? 0.88 : [1, 0.98, 1.02, 0.97, 1.01][destinedSeen % 5];
        return { productId: item.productId, receivedWeightKg: round2(expected * factor), isUnreceived: false };
      });
      if (storeIndex < storeIds.length - 1 || storeIds.length === 1) {
        await finalizeConference({ conferenceId: conf.header.id, storeId, userId, expectedVersion: conf.header.version, items });
        result.finalizedStores += 1;
      } else {
        await saveConferenceDraft({
          conferenceId: conf.header.id, storeId, userId, expectedVersion: conf.header.version, items: items.slice(0, Math.ceil(items.length / 2)),
        });
        result.inProgressStores += 1;
      }
    }
    log(`Conferência: ${result.finalizedStores} loja(s) finalizada(s) e ${result.inProgressStores} em andamento.`);
    log(`\nPronto. Entre como gestor@local.test → Fechamento integrado → Compra ${cycleDate.split("-").reverse().join("/")}.`);
    return result;
  } finally {
    await sql.end();
  }
}

if (isMainModule(import.meta.url)) {
  const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL).toString();
  try {
    await createTestCycle(databaseUrl);
  } finally {
    await database().sql.end({ timeout: 5 });
  }
}
