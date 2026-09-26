import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { runMigrations } from "./migration-runner.mjs";

const databaseUrl = process.env.DATABASE_URL ?? (process.env.DATABASE_URL_FILE ? readFileSync(process.env.DATABASE_URL_FILE, "utf8").trim() : undefined);
if (!databaseUrl) throw new Error("DATABASE_URL ou DATABASE_URL_FILE não configurada");
await runMigrations({
  databaseUrl,
  onApplied: (filename) => console.log(`Migration ${filename} aplicada/verificada.`),
});

const child = spawn("node", ["server.js"], { stdio: "inherit" });
child.on("error", (error) => {
  console.error("Falha ao iniciar server.js", error);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
