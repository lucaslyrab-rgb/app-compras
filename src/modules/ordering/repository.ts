import { and, desc, eq, sql } from "drizzle-orm";
import { database } from "@/db/client";
import { orderDraftItems, orderDrafts, orderItems, orders, products } from "@/db/schema";
import type { Principal } from "@/modules/identity";
import { assertStoreAccess } from "@/modules/identity";
import { DraftConflictError, validateDraft, type DraftItem } from "./domain";

export async function saveDraft(principal: Principal, storeId: string, date: string, expectedVersion: number, items: DraftItem[]) {
  assertStoreAccess(principal, storeId);
  const parsed = validateDraft(items);
  return database().db.transaction(async (tx) => {
    const existing = await tx.query.orderDrafts.findFirst({ where: and(eq(orderDrafts.storeId, storeId), eq(orderDrafts.orderDate, date)) });
    if (existing && existing.version !== expectedVersion) throw new DraftConflictError("O rascunho foi atualizado em outra sessão");
    let draftId: string;
    let version: number;
    if (existing) {
      version = existing.version + 1;
      await tx.update(orderDrafts).set({ version, updatedBy: principal.userId, updatedAt: new Date() }).where(eq(orderDrafts.id, existing.id));
      draftId = existing.id;
      await tx.delete(orderDraftItems).where(eq(orderDraftItems.draftId, draftId));
    } else {
      version = 1;
      const [created] = await tx.insert(orderDrafts).values({ storeId, orderDate: date, updatedBy: principal.userId }).returning();
      if (!created) throw new Error("Falha ao criar rascunho");
      draftId = created.id;
    }
    if (parsed.length) await tx.insert(orderDraftItems).values(parsed.map((item) => ({ draftId, productId: item.productId, stock: String(item.stock), quantity: String(item.quantity) })));
    return { id: draftId, version };
  });
}

export async function loadDraft(principal: Principal, storeId: string, date: string) {
  assertStoreAccess(principal, storeId);
  const draft = await database().db.query.orderDrafts.findFirst({ where: and(eq(orderDrafts.storeId, storeId), eq(orderDrafts.orderDate, date)) });
  if (!draft) return { version: 0, items: [] };
  const items = await database().db.select().from(orderDraftItems).where(eq(orderDraftItems.draftId, draft.id));
  return { version: draft.version, items: items.map((item) => ({ productId: item.productId, stock: Number(item.stock), quantity: Number(item.quantity) })) };
}

export async function submitDraft(principal: Principal, storeId: string, date: string) {
  assertStoreAccess(principal, storeId);
  return database().db.transaction(async (tx) => {
    const draft = await tx.query.orderDrafts.findFirst({ where: and(eq(orderDrafts.storeId, storeId), eq(orderDrafts.orderDate, date)) });
    if (!draft) throw new Error("Rascunho não encontrado");
    const items = await tx.select().from(orderDraftItems).where(eq(orderDraftItems.draftId, draft.id));
    const [{ maxRevision }] = await tx.select({ maxRevision: sql<number>`coalesce(max(${orders.revision}), 0)::int` }).from(orders).where(and(eq(orders.storeId, storeId), eq(orders.orderDate, date)));
    const [order] = await tx.insert(orders).values({ storeId, orderDate: date, revision: (maxRevision ?? 0) + 1, submittedBy: principal.userId }).returning();
    if (!order) throw new Error("Falha ao enviar pedido");
    if (items.length) await tx.insert(orderItems).values(items.map((item) => ({ orderId: order.id, productId: item.productId, stock: item.stock, quantity: item.quantity })));
    return order;
  });
}

export async function listStoreHistory(principal: Principal, storeId: string) {
  assertStoreAccess(principal, storeId);
  return database().db.select().from(orders).where(eq(orders.storeId, storeId)).orderBy(desc(orders.submittedAt));
}

export async function getConferenceOrder(principal: Principal, storeId: string, orderId: string) {
  assertStoreAccess(principal, storeId);
  const [order] = await database().db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)));
  if (!order) throw new Error("Pedido não encontrado");
  const items = await database().db.select({ erpCode: products.erpCode, name: products.name, unit: products.unit, quantity: orderItems.quantity })
    .from(orderItems).innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(eq(orderItems.orderId, orderId), sql`${orderItems.quantity} > 0`));
  return { order, items };
}
