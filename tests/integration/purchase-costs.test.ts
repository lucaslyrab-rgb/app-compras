import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "@/db/client";
import type { Principal } from "@/modules/identity";
import { PurchaseCostConflictError } from "@/modules/purchasing/costs/domain";
import { persistPurchaseCost } from "@/modules/purchasing/costs/repository";
import {
  loadPurchaseCosts,
  savePurchaseCost,
} from "@/modules/purchasing/costs/service";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Lançamento de custos no PostgreSQL", () => {
  const cycles = ["2098-06-01", "2098-06-02", "2098-06-03", "2098-06-04"];
  const buyer: Principal = { userId: "", role: "COMPRADOR", storeId: null };
  const manager: Principal = { userId: "", role: "GESTOR", storeId: null };
  const storeUser: Principal = { userId: "", role: "LOJA", storeId: "" };
  let storeId = "";
  let productId = "";
  let newProductId = "";

  beforeAll(async () => {
    const sql = database().sql;
    const stamp = Date.now();
    const [store] = await sql<{ id: string }[]>`
      INSERT INTO stores(slug, name)
      VALUES (${`cost-integration-${stamp}`}, 'Loja custo integração')
      RETURNING id
    `;
    storeId = store.id;
    const users = await sql<{ id: string; role: string }[]>`
      INSERT INTO users(email, name, password_hash, role, store_id) VALUES
        (${`cost-buyer-${stamp}@example.com`}, 'Comprador custos', 'test', 'COMPRADOR', NULL),
        (${`cost-store-${stamp}@example.com`}, 'Loja custos', 'test', 'LOJA', ${storeId})
      RETURNING id, role::text
    `;
    buyer.userId = users.find((user) => user.role === "COMPRADOR")!.id;
    manager.userId = buyer.userId;
    storeUser.userId = users.find((user) => user.role === "LOJA")!.id;
    storeUser.storeId = storeId;
    const products = await sql<{ id: string }[]>`
      INSERT INTO products(erp_code, name, unit, purchase_format, markup, exclusive_supplier)
      VALUES
        (${910000 + (stamp % 10000)}, 'PRODUTO CUSTO INTEGRAÇÃO', 'KG', 'CX', 0, true),
        (${920000 + (stamp % 10000)}, 'PRODUTO PRIMEIRO CUSTO', 'UND', 'UND', 0, false)
      RETURNING id
    `;
    [productId, newProductId] = products.map((product) => product.id);
    for (const [index, cycle] of cycles.entries()) {
      const [order] = await sql<{ id: string }[]>`
        INSERT INTO orders(
          store_id, order_date, purchase_cycle_date, cutoff_at,
          revision, submitted_by, submitted_at
        ) VALUES (
          ${storeId}, ${cycle}, ${cycle}, ${`${cycle}T22:00:00Z`},
          1, ${buyer.userId}, ${`${cycle}T18:00:00Z`}
        ) RETURNING id
      `;
      await sql`
        INSERT INTO order_items(
          order_id, product_id, stock, quantity,
          snapshot_erp_code, snapshot_name, snapshot_unit
        ) VALUES
          (${order.id}, ${productId}, 999, ${10 + index}, 910000, 'PRODUTO CUSTO INTEGRAÇÃO', 'KG'),
          (${order.id}, ${newProductId}, 999, 2, 920000, 'PRODUTO PRIMEIRO CUSTO', 'UND')
      `;
    }
  });

  afterAll(async () => {
    await database().sql.end();
  });

  it("salva custo de trabalho sem torná-lo referência oficial", async () => {
    const saved = await savePurchaseCost(buyer, {
      productId,
      cycleDate: cycles[0],
      costInput: "75,00",
      purchased: false,
      expectedVersion: 0,
    });
    expect(saved).toMatchObject({ cost: "75.00", purchased: false, version: 1 });
    const next = await loadPurchaseCosts(buyer, cycles[1]);
    const product = next.products.find((row) => row.id === productId)!;
    expect(product.previousCost).toBeNull();
    expect(product.currentCost).toBeNull();
  });

  it("marcar Comprado transforma o custo em referência e pré-preenche o próximo ciclo", async () => {
    await savePurchaseCost(buyer, {
      productId,
      cycleDate: cycles[0],
      costInput: "75,00",
      purchased: true,
      expectedVersion: 1,
    });
    const next = await loadPurchaseCosts(manager, cycles[1]);
    const product = next.products.find((row) => row.id === productId)!;
    expect(product.previousCost).toBe("75.00");
    expect(product.currentCost).toBe("75.00");
    expect(product.inheritedCost).toBe(true);
  });

  it("desmarcar mantém o custo salvo e o retira da referência oficial", async () => {
    const draft = await savePurchaseCost(buyer, {
      productId,
      cycleDate: cycles[1],
      costInput: "78,00",
      purchased: false,
      expectedVersion: 0,
    });
    expect(draft).toMatchObject({ cost: "78.00", purchased: false });
    expect(
      (await loadPurchaseCosts(buyer, cycles[2])).products.find(
        (row) => row.id === productId,
      )?.previousCost,
    ).toBe("75.00");

    const purchased = await savePurchaseCost(buyer, {
      productId,
      cycleDate: cycles[1],
      costInput: "78,00",
      purchased: true,
      expectedVersion: 1,
    });
    expect(purchased.version).toBe(2);
    expect(
      (await loadPurchaseCosts(buyer, cycles[2])).products.find(
        (row) => row.id === productId,
      )?.previousCost,
    ).toBe("78.00");

    const unchecked = await savePurchaseCost(buyer, {
      productId,
      cycleDate: cycles[1],
      costInput: "78,00",
      purchased: false,
      expectedVersion: 2,
    });
    expect(unchecked).toMatchObject({ cost: "78.00", purchased: false, version: 3 });
    expect(
      (await loadPurchaseCosts(buyer, cycles[2])).products.find(
        (row) => row.id === productId,
      )?.previousCost,
    ).toBe("75.00");
  });

  it("corrige custo já comprado sem criar outra linha de produto/ciclo", async () => {
    await savePurchaseCost(buyer, {
      productId,
      cycleDate: cycles[1],
      costInput: "80,00",
      purchased: true,
      expectedVersion: 3,
    });
    const corrected = await savePurchaseCost(manager, {
      productId,
      cycleDate: cycles[1],
      costInput: "79,00",
      purchased: true,
      expectedVersion: 4,
    });
    expect(corrected).toMatchObject({ cost: "79.00", purchased: true, version: 5 });
    const [count] = await database().sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM purchase_cycle_product_costs
      WHERE product_id = ${productId} AND purchase_cycle_date = ${cycles[1]}::date
    `;
    expect(count.count).toBe(1);
    expect(
      (await loadPurchaseCosts(buyer, cycles[2])).products.find(
        (row) => row.id === productId,
      )?.previousCost,
    ).toBe("79.00");
  });

  it("impede Comprado sem custo e valida dinheiro no servidor", async () => {
    await expect(
      savePurchaseCost(buyer, {
        productId: newProductId,
        cycleDate: cycles[0],
        costInput: "",
        purchased: true,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/Informe o custo antes/);
    for (const costInput of ["-1", "NaN", "Infinity", "0", "100000000"])
      await expect(
        savePurchaseCost(buyer, {
          productId: newProductId,
          cycleDate: cycles[0],
          costInput,
          purchased: false,
          expectedVersion: 0,
        }),
      ).rejects.toThrow();
  });

  it("recusa usuário Loja e produto sem pedido no ciclo", async () => {
    await expect(
      savePurchaseCost(storeUser, {
        productId,
        cycleDate: cycles[2],
        costInput: "80,00",
        purchased: false,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/restrito/);
    await expect(loadPurchaseCosts(storeUser, cycles[2])).rejects.toThrow(
      /restrito/,
    );
    await expect(
      savePurchaseCost(buyer, {
        productId: "00000000-0000-0000-0000-000000000000",
        cycleDate: cycles[2],
        costInput: "80,00",
        purchased: false,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/sem pedido válido/);
  });

  it("controle otimista impede resposta antiga de sobrescrever a nova", async () => {
    const first = await savePurchaseCost(buyer, {
      productId,
      cycleDate: cycles[2],
      costInput: "88,00",
      purchased: false,
      expectedVersion: 0,
    });
    expect(first.version).toBe(1);
    const results = await Promise.allSettled([
      persistPurchaseCost(buyer, {
        productId,
        cycleDate: cycles[2],
        cost: "90.00",
        purchased: false,
        expectedVersion: 1,
      }),
      persistPurchaseCost(buyer, {
        productId,
        cycleDate: cycles[2],
        cost: "91.00",
        purchased: true,
        expectedVersion: 1,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      PurchaseCostConflictError,
    );
    const [current] = await database().sql<
      { cost: string; purchased: boolean; version: number }[]
    >`
      SELECT cost::text, purchased, version
      FROM purchase_cycle_product_costs
      WHERE product_id = ${productId} AND purchase_cycle_date = ${cycles[2]}::date
    `;
    expect(current.version).toBe(2);
    const final = await persistPurchaseCost(buyer, {
      productId,
      cycleDate: cycles[2],
      cost: "91.00",
      purchased: true,
      expectedVersion: current.version,
    });
    expect(final).toMatchObject({ cost: "91.00", purchased: true, version: 3 });
  });

  it("ciclos preservam estados independentes e custo anterior cronológico", async () => {
    const cycleOne = (await loadPurchaseCosts(buyer, cycles[0])).products.find(
      (row) => row.id === productId,
    )!;
    const cycleTwo = (await loadPurchaseCosts(buyer, cycles[1])).products.find(
      (row) => row.id === productId,
    )!;
    const cycleThree = (await loadPurchaseCosts(buyer, cycles[2])).products.find(
      (row) => row.id === productId,
    )!;
    const cycleFour = (await loadPurchaseCosts(buyer, cycles[3])).products.find(
      (row) => row.id === productId,
    )!;
    expect(cycleOne).toMatchObject({ currentCost: "75.00", purchased: true });
    expect(cycleTwo).toMatchObject({ currentCost: "79.00", purchased: true });
    expect(cycleThree).toMatchObject({ currentCost: "91.00", purchased: true });
    expect(cycleFour).toMatchObject({ previousCost: "91.00", currentCost: "91.00" });
  });
});
