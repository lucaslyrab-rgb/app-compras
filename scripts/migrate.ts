import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { databaseUrlFromEnv } from "./database-url";

const url = databaseUrlFromEnv();
const sql = postgres(url, { max: 1 });
try {
  const migration = await readFile(path.resolve("migrations/0001_foundation.sql"), "utf8");
  await sql.unsafe(migration);
  console.log("Migration 0001 aplicada com sucesso.");
} finally {
  await sql.end();
}
