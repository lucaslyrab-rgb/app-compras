import { readFileSync } from "node:fs";

export function databaseUrlFromEnv() {
  const url = process.env.DATABASE_URL ?? (process.env.DATABASE_URL_FILE ? readFileSync(process.env.DATABASE_URL_FILE, "utf8").trim() : undefined);
  if (!url) throw new Error("DATABASE_URL ou DATABASE_URL_FILE não configurada");
  return url;
}
