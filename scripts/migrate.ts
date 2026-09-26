import "dotenv/config";
import { databaseUrlFromEnv } from "./database-url";
import { runMigrations } from "./migration-runner.mjs";

const url = databaseUrlFromEnv();
await runMigrations({
  databaseUrl: url,
  onApplied: (filename) => console.log(`Migration ${filename} aplicada com sucesso.`),
});
