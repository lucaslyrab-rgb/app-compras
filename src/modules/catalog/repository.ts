import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { products } from "@/db/schema";
import type { Principal } from "@/modules/identity";
import { authorizeProductManagement, ProductDraftConflictError, ProductVersionConflictError } from "./domain";

export async function listActiveProducts() {
  return database().db.select().from(products).where(eq(products.active, true)).orderBy(products.name);
}

export async function setProductActive(principal: Principal, productId: string, active: boolean, expectedVersion: number) {
  authorizeProductManagement(principal);
  return database().sql.begin(async (tx) => {
    if (!active) {
      const [{ count }] = await tx<[{ count: number }]>`
        SELECT count(DISTINCT draft_id)::int AS count FROM order_draft_items
        WHERE product_id = ${productId} AND (stock > 0 OR quantity > 0)
      `;
      if (count > 0) throw new ProductDraftConflictError(count);
    }
    const [updated] = await tx<{ id: string; active: boolean; version: number }[]>`
      UPDATE products SET active = ${active}, version = version + 1, updated_at = now()
      WHERE id = ${productId} AND version = ${expectedVersion}
      RETURNING id, active, version
    `;
    if (!updated) throw new ProductVersionConflictError();
    return updated;
  });
}
