// Disposable local E2E database only. Never run this against the application database.
import postgres from "postgres";
import { hashPassword } from "../src/modules/identity/domain";
import { operationalLocalDate } from "../src/modules/ordering/calendar/domain";
import { readOperationalPurchaseCalendar } from "../src/modules/ordering/calendar/service";

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
  await sql`UPDATE products SET name='PRODUTO NORMAL COM NOME EXTREMAMENTE LONGO PARA CONFERIR LEGIBILIDADE SEM OVERFLOW',purchase_format='CX' WHERE id=${products[1].id}`;
  await sql`UPDATE products SET name='CEBOLA TESTE',purchase_format='UND' WHERE id=${products[2].id}`;
  await sql`UPDATE products SET name='ABACAXI UN',purchase_format='UND' WHERE id=${products[3].id}`;
  await sql`UPDATE products SET name='PRODUTO AUSÊNCIA TESTE',purchase_format='UND' WHERE id=${products[4].id}`;
  await sql`UPDATE products SET name='PRODUTO 999 TESTE',purchase_format='CX' WHERE id=${products[5].id}`;
  await sql`
    UPDATE product_pricing_parameters pp
    SET sale_unit = configured.sale_unit,
        conversion_quantity = configured.conversion_quantity,
        conversion_origin = configured.conversion_origin,
        beneficiation_loss_percent = configured.loss
    FROM (VALUES
      (${products[0].id}::uuid, 'KG', 20::numeric, 'PROVISIONAL', 0::numeric),
      (${products[1].id}::uuid, 'KG', 20::numeric, 'PROVISIONAL', 0::numeric),
      (${products[2].id}::uuid, 'UND', 1::numeric, 'UNIT', 0::numeric),
      (${products[3].id}::uuid, 'UND', 1::numeric, 'UNIT', 0::numeric),
      (${products[4].id}::uuid, 'UND', 1::numeric, 'UNIT', 0::numeric),
      (${products[5].id}::uuid, 'KG', 20::numeric, 'PROVISIONAL', 0::numeric)
    ) AS configured(product_id, sale_unit, conversion_quantity, conversion_origin, loss)
    WHERE pp.product_id = configured.product_id
  `;
  const mobileScenarioQuantities = [
    [10, 5, 8],
    [2, 1, 2],
    [1, 1, 1],
    [1, 1, 1],
    [null, 1, null],
    [999, 999, 999],
  ];
  for (const cycle of ["2097-09-22", "2097-09-23", "2097-09-24"]) {
    const number = cycle === "2097-09-24" ? 3 : cycle === "2097-09-23" ? 2 : 1;
    for (let s = 0; s < number; s++) {
      for (let rev = 1; rev <= (s === 0 ? 2 : 1); rev++) {
        const [order] = await sql<
          { id: string }[]
        >`INSERT INTO orders(store_id,order_date,purchase_cycle_date,cutoff_at,revision,submitted_by,submitted_at)
          VALUES (${stores[s].id},${cycle},${cycle},${`${cycle}T22:00:00Z`},${rev},${users.COMPRADOR},${`${cycle}T${16 + rev}:00:00Z`}) RETURNING id`;
        const orderItems = products.flatMap((p, i) => {
          const mobileQuantity = mobileScenarioQuantities[i]?.[s];
          if (cycle === "2097-09-24" && mobileQuantity === null) return [];
          return [
            {
              order_id: order.id,
              product_id: p.id,
              stock: 20 + s,
              quantity:
                cycle === "2097-09-24" && mobileQuantity !== undefined
                  ? mobileQuantity
                  : i === 0
                    ? [10, 5, 8][s]
                    : i === 1
                      ? [2, 3, 1][s]
                      : i === 2
                        ? [6, 10, 4][s]
                        : 0,
              snapshot_erp_code: p.erp_code,
              snapshot_name: p.name,
              snapshot_unit: p.unit,
            },
          ];
        });
        await sql`INSERT INTO order_items ${sql(orderItems)}`;
        if (cycle === "2097-09-22" && rev === 2)
          await sql`UPDATE orders SET cancelled_at=now(),cancelled_by=${users.COMPRADOR} WHERE id=${order.id}`;
      }
    }
  }
  await sql`
    INSERT INTO purchase_cycle_product_costs(
      product_id, purchase_cycle_date, cost, cost_is_unit, purchased, purchased_at, updated_by
    ) VALUES
      (${products[0].id}, '2097-09-23', 72, false, true, '2097-09-23T18:00:00Z', ${users.COMPRADOR}),
      (${products[1].id}, '2097-09-23', 55, false, false, NULL, ${users.COMPRADOR}),
      (${products[1].id}, '2097-09-24', 5, false, false, NULL, ${users.COMPRADOR}),
      (${products[2].id}, '2097-09-24', 7.5, true, true, '2097-09-24T18:00:00Z', ${users.COMPRADOR}),
      (${products[3].id}, '2097-09-23', 7.5, false, true, '2097-09-23T18:00:00Z', ${users.COMPRADOR}),
      (${products[3].id}, '2097-09-24', 8, false, true, '2097-09-24T18:30:00Z', ${users.COMPRADOR}),
      (${products[5].id}, '2097-09-24', 999.99, false, false, NULL, ${users.COMPRADOR})
  `;
  const calendar = await readOperationalPurchaseCalendar();
  const referenceCycle = operationalLocalDate(new Date(), calendar.timezone);
  const previousCycleDate = new Date(`${referenceCycle}T12:00:00Z`);
  previousCycleDate.setUTCDate(previousCycleDate.getUTCDate() - 1);
  const previousCycle = previousCycleDate.toISOString().slice(0, 10);
  await sql`
    INSERT INTO purchase_cycle_product_costs(
      product_id, purchase_cycle_date, cost, cost_is_unit, purchased, purchased_at, updated_by
    ) VALUES
      (${products[0].id}, ${referenceCycle}, 100, false, true, now(), ${users.COMPRADOR}),
      (${products[6].id}, ${previousCycle}, 50, false, true, now() - interval '1 day', ${users.COMPRADOR}),
      (${products[2].id}, ${referenceCycle}, 7.5, true, true, now(), ${users.COMPRADOR})
  `;
  const [reviewedCost] = await sql<{ id: string }[]>`
    INSERT INTO purchase_cycle_product_costs(
      product_id, purchase_cycle_date, cost, cost_is_unit, purchased, purchased_at, updated_by
    ) VALUES (${products[3].id}, ${referenceCycle}, 7.5, false, true, now(), ${users.COMPRADOR})
    RETURNING id
  `;
  const fingerprint = `${reviewedCost.id}|1|7.50|0|UND|1.000000|0.0000|23.0000|20.0000`;
  await sql`
    INSERT INTO pricing_reviews(
      product_id, official_cost_id, official_cost_version, official_purchase_cycle_date,
      official_cost, cost_is_unit, sale_unit, conversion_quantity, conversion_origin,
      beneficiation_loss_percent, parameter_version, operating_cost_percent,
      desired_margin_percent, margin_origin, settings_version, gross_unit_cost,
      effective_unit_cost, calculated_price, suggested_price, input_fingerprint, reviewed_by
    ) VALUES (
      ${products[3].id}, ${reviewedCost.id}, 1, ${referenceCycle}, 7.5, false,
      'UND', 1, 'UNIT', 0, 1, 23, 20, 'DEFAULT', 1, 7.5, 7.5,
      13.157895, 12.99, ${fingerprint}, ${users.GESTOR}
    )
  `;
  await sql`
    UPDATE purchase_cycle_product_costs
    SET cost = 8, version = 2, updated_at = now()
    WHERE id = ${reviewedCost.id}
  `;
  console.log(
    "Fixture de Consolidado/Custos criada no banco local descartável (3 ciclos, 74 produtos, 3 perfis).",
  );
} finally {
  await sql.end();
}
