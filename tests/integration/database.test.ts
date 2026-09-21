import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import { createSessionToken, hashToken, type Principal } from "@/modules/identity/domain";
import { findPrincipal, revokeSession } from "@/modules/identity/repository";
import { ExistingOrderError, loadDraft, saveDraft, submitDraft } from "@/modules/ordering/repository";
import { persistProducts } from "../../scripts/import-products";
import type { ProductInput } from "@/modules/catalog/domain";
import { bootstrapAdmin } from "../../scripts/bootstrap-admin";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("PostgreSQL 18.6", () => {
  const principal: Principal = { userId: "", role: "LOJA", storeId: "" };
  let productId = "";
  let secondProductId = "";

  beforeAll(async () => {
    const db = database();
    const [store] = await db.sql<{ id: string }[]>`
      INSERT INTO stores(slug, name) VALUES (${`integration-${Date.now()}`}, 'Loja de Integração') RETURNING id
    `;
    const products = await db.sql<{ id: string }[]>`SELECT id FROM products ORDER BY erp_code LIMIT 2`;
    const [product, secondProduct] = products;
    if (!store || !product) throw new Error("Execute migração e importação antes dos testes de integração");
    const [user] = await db.sql<{ id: string }[]>`
      INSERT INTO users(email, name, password_hash, role, store_id)
      VALUES (${`integration-${Date.now()}@example.com`}, 'Integração', 'hash-controlado', 'LOJA', ${store.id})
      RETURNING id
    `;
    if (!user) throw new Error("Usuário de integração não criado");
    principal.userId = user.id;
    principal.storeId = store.id;
    productId = product.id;
    secondProductId = secondProduct?.id ?? product.id;
  });

  afterAll(async () => {
    await database().sql.end();
  });

  it("aplica constraints de papel, loja, produto e quantidade", async () => {
    await expect(database().sql`
      INSERT INTO users(email, name, password_hash, role)
      VALUES (${`invalid-${Date.now()}@example.com`}, 'Inválido', 'x', 'LOJA')
    `).rejects.toMatchObject({ code: "23514" });
    await expect(database().sql`
      INSERT INTO products(erp_code, name, unit, purchase_format, markup)
      VALUES (999999, 'INVÁLIDO', 'UND', 'CX', -1)
    `).rejects.toMatchObject({ code: "23514" });
  });

  it("rejeita importação inteira quando uma linha é inválida", async () => {
    const [before] = await database().sql<{ name: string }[]>`SELECT name FROM products WHERE id = ${productId}`;
    const batch = [
      { erpCode: 900001, name: "PRODUTO TEMPORÁRIO", unit: "UND", purchaseFormat: "CX", markup: 10, exclusiveSupplier: false },
      { erpCode: 900002, name: "PRODUTO INVÁLIDO", unit: "UND", purchaseFormat: "CX", markup: -1, exclusiveSupplier: false }
    ] as ProductInput[];
    await expect(persistProducts(process.env.DATABASE_URL!, batch)).rejects.toMatchObject({ code: "23514" });
    const [{ count }] = await database().sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM products WHERE erp_code IN (900001, 900002)
    `;
    expect(count).toBe(0);
    const [after] = await database().sql<{ name: string }[]>`SELECT name FROM products WHERE id = ${productId}`;
    expect(after?.name).toBe(before?.name);
  });

  it("expira e revoga sessões opacas", async () => {
    const expired = createSessionToken();
    await database().sql`
      INSERT INTO sessions(user_id, token_hash, idle_expires_at, absolute_expires_at)
      VALUES (${principal.userId}, ${expired.tokenHash}, now() - interval '1 minute', now() + interval '1 day')
    `;
    await expect(findPrincipal(expired.token)).resolves.toBeNull();

    const active = createSessionToken();
    await database().sql`
      INSERT INTO sessions(user_id, token_hash, idle_expires_at, absolute_expires_at)
      VALUES (${principal.userId}, ${hashToken(active.token)}, now() + interval '1 hour', now() + interval '1 day')
    `;
    await expect(findPrincipal(active.token)).resolves.toMatchObject({ userId: principal.userId, storeId: principal.storeId });
    await revokeSession(active.token);
    await expect(findPrincipal(active.token)).resolves.toBeNull();
  });

  it("aceita bootstrap de Gestor apenas uma vez", async () => {
    const email = `bootstrap-${Date.now()}@example.com`;
    await bootstrapAdmin(process.env.DATABASE_URL!, email, "senha-de-bootstrap-com-16");
    await expect(bootstrapAdmin(process.env.DATABASE_URL!, `${email}-outro`, "senha-de-bootstrap-com-16")).rejects.toThrow(/Gestor ativo/);
  });

  it("detecta conflito de rascunho e preserva pedido enviado", async () => {
    const orderDate = "2099-01-01";
    const first = await saveDraft(principal, principal.storeId!, orderDate, 0, [
      { productId, stock: 2, quantity: 2 },
      { productId: secondProductId, stock: 2, quantity: 2 }
    ]);
    expect(first.version).toBe(1);
    await expect(saveDraft(principal, principal.storeId!, orderDate, 0, [{ productId, stock: 1, quantity: 3 }])).rejects.toThrow(/outra sessão/);
    await expect(loadDraft({ ...principal, storeId: "00000000-0000-0000-0000-000000000000" }, principal.storeId!, orderDate)).rejects.toThrow(/Acesso negado/);
    const order = await submitDraft(principal, principal.storeId!, orderDate);
    await saveDraft(principal, principal.storeId!, orderDate, 1, [
      { productId, stock: 11, quantity: 13 },
      { productId: secondProductId, stock: 22, quantity: 27 }
    ]);
    await expect(submitDraft(principal, principal.storeId!, orderDate)).rejects.toBeInstanceOf(ExistingOrderError);
    const secondOrder = await submitDraft(principal, principal.storeId!, orderDate, true);
    expect(secondOrder.revision).toBe(2);
    const persisted = await database().sql<{ order_id: string; product_id: string; stock: string; quantity: string }[]>`
      SELECT order_id, product_id, stock, quantity FROM order_items
      WHERE order_id IN (${order.id}, ${secondOrder.id}) ORDER BY order_id, product_id
    `;
    expect(persisted).toHaveLength(4);
    const firstItems = persisted.filter((item) => item.order_id === order.id).map(({ product_id, stock, quantity }) => ({ product_id, stock, quantity }));
    const secondItems = persisted.filter((item) => item.order_id === secondOrder.id).map(({ product_id, stock, quantity }) => ({ product_id, stock, quantity }));
    expect(firstItems).toHaveLength(2);
    expect(firstItems).toEqual(expect.arrayContaining([
      { product_id: productId, stock: "2.00", quantity: "2.00" },
      { product_id: secondProductId, stock: "2.00", quantity: "2.00" }
    ]));
    expect(secondItems).toHaveLength(2);
    expect(secondItems).toEqual(expect.arrayContaining([
      { product_id: productId, stock: "11.00", quantity: "13.00" },
      { product_id: secondProductId, stock: "22.00", quantity: "27.00" }
    ]));
    const [revisionCount] = await database().sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM orders WHERE store_id = ${principal.storeId} AND purchase_cycle_date = (SELECT purchase_cycle_date FROM orders WHERE id = ${secondOrder.id}) AND cancelled_at IS NULL
    `;
    expect(revisionCount?.count).toBe(2);
    await database().sql`UPDATE products SET active = false WHERE id = ${productId}`;
    const [history] = await database().sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM order_items WHERE order_id IN (${order.id}, ${secondOrder.id}) AND product_id = ${productId}
    `;
    expect(history?.count).toBe(2);
    await expect(database().sql`UPDATE orders SET revision = 2 WHERE id = ${order.id}`).rejects.toThrow(/imutáveis/);
  });
});
