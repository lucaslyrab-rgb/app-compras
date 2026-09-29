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

export async function setProductPhoto(
  principal: Principal,
  productId: string,
  newPhotoKey: string,
  expectedVersion: number
) {
  authorizeProductManagement(principal);
  return database().sql.begin(async (tx) => {
    const [current] = await tx<{ id: string; photo_key: string | null; version: number }[]>`
      SELECT id, photo_key, version FROM products WHERE id = ${productId} FOR UPDATE
    `;
    if (!current) throw new Error("Produto não encontrado.");
    if (current.version !== expectedVersion) {
      throw new ProductVersionConflictError();
    }
    const [updated] = await tx<
      { id: string; photoKey: string | null; photoUpdatedAt: Date; version: number }[]
    >`
      UPDATE products
      SET photo_key = ${newPhotoKey}, photo_updated_at = now(), version = version + 1, updated_at = now()
      WHERE id = ${productId} AND version = ${expectedVersion}
      RETURNING id, photo_key AS "photoKey", photo_updated_at AS "photoUpdatedAt", version
    `;
    if (!updated) throw new ProductVersionConflictError();
    return {
      updated,
      oldPhotoKey: current.photo_key,
    };
  });
}

export async function removeProductPhoto(
  principal: Principal,
  productId: string,
  expectedVersion: number
) {
  authorizeProductManagement(principal);
  return database().sql.begin(async (tx) => {
    const [current] = await tx<{ id: string; photo_key: string | null; version: number }[]>`
      SELECT id, photo_key, version FROM products WHERE id = ${productId} FOR UPDATE
    `;
    if (!current) throw new Error("Produto não encontrado.");
    if (current.version !== expectedVersion) {
      throw new ProductVersionConflictError();
    }
    const [updated] = await tx<
      { id: string; photoKey: string | null; photoUpdatedAt: Date | null; version: number }[]
    >`
      UPDATE products
      SET photo_key = NULL, photo_updated_at = now(), version = version + 1, updated_at = now()
      WHERE id = ${productId} AND version = ${expectedVersion}
      RETURNING id, photo_key AS "photoKey", photo_updated_at AS "photoUpdatedAt", version
    `;
    if (!updated) throw new ProductVersionConflictError();
    return {
      updated,
      oldPhotoKey: current.photo_key,
    };
  });
}

