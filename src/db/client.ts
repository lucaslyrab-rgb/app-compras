import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import * as schema from "./schema";

let singleton: ReturnType<typeof createClient> | undefined;

function createClient() {
  const url = process.env.DATABASE_URL ?? (process.env.DATABASE_URL_FILE ? readFileSync(process.env.DATABASE_URL_FILE, "utf8").trim() : undefined);
  if (!url) throw new Error("DATABASE_URL não configurada");
  const sql = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  return { db: drizzle(sql, { schema }), sql };
}

export function database() {
  singleton ??= createClient();
  return singleton;
}
