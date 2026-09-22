import { database } from "@/db/client";
import { AuthorizationError, type Principal } from "@/modules/identity";
import {
  buildConsolidatedProducts,
  canViewConsolidated,
  isCycleDate,
  type CatalogProduct,
  type ConsolidatedData,
  type ConsolidatedItem,
  type ConsolidatedStore,
} from "./domain";

export async function readConsolidated(
  principal: Principal,
  requestedCycle: string | undefined,
  emptyCycleDate: string,
): Promise<ConsolidatedData> {
  if (!canViewConsolidated(principal))
    throw new AuthorizationError("Acesso restrito ao Comprador e Gestor");
  if (requestedCycle && !isCycleDate(requestedCycle))
    throw new Error("Data de compra inválida");
  // All queries see the same snapshot, even if a store submits/cancels while this page is loading.
  return database().sql.begin(
    "isolation level repeatable read read only",
    async (sql) => {
      const available = await sql<
        { date: string }[]
      >`SELECT DISTINCT purchase_cycle_date::text AS date FROM orders ORDER BY date`;
      const cycleDate =
        requestedCycle ?? available.at(-1)?.date ?? emptyCycleDate;
      const cycles = [
        ...new Set([...available.map((row) => row.date), cycleDate]),
      ].sort();
      // Same latest-submission criterion as Loja History. Rank BEFORE checking cancellation:
      // cancelling the latest submission never reactivates a historical revision.
      const storeRows = await sql<
        {
          id: string;
          slug: string;
          name: string;
          orderId: string | null;
          revision: number | null;
          submittedAt: string | null;
          cutoffAt: string | null;
        }[]
      >`
      WITH latest AS (
        SELECT DISTINCT ON (store_id) * FROM orders WHERE purchase_cycle_date = ${cycleDate}::date
        ORDER BY store_id, submitted_at DESC, revision DESC, id DESC
      )
      SELECT s.id, s.slug, s.name, o.id AS "orderId", o.revision,
             o.submitted_at AS "submittedAt", o.cutoff_at AS "cutoffAt"
      FROM stores s LEFT JOIN latest o ON o.store_id = s.id AND o.cancelled_at IS NULL
      WHERE s.active OR EXISTS (SELECT 1 FROM latest l WHERE l.store_id = s.id)
      ORDER BY CASE s.slug
        WHEN 'ponta-da-fruta' THEN 0
        WHEN 'balneario' THEN 1
        WHEN 'santa-monica' THEN 2
        ELSE 3
      END, s.name
    `;
      const stores: ConsolidatedStore[] = storeRows.map((store) => ({
        id: store.id,
        slug: store.slug,
        name: store.name,
        order: store.orderId
          ? {
              id: store.orderId,
              revision: store.revision!,
              submittedAt: new Date(store.submittedAt!).toISOString(),
              cutoffAt: new Date(store.cutoffAt!).toISOString(),
            }
          : null,
      }));
      const ids = stores.flatMap((store) =>
        store.order ? [store.order.id] : [],
      );
      const items = ids.length
        ? await sql<ConsolidatedItem[]>`
      SELECT o.store_id AS "storeId", oi.product_id AS "productId", oi.stock::text, oi.quantity::text
      FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.order_id IN ${sql(ids)}
    `
        : [];
      const productIds = [...new Set(items.map((item) => item.productId))];
      const catalog = await sql<CatalogProduct[]>`
      SELECT id, erp_code AS "erpCode", name, purchase_format AS "purchaseFormat", active
      FROM products WHERE active ${productIds.length ? sql`OR id IN ${sql(productIds)}` : sql``}
    `;
      return {
        cycleDate,
        cycles,
        stores,
        products: buildConsolidatedProducts(catalog, stores, items),
        loadedAt: new Date().toISOString(),
      };
    },
  );
}
