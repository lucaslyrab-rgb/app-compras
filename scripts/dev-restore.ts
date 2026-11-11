/**
 * Carrega uma cópia do banco de produção no ambiente local para testar com
 * ciclos reais (docs/desenvolvimento-local.md).
 *
 *   npm run dev:restore -- caminho/do/backup.dump
 *
 * - Só roda com DATABASE_URL apontando para localhost; apaga e recria o banco LOCAL.
 * - O arquivo é um `pg_dump -Fc` já descriptografado (o backup do S3 vem em .age).
 * - Depois de restaurar: aplica migrations novas, troca a senha de TODOS os
 *   usuários para DEV_PASSWORD e encerra as sessões copiadas da produção.
 * - Fotos e notas ficam no S3 de produção e não são copiadas: aparecem sem imagem.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import postgres from "postgres";
import { assertLocalDatabaseUrl, databaseName } from "../src/lib/dev-safety";
import { hashPassword } from "../src/modules/identity/domain";
import { runMigrations } from "./migration-runner.mjs";

const COMPOSE = ["compose", "-f", "docker-compose.dev.yml", "exec", "-T", "db"];

function docker(args: string[], input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [...COMPOSE, ...args], { stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] });
    if (input) fs.createReadStream(input).pipe(child.stdin!);
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`docker ${args[0]} terminou com código ${code}`))));
  });
}

const url = assertLocalDatabaseUrl(process.env.DATABASE_URL);
const dbName = databaseName(url);
const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!file || !fs.existsSync(file)) throw new Error("Informe o arquivo: npm run dev:restore -- caminho/do/backup.dump");
if (file.endsWith(".age")) throw new Error("Descriptografe antes com age (veja docs/desenvolvimento-local.md).");
const password = process.env.DEV_PASSWORD ?? "";
if (password.length < 8) throw new Error("Defina DEV_PASSWORD no .env (mínimo 8 caracteres).");

console.log(`Recriando o banco local "${dbName}"...`);
await docker(["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`]);
await docker(["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${dbName}"`]);

console.log("Restaurando a cópia (pode levar alguns minutos)...");
await docker(["pg_restore", "-U", "postgres", "--no-owner", "--no-privileges", "-d", dbName], file);

await runMigrations({ databaseUrl: url.toString(), onApplied: (name) => console.log(`Migration ${name} aplicada.`) });

const sql = postgres(url.toString(), { max: 1 });
try {
  const passwordHash = await hashPassword(password);
  await sql`DELETE FROM sessions`;
  const users = await sql<{ email: string; role: string; active: boolean }[]>`
    UPDATE users SET password_hash = ${passwordHash} RETURNING email, role, active
  `;
  console.log("\nCópia carregada. Todos os usuários entram com a senha DEV_PASSWORD do .env:");
  for (const user of users.filter((u) => u.active)) console.log(`  ${user.email.padEnd(40)} ${user.role}`);
} finally {
  await sql.end();
}
