/**
 * Cria pedidos de teste no ambiente LOCAL (docs/desenvolvimento-local.md):
 * um pedido por loja ativa no ciclo de compra atual, como se cada loja tivesse
 * enviado pela tela de Pedido, e alguns fornecedores fictícios para a Destinação.
 *
 *   npm run dev:pedidos
 *
 * Só roda com DATABASE_URL apontando para localhost. Loja que já tem pedido no
 * ciclo é pulada. Custos e Destinação ficam para o teste do comprador.
 */
import "dotenv/config";
import postgres from "postgres";
import { assertLocalDatabaseUrl } from "../src/lib/dev-safety";
import { database } from "../src/db/client";
import { ROLE_DEFAULT_PERMISSIONS, type Principal } from "../src/modules/identity/domain";
import { currentPurchaseCycle } from "../src/modules/ordering/calendar/service";
import { ExistingOrderError, loadDraft, saveDraft, submitDraft } from "../src/modules/ordering/repository";
import { isMainModule } from "./is-main";

/** Nomes inventados, só para teste. */
export const TEST_SUPPLIERS = [
  "Hortifruti Serra Verde (teste)",
  "Frutas do Vale (teste)",
  "Comercial Bom Preço (teste)",
  "Sítio Boa Esperança (teste)",
  "Distribuidora Mar Azul (teste)",
];

function pick<T>(list: T[], count: number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

export type TestOrdersResult = {
  cycleDate: string;
  stores: { storeId: string; name: string; status: "created" | "skipped-existing" | "skipped-no-user"; items: number }[];
};

export async function createTestOrders(databaseUrl: string, now = new Date(), log: (line: string) => void = console.log): Promise<TestOrdersResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  const result: TestOrdersResult = { cycleDate: "", stores: [] };
  try {
    for (const name of TEST_SUPPLIERS) {
      await sql`
        INSERT INTO suppliers (corporate_name, trade_name, active)
        SELECT ${name}, ${name.replace(" (teste)", "")}, true
        WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE corporate_name = ${name})
      `;
    }

    const products = await sql<{ id: string }[]>`SELECT id FROM products WHERE active ORDER BY erp_code`;
    if (products.length === 0) throw new Error("Sem produtos. Rode antes: npm run dev:setup");
    // Um grupo comum para as lojas pedirem produtos em comum, como no dia a dia.
    const pool = pick(products, Math.min(35, products.length));

    const stores = await sql<{ id: string; name: string; user_id: string | null }[]>`
      SELECT s.id, s.name,
        (SELECT u.id FROM users u WHERE u.store_id = s.id AND u.role = 'LOJA' AND u.active
          ORDER BY (u.email LIKE '%@local.test') DESC, u.created_at LIMIT 1) AS user_id
      FROM stores s WHERE s.active ORDER BY s.name
    `;

    const cycle = await currentPurchaseCycle(now);
    result.cycleDate = cycle.cycleDate;
    log(`Ciclo de compra: ${cycle.cycleDate} (pedido do dia ${cycle.localDate})\n`);

    for (const store of stores) {
      if (!store.user_id) {
        log(`  ${store.name}: sem usuário de loja, pulada (rode npm run dev:setup).`);
        result.stores.push({ storeId: store.id, name: store.name, status: "skipped-no-user", items: 0 });
        continue;
      }
      const principal: Principal = {
        userId: store.user_id,
        role: "LOJA",
        storeId: store.id,
        permissions: [...ROLE_DEFAULT_PERMISSIONS.LOJA],
      };
      const items = pick(pool, between(15, 25)).map((product) => ({
        productId: product.id,
        stock: between(0, 4),
        quantity: between(1, 8),
      }));
      try {
        const draft = await loadDraft(principal, store.id, cycle.localDate);
        await saveDraft(principal, store.id, cycle.localDate, draft.version, items);
        await submitDraft(principal, store.id, cycle.localDate, false, now);
        log(`  ${store.name}: pedido enviado com ${items.length} produtos.`);
        result.stores.push({ storeId: store.id, name: store.name, status: "created", items: items.length });
      } catch (error) {
        if (error instanceof ExistingOrderError) {
          log(`  ${store.name}: já tem pedido neste ciclo, pulada.`);
          result.stores.push({ storeId: store.id, name: store.name, status: "skipped-existing", items: 0 });
        } else {
          throw error;
        }
      }
    }
    log(`\nFornecedores de teste: ${TEST_SUPPLIERS.length}. Entre como comprador@local.test para lançar custos e destinar.`);
    return result;
  } finally {
    await sql.end();
  }
}

if (isMainModule(import.meta.url)) {
  const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL).toString();
  try {
    await createTestOrders(databaseUrl);
  } finally {
    await database().sql.end({ timeout: 5 });
  }
}
