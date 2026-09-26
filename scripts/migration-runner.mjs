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
        const foundBaselineTables = BASELINE_REQUIRED_TABLES.filter((t) => existingTables.has(t));

        if (foundBaselineTables.length === BASELINE_REQUIRED_TABLES.length) {
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
        } else if (foundBaselineTables.length > 0) {
          throw new Error(
            `Falha de baseline legado: banco de dados em estado inconsistente. Encontradas apenas ${foundBaselineTables.length} de ${BASELINE_REQUIRED_TABLES.length} tabelas obrigatórias do baseline 0001–0008.`,
          );
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
      await sql`SELECT pg_advisory_unlock(${MIGRATIONS_LOCK_ID})`;
    }
  } finally {
    await sql.end();
  }

  return migrationFilenames;
}
