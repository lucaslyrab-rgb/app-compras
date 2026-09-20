import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL ?? (process.env.DATABASE_URL_FILE ? readFileSync(process.env.DATABASE_URL_FILE, "utf8").trim() : undefined);
if (!databaseUrl) throw new Error("DATABASE_URL ou DATABASE_URL_FILE não configurada");
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15 });
try {
  await sql.unsafe(readFileSync("/app/migrations/0002_store_order_snapshots_cancel.sql", "utf8"));
  console.log("Migration 0002 aplicada/verificada.");
} finally {
  await sql.end();
}
const child = spawn("node", ["server.js"], { stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
