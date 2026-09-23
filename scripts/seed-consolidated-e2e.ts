// Disposable local E2E database only. Never run this against the application database.
import postgres from "postgres";
import { hashPassword } from "../src/modules/identity/domain";

const url = process.env.DATABASE_URL;
const password = process.env.CONSOLIDATED_E2E_PASSWORD;
if (!url || !password)
  throw new Error("DATABASE_URL e CONSOLIDATED_E2E_PASSWORD obrigatórios");
const parsed = new URL(url);
if (
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  parsed.pathname !== "/consolidado_e2e"
)
  throw new Error(
    "Seed permitido apenas no banco local descartável consolidado_e2e",
  );
const sql = postgres(url, { max: 1 });
try {
  const [{ count }] = await sql<
    { count: number }[]
  >`SELECT count(*)::int AS count FROM orders`;
  if (count) throw new Error("Seed requer banco descartável sem pedidos");
  const stores = await sql<
    { id: string }[]
  >`SELECT id FROM stores WHERE active ORDER BY slug`;
  const hash = await hashPassword(password);
  const users: Record<string, string> = {};
  for (const role of ["LOJA", "COMPRADOR", "GESTOR"]) {
    const [user] = await sql<
      { id: string }[]
    >`INSERT INTO users(email,name,password_hash,role,store_id)
      VALUES (${`${role.toLowerCase()}@consolidado.test`},${`E2E ${role}`},${hash},${role},${role === "LOJA" ? stores[0].id : null}) RETURNING id`;
    users[role] = user.id;
  }
  const products = await sql<
    { id: string; erp_code: number; name: string; unit: string }[]
  >`SELECT id,erp_code,name,unit FROM products ORDER BY erp_code`;
  await sql`UPDATE products SET name='BANANA TESTE',purchase_format='CX',exclusive_supplier=true WHERE id=${products[0].id}`;
  await sql`UPDATE products SET name='PRODUTO COM NOME EXTREMAMENTE LONGO PARA CONFERIR LEGIBILIDADE SEM OVERFLOW',purchase_format='SC' WHERE id=${products[1].id}`;
  await sql`UPDATE products SET purchase_format='UND' WHERE id=${products[2].id}`;
  for (const cycle of ["2097-09-22", "2097-09-23", "2097-09-24"]) {
    const number = cycle === "2097-09-24" ? 3 : cycle === "2097-09-23" ? 2 : 1;
    for (let s = 0; s < number; s++) {
      for (let rev = 1; rev <= (s === 0 ? 2 : 1); rev++) {
        const [order] = await sql<
          { id: string }[]
        >`INSERT INTO orders(store_id,order_date,purchase_cycle_date,cutoff_at,revision,submitted_by,submitted_at)
          VALUES (${stores[s].id},${cycle},${cycle},${`${cycle}T22:00:00Z`},${rev},${users.COMPRADOR},${`${cycle}T${16 + rev}:00:00Z`}) RETURNING id`;
        await sql`INSERT INTO order_items ${sql(products.map((p, i) => ({ order_id: order.id, product_id: p.id, stock: 20 + s, quantity: i === 0 ? [10, 5, 8][s] : i === 1 ? [2, 3, 1][s] : i === 2 ? [6, 10, 4][s] : 0, snapshot_erp_code: p.erp_code, snapshot_name: p.name, snapshot_unit: p.unit })))}`;
        if (cycle === "2097-09-22" && rev === 2)
          await sql`UPDATE orders SET cancelled_at=now(),cancelled_by=${users.COMPRADOR} WHERE id=${order.id}`;
      }
    }
  }
  await sql`
    INSERT INTO purchase_cycle_product_costs(
      product_id, purchase_cycle_date, cost, purchased, purchased_at, updated_by
    ) VALUES
      (${products[0].id}, '2097-09-23', 72, true, '2097-09-23T18:00:00Z', ${users.COMPRADOR}),
      (${products[1].id}, '2097-09-23', 55, false, NULL, ${users.COMPRADOR})
  `;
  console.log(
    "Fixture de Consolidado/Custos criada no banco local descartável (3 ciclos, 74 produtos, 3 perfis).",
  );
} finally {
  await sql.end();
}
