import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const MIGRATION_FILENAME = /^(\d+)_.*\.sql$/;
const MIGRATIONS_LOCK_ID = 8943729184719284n;

export const BASELINE_REQUIRED_TABLES = [
  "users",
  "stores",
  "sessions",
  "products",
  "orders",
  "order_items",
  "order_drafts",
  "order_draft_items",
  "audit_events",
  "purchase_cycle_product_costs",
  "product_pricing_parameters",
  "pricing_settings",
  "pricing_reviews",
  "purchase_calendar_settings",
];

export const BASELINE_REQUIRED_COLUMNS = [
  { table: "orders", column: "cancelled_at" },
  { table: "orders", column: "cancelled_by" },
  { table: "orders", column: "cancellation_reason" },
  { table: "orders", column: "purchase_cycle_date" },
  { table: "orders", column: "cutoff_at" },
  { table: "order_items", column: "snapshot_erp_code" },
  { table: "order_items", column: "snapshot_name" },
  { table: "order_items", column: "snapshot_unit" },
  { table: "purchase_cycle_product_costs", column: "cost_is_unit" },
];

export const BASELINE_REQUIRED_ROUTINES = [
  "prevent_order_mutation",
  "prevent_pricing_review_mutation",
];

export const BASELINE_REQUIRED_TRIGGERS = [
  { table: "orders", trigger: "immutable_orders" },
  { table: "order_items", trigger: "immutable_order_items" },
  { table: "pricing_reviews", trigger: "pricing_reviews_immutable" },
];

export const BASELINE_REQUIRED_SINGLETONS = [
  { table: "pricing_settings", column: "id", value: "FLV" },
  { table: "purchase_calendar_settings", column: "id", value: "OPERATIONAL" },
];

export function computeChecksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

export async function discoverMigrations(migrationsDirectory = path.resolve("migrations")) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = [];
  const prefixes = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;

    const match = MIGRATION_FILENAME.exec(entry.name);
    if (!match) {
      throw new Error(`Migration SQL sem prefixo numérico válido: ${entry.name}`);
    }

    const numericPrefix = BigInt(match[1]);
    const duplicate = prefixes.get(numericPrefix);
    if (duplicate) {
      throw new Error(`Prefixo numérico duplicado nas migrations: ${duplicate} e ${entry.name}`);
    }

    prefixes.set(numericPrefix, entry.name);
    migrations.push({ filename: entry.name, numericPrefix });
  }

  migrations.sort((left, right) =>
    left.numericPrefix < right.numericPrefix ? -1 : left.numericPrefix > right.numericPrefix ? 1 : 0,
  );
  return migrations.map(({ filename }) => filename);
}

