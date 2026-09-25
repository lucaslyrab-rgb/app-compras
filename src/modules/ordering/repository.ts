import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { database } from "@/db/client";
import { orderDraftItems, orderDrafts, orderItems, orders, products, stores } from "@/db/schema";
import type { Principal } from "@/modules/identity";
import { assertStoreAccess } from "@/modules/identity";
import { currentPurchaseCycle } from "./calendar/service";
import { DraftConflictError, validateDraft, type DraftItem } from "./domain";

export class ExistingOrderError extends Error {
  constructor(public readonly submittedAt: Date, public readonly purchaseCycleDate: string) {
    super("Já existe um pedido válido neste ciclo de compra.");
  }
}

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

export async function submitDraft(principal: Principal, storeId: string, date: string, allowRevision = false, now = new Date()) {
  assertStoreAccess(principal, storeId);
  const cycle = await currentPurchaseCycle(now);
  return database().db.transaction(async (tx) => {
    const draft = await tx.query.orderDrafts.findFirst({ where: and(eq(orderDrafts.storeId, storeId), eq(orderDrafts.orderDate, date)) });
    if (!draft) throw new Error("Rascunho não encontrado");
    const items = await tx.select().from(orderDraftItems).where(eq(orderDraftItems.draftId, draft.id));
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${storeId}:${cycle.cycleDate}`}, 0))`);
    const [existing] = await tx.select({ submittedAt: orders.submittedAt }).from(orders).where(and(eq(orders.storeId, storeId), eq(orders.purchaseCycleDate, cycle.cycleDate), sql`${orders.cancelledAt} is null`)).orderBy(desc(orders.revision)).limit(1);
    if (existing && !allowRevision) throw new ExistingOrderError(existing.submittedAt, cycle.cycleDate);
    const [{ maxRevision }] = await tx.select({ maxRevision: sql<number>`coalesce(max(${orders.revision}), 0)::int` }).from(orders).where(and(eq(orders.storeId, storeId), eq(orders.purchaseCycleDate, cycle.cycleDate)));
    const [order] = await tx.insert(orders).values({ storeId, orderDate: date, purchaseCycleDate: cycle.cycleDate, cutoffAt: cycle.cutoffAt, revision: (maxRevision ?? 0) + 1, submittedBy: principal.userId }).returning();
    if (!order) throw new Error("Falha ao enviar pedido");
    if (items.length) {
      const productRows = await tx.select({ id: products.id, erpCode: products.erpCode, name: products.name, unit: products.unit }).from(products).where(inArray(products.id, items.map((item) => item.productId)));
      const byId = new Map(productRows.map((product) => [product.id, product]));
      await tx.insert(orderItems).values(items.map((item) => {
        const product = byId.get(item.productId);
        if (!product) throw new Error("Produto não encontrado");
        return { orderId: order.id, productId: item.productId, stock: item.stock, quantity: item.quantity, snapshotErpCode: product.erpCode, snapshotName: product.name, snapshotUnit: product.unit };
      }));
    }
    return order;
  });
}

export async function listStoreHistory(principal: Principal, storeId: string) {
  assertStoreAccess(principal, storeId);
  return database().db.select({
    id: orders.id, storeId: orders.storeId, orderDate: orders.orderDate, purchaseCycleDate: orders.purchaseCycleDate, cutoffAt: orders.cutoffAt, revision: orders.revision,
    submittedAt: orders.submittedAt, cancelledAt: orders.cancelledAt, cancelledBy: orders.cancelledBy,
    cancellationReason: orders.cancellationReason,
    itemCount: sql<number>`coalesce((select count(*) from order_items oi where oi.order_id = ${orders.id} and oi.quantity > 0), 0)::int`
  }).from(orders).where(eq(orders.storeId, storeId)).orderBy(desc(orders.submittedAt));
}

export async function getHistoricalOrder(principal: Principal, storeId: string, orderId: string, showAll = false) {
  assertStoreAccess(principal, storeId);
  const [order] = await database().db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)));
  if (!order) throw new Error("Pedido não encontrado");
  const items = await database().db.select({ erpCode: orderItems.snapshotErpCode, name: orderItems.snapshotName, unit: orderItems.snapshotUnit, stock: orderItems.stock, quantity: orderItems.quantity })
    .from(orderItems).where(and(eq(orderItems.orderId, orderId), showAll ? sql`true` : sql`${orderItems.quantity} > 0`)).orderBy(asc(orderItems.snapshotName));
  return { order, items };
}

export async function getConferenceOrder(principal: Principal, storeId: string, orderId: string) {
  const result = await getHistoricalOrder(principal, storeId, orderId, false);
  if (result.order.cancelledAt) throw new Error("Pedido cancelado");
  return result;
}

export async function getStoreName(storeId: string) {
  const [store] = await database().db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId));
  return store?.name ?? "Loja";
}

export async function cancelOrder(principal: Principal, orderId: string, reason?: string) {
  if (principal.role !== "LOJA" || !principal.storeId) throw new Error("Acesso negado");
  const [order] = await database().db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, principal.storeId)));
  if (!order) throw new Error("Pedido não encontrado");
  if (order.cancelledAt) throw new Error("Pedido já cancelado");
  const [updated] = await database().db.update(orders).set({ cancelledAt: new Date(), cancelledBy: principal.userId, cancellationReason: reason?.trim() || null }).where(and(eq(orders.id, orderId), eq(orders.storeId, principal.storeId))).returning();
  if (!updated) throw new Error("Não foi possível cancelar o pedido");
  return updated;
}
