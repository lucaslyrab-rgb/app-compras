import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { products } from "@/db/schema";
import type { Principal } from "@/modules/identity";
import { authorizeProductManagement } from "./domain";

export async function listActiveProducts() {
  return database().db.select().from(products).where(eq(products.active, true)).orderBy(products.name);
}

export async function setProductActive(principal: Principal, productId: string, active: boolean) {
  authorizeProductManagement(principal);
  const [updated] = await database().db.update(products).set({ active, updatedAt: new Date() }).where(eq(products.id, productId)).returning();
  if (!updated) throw new Error("Produto não encontrado");
  return updated;
}
