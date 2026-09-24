import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { databaseUrlFromEnv } from "./database-url";

const url = databaseUrlFromEnv();
const sql = postgres(url, { max: 1 });
try {
  for (const file of [
    "0001_foundation.sql",
    "0002_store_order_snapshots_cancel.sql",
    "0003_purchase_cycles.sql",
    "0004_purchase_cycle_product_costs.sql",
    "0005_pricing_parameters_and_cost_basis.sql",
    "0006_pricing_reviews.sql",
  ]) {
    const migration = await readFile(path.resolve("migrations", file), "utf8");
    await sql.unsafe(migration);
    console.log(`Migration ${file} aplicada com sucesso.`);
  }
} finally {
  await sql.end();
}
