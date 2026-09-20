import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não configurada");
const sql = postgres(url, { max: 1 });
try {
  const migration = await readFile(path.resolve("migrations/0001_foundation.sql"), "utf8");
  await sql.unsafe(migration);
  console.log("Migration 0001 aplicada com sucesso.");
} finally {
  await sql.end();
}
