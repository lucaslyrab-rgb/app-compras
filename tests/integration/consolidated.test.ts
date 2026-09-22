import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import { type Principal } from "@/modules/identity";
import { loadConsolidated } from "@/modules/purchasing/service";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
integration(
  "Consolidado PostgreSQL: revisões, cancelamento, autorização e itens",
  () => {
    const buyer: Principal = { userId: "", role: "COMPRADOR", storeId: null };
    const cycle = "2098-05-20";
    const stores: string[] = [];
    const products: string[] = [];
    let latestId = "";
    let originalId = "";
    beforeAll(async () => {
      const sql = database().sql;
      for (let i = 0; i < 3; i++) {
        const [store] = await sql<
          { id: string }[]
        >`INSERT INTO stores(slug,name) VALUES (${`consolidated-${Date.now()}-${i}`},${`Loja consolidado ${i}`}) RETURNING id`;
        stores.push(store.id);
      }
      const [user] = await sql<
        { id: string }[]
      >`INSERT INTO users(email,name,password_hash,role) VALUES (${`buyer-${Date.now()}@example.com`},'Comprador teste','test','COMPRADOR') RETURNING id`;
      buyer.userId = user.id;
      for (const [i, format] of ["CX", "SC", "UND", "PCT"].entries()) {
        const [product] = await sql<
          { id: string }[]
        >`INSERT INTO products(erp_code,name,unit,purchase_format,markup) VALUES (${810000 + i},${`Produto teste ${format}`},'KG',${format},0) RETURNING id`;
        products.push(product.id);
      }
    });
    afterAll(async () => {
      await database().sql.end();
    });
    async function order(
      storeIndex: number,
      revision: number,
      quantities: string[],
    ) {
      const sql = database().sql;
      const [created] = await sql<
        { id: string }[]
      >`INSERT INTO orders(store_id,order_date,purchase_cycle_date,cutoff_at,revision,submitted_by,submitted_at)
      VALUES (${stores[storeIndex]},'2098-05-19',${cycle},'2098-05-19T22:00:00Z',${revision},${buyer.userId},${`2098-05-19T${15 + revision}:00:00Z`}) RETURNING id`;
      for (const [i, product] of products.entries())
        await sql`INSERT INTO order_items(order_id,product_id,stock,quantity,snapshot_erp_code,snapshot_name,snapshot_unit)
      VALUES (${created.id},${product},99999,${quantities[i]},${810000 + i},${`Snapshot ${i}`},'KG')`;
      return created.id;
    }
    it("nenhuma loja enviou: catálogo visível, células ausentes e total zero", async () => {
      const data = await loadConsolidated(buyer, cycle);
      expect(data.stores.filter((s) => s.order)).toHaveLength(0);
      expect(data.stores.filter((s) => stores.includes(s.id)).map((s) => s.name)).toEqual([
        "Loja consolidado 0",
        "Loja consolidado 1",
        "Loja consolidado 2",
      ]);
      expect(data.products.length).toBeGreaterThanOrEqual(74);
      expect(
        data.products.every(
          (p) =>
            p.total === "0.00" &&
            Object.values(p.stores).every((v) => v === null),
        ),
      ).toBe(true);
    });
    it("duas lojas: soma apenas revisão vigente, estoques não interferem", async () => {
      originalId = await order(0, 1, ["2", "2", "2", "0"]);
      latestId = await order(0, 2, ["10", "2", "6", "0"]);
      await order(1, 1, ["5", "3", "10", "0"]);
      const data = await loadConsolidated(buyer, cycle);
      expect(data.stores.filter((s) => s.order)).toHaveLength(2);
      expect(data.stores.find((s) => s.id === stores[0])!.order).toMatchObject({
        id: latestId,
        revision: 2,
        submittedAt: "2098-05-19T17:00:00.000Z",
      });
      const row = data.products.find((p) => p.id === products[0])!;
      expect(row.total).toBe("15.00");
      expect(row.purchaseFormat).toBe("CX");
      expect(row.stores[stores[0]]).toEqual({
        stock: "99999.00",
        quantity: "10.00",
      });
      expect(row.stores[stores[2]]).toBeNull();
      expect(
        data.products.find((p) => p.id === products[3])!.stores[stores[0]]!
          .quantity,
      ).toBe("0.00");
    });
    it("três lojas: 23 CX, 6 SC e 20 UND, sem conversão de KG", async () => {
      await order(2, 1, ["8", "1", "4", "0"]);
      const data = await loadConsolidated({ ...buyer, role: "GESTOR" }, cycle);
      expect(data.stores.filter((s) => s.order)).toHaveLength(3);
      expect(
        products.slice(0, 3).map((id) => {
          const p = data.products.find((p) => p.id === id)!;
          return [p.total, p.purchaseFormat];
        }),
      ).toEqual([
        ["23.00", "CX"],
        ["6.00", "SC"],
        ["20.00", "UND"],
      ]);
      const [original] = await database().sql<
        { quantity: string }[]
      >`SELECT quantity::text FROM order_items WHERE order_id=${originalId} AND product_id=${products[0]}`;
      expect(original.quantity).toBe("2.00");
      await expect(
        database()
          .sql`UPDATE order_items SET quantity=1 WHERE order_id=${originalId}`,
      ).rejects.toThrow(/imutáveis/);
    });
    it("cancelar última revisão não reativa a anterior", async () => {
      await database()
        .sql`UPDATE orders SET cancelled_at=now(),cancelled_by=${buyer.userId} WHERE id=${latestId}`;
      const data = await loadConsolidated(buyer, cycle);
      expect(data.stores.find((s) => s.id === stores[0])!.order).toBeNull();
      expect(data.stores.filter((s) => s.order)).toHaveLength(2);
      expect(data.products.find((p) => p.id === products[0])!.total).toBe(
        "13.00",
      );
      expect(
        data.products.find((p) => p.id === products[0])!.stores[stores[0]],
      ).toBeNull();
      const [count] = await database().sql<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM orders WHERE store_id=${stores[0]} AND purchase_cycle_date=${cycle}`;
      expect(count.n).toBe(2);
    });
    it("não perde produto inativado existente no pedido vigente; usa formato cadastrado", async () => {
      await database()
        .sql`UPDATE products SET active=false WHERE id=${products[0]}`;
      const row = (await loadConsolidated(buyer, cycle)).products.find(
        (p) => p.id === products[0],
      );
      expect(row).toMatchObject({
        active: false,
        purchaseFormat: "CX",
        total: "13.00",
      });
    });
    it("rejeita Loja e datas inválidas; aceita ciclo sem pedidos", async () => {
      await expect(
        loadConsolidated({ ...buyer, role: "LOJA", storeId: stores[0] }, cycle),
      ).rejects.toThrow(/restrito/);
      await expect(loadConsolidated(buyer, "2098-02-30")).rejects.toThrow(
        /inválida/,
      );
      const empty = await loadConsolidated(buyer, "2098-05-21");
      expect(empty.stores.every((s) => s.order === null)).toBe(true);
      expect(empty.cycles).toContain(cycle);
      expect(empty.cycleDate).toBe("2098-05-21");
      expect((await loadConsolidated(buyer)).cycles).toContain(cycle);
    });
  },
);
