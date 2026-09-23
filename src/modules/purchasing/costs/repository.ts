import { database } from "@/db/client";
import { AuthorizationError, type Principal } from "@/modules/identity";
import {
  canManagePurchaseCosts,
  PurchaseCostConflictError,
  type PurchaseCostState,
  type SavedPurchaseCost,
} from "./domain";

type CostProjectionRow = {
  productId: string;
  exclusiveSupplier: boolean;
  currentCost: string | null;
  purchased: boolean | null;
  version: number | null;
  updatedAt: string | null;
  previousCost: string | null;
  previousCycleDate: string | null;
};

type SavedRow = {
  productId: string;
  cycleDate: string;
  cost: string | null;
  purchased: boolean;
  version: number;
  updatedAt: string;
};

function saved(row: SavedRow): SavedPurchaseCost {
  return {
    ...row,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function readPurchaseCostStates(
  principal: Principal,
  productIds: string[],
  cycleDate: string,
): Promise<PurchaseCostState[]> {
  if (!canManagePurchaseCosts(principal))
    throw new AuthorizationError("Acesso restrito ao Comprador e Gestor");
  if (!productIds.length) return [];
  const sql = database().sql;
  const rows = await sql<CostProjectionRow[]>`
    SELECT p.id AS "productId", p.exclusive_supplier AS "exclusiveSupplier",
           current_cost.cost::text AS "currentCost", current_cost.purchased,
           current_cost.version, current_cost.updated_at AS "updatedAt",
           previous.cost::text AS "previousCost",
           previous.purchase_cycle_date::text AS "previousCycleDate"
    FROM products p
    LEFT JOIN purchase_cycle_product_costs current_cost
      ON current_cost.product_id = p.id
     AND current_cost.purchase_cycle_date = ${cycleDate}::date
    LEFT JOIN LATERAL (
      SELECT cost, purchase_cycle_date
      FROM purchase_cycle_product_costs historical
      WHERE historical.product_id = p.id
        AND historical.purchase_cycle_date < ${cycleDate}::date
        AND historical.purchased = true
        AND historical.cost IS NOT NULL
      ORDER BY historical.purchase_cycle_date DESC,
               historical.purchased_at DESC NULLS LAST,
               historical.updated_at DESC,
               historical.id DESC
      LIMIT 1
    ) previous ON true
    WHERE p.id IN ${sql(productIds)}
  `;
  return rows.map((row) => ({
    productId: row.productId,
    exclusiveSupplier: row.exclusiveSupplier,
    currentCost: row.currentCost,
    purchased: row.purchased ?? false,
    version: row.version ?? 0,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    previousCost: row.previousCost,
    previousCycleDate: row.previousCycleDate,
  }));
}

export async function persistPurchaseCost(
  principal: Principal,
  input: {
    productId: string;
    cycleDate: string;
    cost: string | null;
    purchased: boolean;
    expectedVersion: number;
  },
): Promise<SavedPurchaseCost> {
  if (!canManagePurchaseCosts(principal))
    throw new AuthorizationError("Acesso restrito ao Comprador e Gestor");
  const sql = database().sql;
  return sql.begin(async (transaction) => {
    const rows = await transaction<SavedRow[]>`
      INSERT INTO purchase_cycle_product_costs(
        product_id, purchase_cycle_date, cost, purchased, purchased_at,
        updated_by, version, created_at, updated_at
      )
      VALUES (
        ${input.productId}, ${input.cycleDate}::date, ${input.cost},
        ${input.purchased},
        CASE WHEN ${input.purchased} THEN now() ELSE NULL END,
        ${principal.userId}, 1, now(), now()
      )
      ON CONFLICT (product_id, purchase_cycle_date) DO UPDATE
      SET cost = EXCLUDED.cost,
          purchased = EXCLUDED.purchased,
          purchased_at = CASE
            WHEN EXCLUDED.purchased AND NOT purchase_cycle_product_costs.purchased THEN now()
            WHEN EXCLUDED.purchased THEN purchase_cycle_product_costs.purchased_at
            ELSE NULL
          END,
          updated_by = EXCLUDED.updated_by,
          version = purchase_cycle_product_costs.version + 1,
          updated_at = now()
      WHERE purchase_cycle_product_costs.version = ${input.expectedVersion}
      RETURNING product_id AS "productId",
                purchase_cycle_date::text AS "cycleDate", cost::text,
                purchased, version, updated_at AS "updatedAt"
    `;
    if (rows[0]) return saved(rows[0]);
    const [current] = await transaction<SavedRow[]>`
      SELECT product_id AS "productId",
             purchase_cycle_date::text AS "cycleDate", cost::text,
             purchased, version, updated_at AS "updatedAt"
      FROM purchase_cycle_product_costs
      WHERE product_id = ${input.productId}
        AND purchase_cycle_date = ${input.cycleDate}::date
    `;
    if (!current) throw new Error("Não foi possível salvar o custo.");
    throw new PurchaseCostConflictError(saved(current));
  });
}