export async function runMigrations({
  databaseUrl,
  migrationsDirectory = path.resolve("migrations"),
  onApplied,
}) {
  const migrationFilenames = await discoverMigrations(migrationsDirectory);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15 });

  try {
    await sql`SELECT pg_advisory_lock(${MIGRATIONS_LOCK_ID})`;
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      const recordedRows = await sql`
        SELECT filename, checksum FROM schema_migrations
      `;
      const recorded = new Map(recordedRows.map((row) => [row.filename, row.checksum]));

      const baselineCandidateFilenames = migrationFilenames.filter((filename) => {
        const match = MIGRATION_FILENAME.exec(filename);
        return match && BigInt(match[1]) <= 8n && !recorded.has(filename);
      });

      if (baselineCandidateFilenames.length > 0) {
        const tableRows = await sql`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_type = 'BASE TABLE'
        `;
        const existingTables = new Set(tableRows.map((r) => r.table_name));
        existingTables.delete("schema_migrations");

        const foundBaselineTables = BASELINE_REQUIRED_TABLES.filter((t) => existingTables.has(t));

        if (existingTables.size > 0 || foundBaselineTables.length > 0) {
          const missingTables = BASELINE_REQUIRED_TABLES.filter((t) => !existingTables.has(t));
          if (missingTables.length > 0) {
            throw new Error(
              `Falha de baseline legado: banco de dados em estado inconsistente. Tabelas obrigatórias ausentes no baseline 0001–0008: ${missingTables.join(", ")}`,
            );
          }

          const columnRows = await sql`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
          `;
          const existingColumns = new Set(columnRows.map((r) => `${r.table_name}.${r.column_name}`));
          const missingColumns = BASELINE_REQUIRED_COLUMNS.filter(
            (c) => !existingColumns.has(`${c.table}.${c.column}`),
          );
          if (missingColumns.length > 0) {
            throw new Error(
              `Falha de baseline legado: banco de dados em estado inconsistente. Colunas obrigatórias ausentes no baseline 0001–0008: ${missingColumns.map((c) => `${c.table}.${c.column}`).join(", ")}`,
            );
          }

          const routineRows = await sql`
            SELECT routine_name
            FROM information_schema.routines
            WHERE routine_schema = current_schema()
          `;
          const existingRoutines = new Set(routineRows.map((r) => r.routine_name));
          const missingRoutines = BASELINE_REQUIRED_ROUTINES.filter((r) => !existingRoutines.has(r));
          if (missingRoutines.length > 0) {
            throw new Error(
              `Falha de baseline legado: banco de dados em estado inconsistente. Funções obrigatórias ausentes no baseline 0001–0008: ${missingRoutines.join(", ")}`,
            );
          }

          const triggerRows = await sql`
            SELECT c.relname AS table_name, t.tgname AS trigger_name
            FROM pg_trigger t
            JOIN pg_class c ON t.tgrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = current_schema()
              AND NOT t.tgisinternal
          `;
          const existingTriggers = new Set(triggerRows.map((r) => `${r.table_name}.${r.trigger_name}`));
          const missingTriggers = BASELINE_REQUIRED_TRIGGERS.filter(
            (t) => !existingTriggers.has(`${t.table}.${t.trigger}`),
          );
          if (missingTriggers.length > 0) {
            throw new Error(
              `Falha de baseline legado: banco de dados em estado inconsistente. Triggers obrigatórias ausentes no baseline 0001–0008: ${missingTriggers.map((t) => `${t.table}.${t.trigger}`).join(", ")}`,
            );
          }

          const pricingSettingsRow = await sql`
            SELECT 1 FROM pricing_settings WHERE id = ${"FLV"} LIMIT 1
          `;
          if (pricingSettingsRow.length === 0) {
            throw new Error(
              `Falha de baseline legado: banco de dados em estado inconsistente. Registro singleton obrigatório ausente em pricing_settings (id='FLV').`,
            );
          }

          const calendarSettingsRow = await sql`
            SELECT 1 FROM purchase_calendar_settings WHERE id = ${"OPERATIONAL"} LIMIT 1
          `;
          if (calendarSettingsRow.length === 0) {
            throw new Error(
              `Falha de baseline legado: banco de dados em estado inconsistente. Registro singleton obrigatório ausente em purchase_calendar_settings (id='OPERATIONAL').`,
            );
          }

          for (const filename of baselineCandidateFilenames) {
            const content = await readFile(path.join(migrationsDirectory, filename), "utf8");
            const checksum = computeChecksum(content);
            await sql`
              INSERT INTO schema_migrations (filename, checksum)
              VALUES (${filename}, ${checksum})
              ON CONFLICT (filename) DO NOTHING
            `;
            recorded.set(filename, checksum);
          }
        }
      }

      for (const filename of migrationFilenames) {
        const content = await readFile(path.join(migrationsDirectory, filename), "utf8");
        const checksum = computeChecksum(content);

        if (recorded.has(filename)) {
          const expectedChecksum = recorded.get(filename);
          if (expectedChecksum !== checksum) {
            throw new Error(
              `Checksum divergente na migration ${filename}: esperado ${expectedChecksum}, encontrado ${checksum}`,
            );
          }
          continue;
        }

        try {
          await sql.unsafe(content);
        } catch (error) {
          try {
            await sql.unsafe("ROLLBACK");
          } catch {
            // Ignora se não houver transação aberta para preservar o erro original
          }
          throw new Error(`Falha ao aplicar migration ${filename}`, { cause: error });
        }

        await sql`
          INSERT INTO schema_migrations (filename, checksum)
          VALUES (${filename}, ${checksum})
        `;
        recorded.set(filename, checksum);
        await onApplied?.(filename);
      }
    } finally {
      try {
        await sql.unsafe("ROLLBACK");
      } catch {
        // Rollback defensivo caso tenha ocorrido erro prévio em transação aberta
      }
      try {
        await sql`SELECT pg_advisory_unlock(${MIGRATIONS_LOCK_ID})`;
      } catch {
        // Nunca mascara o erro original caso o unlock falhe
      }
    }
  } finally {
    await sql.end();
  }

  return migrationFilenames;
}
