import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import * as schema from "./schema";

let singleton: ReturnType<typeof createClient> | undefined;
let currentUrl: string | undefined;

function createClient() {
  const url = process.env.DATABASE_URL ?? (process.env.DATABASE_URL_FILE ? readFileSync(process.env.DATABASE_URL_FILE, "utf8").trim() : undefined);
  if (!url) throw new Error("DATABASE_URL não configurada");
  currentUrl = url;
  const sql = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  return { db: drizzle(sql, { schema }), sql };
}

export function database() {
  const url = process.env.DATABASE_URL ?? (process.env.DATABASE_URL_FILE ? readFileSync(process.env.DATABASE_URL_FILE, "utf8").trim() : undefined);
  if (singleton && currentUrl !== url) {
    const previous = singleton;
    singleton = undefined;
    // Encerra o pool anterior com timeout de 2 segundos.
    // LIMITAÇÃO CONHECIDA (Ressalva não bloqueadora):
    // sql.end({ timeout: 2 }) da biblioteca postgres.js força destroy() nas conexões caso excedam 2s,
    // podendo interromper transações em andamento com CONNECTION_DESTROYED (não é drenagem graciosa).
    // No deploy produtivo (Docker Swarm), DATABASE_URL_FILE é imutável durante o ciclo de vida do container
    // (conforme infra/stack.yml:14), de modo que essa troca dinâmica de URL ocorre exclusivamente
    // no harness de testes de integração entre arquivos ou migrações de teste.
    previous.sql.end({ timeout: 2 }).catch(() => {});
  }
  singleton ??= createClient();
  return singleton;
}
