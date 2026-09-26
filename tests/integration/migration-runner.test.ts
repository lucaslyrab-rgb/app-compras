import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASELINE_REQUIRED_TABLES,
  discoverMigrations,
  runMigrations,
} from "../../scripts/migration-runner.mjs";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("migration-runner integration", () => {
  let tempDir: string;
  const stamp = Date.now();
  const testSchema = `test_runner_${stamp}`;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "migration-runner-test-"));
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${testSchema}"`);
    await sql.end();
  });

  afterAll(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    if (process.env.DATABASE_URL) {
      const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await sql.end();
    }
  });

  it("descobre migrations em ordem e rejeita prefixo duplicado ou inválido", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runner-disc-"));
    try {
      await writeFile(path.join(dir, "0002_second.sql"), "SELECT 2;");
      await writeFile(path.join(dir, "0001_first.sql"), "SELECT 1;");
      await writeFile(path.join(dir, "0010_tenth.sql"), "SELECT 10;");
      const list = await discoverMigrations(dir);
      expect(list).toEqual(["0001_first.sql", "0002_second.sql", "0010_tenth.sql"]);

      await writeFile(path.join(dir, "invalid.sql"), "SELECT 0;");
      await expect(discoverMigrations(dir)).rejects.toThrow(/prefixo numérico válido/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("executa migrations, registra no schema_migrations e não reaplica na segunda execução", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runner-run-"));
    const schema = `runner_exec_${Date.now()}`;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);

    try {
      await writeFile(path.join(dir, "0001_init.sql"), `CREATE TABLE "${schema}".test_items (id int);`);
      await writeFile(path.join(dir, "0002_add.sql"), `INSERT INTO "${schema}".test_items VALUES (42);`);

      const applied: string[] = [];
      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: dir,
        onApplied: (file) => { applied.push(file); },
      });

      expect(applied).toEqual(["0001_init.sql", "0002_add.sql"]);

      const isql = postgres(isolatedUrl.toString(), { max: 1 });
      const rows = await isql<{ id: number }[]>`SELECT id FROM test_items`;
      expect(rows).toEqual([{ id: 42 }]);

      const recorded = await isql<{ filename: string }[]>`SELECT filename FROM schema_migrations ORDER BY filename`;
      expect(recorded.map((r) => r.filename)).toEqual(["0001_init.sql", "0002_add.sql"]);
      await isql.end();

      const reapplied: string[] = [];
      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: dir,
        onApplied: (file) => { reapplied.push(file); },
      });
      expect(reapplied).toEqual([]);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falha quando o checksum do arquivo diverge da migration registrada", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runner-chk-"));
    const schema = `runner_chk_${Date.now()}`;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);

    try {
      await writeFile(path.join(dir, "0001_init.sql"), `CREATE TABLE "${schema}".test_chk (id int);`);
      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: dir,
      });

      await writeFile(path.join(dir, "0001_init.sql"), `CREATE TABLE "${schema}".test_chk (id int, name text);`);
      await expect(
        runMigrations({
          databaseUrl: isolatedUrl.toString(),
          migrationsDirectory: dir,
        }),
      ).rejects.toThrow(/checksum divergente/i);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("gerencia advisory lock para garantir exclusão mútua", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runner-lock-"));
    const schema = `runner_lock_${Date.now()}`;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);

    try {
      await writeFile(path.join(dir, "0001_init.sql"), `CREATE TABLE "${schema}".test_lock (id int);`);
      const otherSql = postgres(isolatedUrl.toString(), { max: 1 });
      await otherSql`SELECT pg_advisory_lock(8943729184719284)`;

      let runnerFinished = false;
      const runnerPromise = runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: dir,
      }).then(() => {
        runnerFinished = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(runnerFinished).toBe(false);

      await otherSql`SELECT pg_advisory_unlock(8943729184719284)`;
      await otherSql.end();

      await runnerPromise;
      expect(runnerFinished).toBe(true);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function provisionValidBaseline(sql: postgres.Sql, schema: string) {
    for (const table of BASELINE_REQUIRED_TABLES) {
      await sql.unsafe(`CREATE TABLE "${schema}"."${table}" (id int);`);
    }
    await sql.unsafe(`
      ALTER TABLE "${schema}".orders
        ADD COLUMN cancelled_at timestamptz,
        ADD COLUMN cancelled_by uuid,
        ADD COLUMN cancellation_reason text,
        ADD COLUMN purchase_cycle_date date,
        ADD COLUMN cutoff_at timestamptz;
      ALTER TABLE "${schema}".order_items
        ADD COLUMN snapshot_erp_code integer,
        ADD COLUMN snapshot_name text,
        ADD COLUMN snapshot_unit text;
      ALTER TABLE "${schema}".purchase_cycle_product_costs
        ADD COLUMN cost_is_unit boolean DEFAULT false;
      ALTER TABLE "${schema}".pricing_settings
        ALTER COLUMN id TYPE text;
      INSERT INTO "${schema}".pricing_settings (id) VALUES ('FLV');
      ALTER TABLE "${schema}".purchase_calendar_settings
        ALTER COLUMN id TYPE text;
      INSERT INTO "${schema}".purchase_calendar_settings (id) VALUES ('OPERATIONAL');
      CREATE OR REPLACE FUNCTION "${schema}".prevent_order_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NEW; END $$;
      CREATE TRIGGER immutable_orders BEFORE UPDATE OR DELETE ON "${schema}".orders FOR EACH ROW EXECUTE FUNCTION "${schema}".prevent_order_mutation();
      CREATE TRIGGER immutable_order_items BEFORE UPDATE OR DELETE ON "${schema}".order_items FOR EACH ROW EXECUTE FUNCTION "${schema}".prevent_order_mutation();
      CREATE OR REPLACE FUNCTION "${schema}".prevent_pricing_review_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NEW; END $$;
      CREATE TRIGGER pricing_reviews_immutable BEFORE UPDATE OR DELETE ON "${schema}".pricing_reviews FOR EACH ROW EXECUTE FUNCTION "${schema}".prevent_pricing_review_mutation();
    `);
  }

  it("detecta baseline legado 0001–0008, não reexecuta, e aplica 0009 e 0010 normalmente", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runner-base-"));
    const schema = `runner_base_${Date.now()}`;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);

    try {
      await provisionValidBaseline(sql, schema);

      for (let i = 1; i <= 8; i++) {
        const prefix = String(i).padStart(4, "0");
        await writeFile(path.join(dir, `${prefix}_test.sql`), `CREATE TABLE "${schema}".should_not_run_${i} (id int);`);
      }
      await writeFile(path.join(dir, "0009_applied.sql"), `ALTER TABLE "${schema}".pricing_reviews ADD COLUMN applied_price numeric(18,2);`);
      await writeFile(path.join(dir, "0010_decisions.sql"), `ALTER TABLE "${schema}".pricing_reviews ADD COLUMN decided_price numeric(18,2);`);

      const applied: string[] = [];
      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: dir,
        onApplied: (file) => { applied.push(file); },
      });

      expect(applied).toEqual(["0009_applied.sql", "0010_decisions.sql"]);

      const isql = postgres(isolatedUrl.toString(), { max: 1 });
      const [{ exists }] = await isql<{ exists: boolean }[]>`
        SELECT to_regclass(${`${schema}.should_not_run_1`}) IS NOT NULL AS exists
      `;
      expect(exists).toBe(false);

      const recorded = await isql<{ filename: string }[]>`SELECT filename FROM schema_migrations ORDER BY filename`;
      expect(recorded.length).toBe(10);
      await isql.end();
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falha-fechado (fail-closed) se o banco possui baseline legado com tabelas incompletas", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runner-inc-"));
    const schema = `runner_inc_${Date.now()}`;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);

    try {
      await sql.unsafe(`CREATE TABLE "${schema}".users (id int);`);
      await sql.unsafe(`CREATE TABLE "${schema}".products (id int);`);

      for (let i = 1; i <= 8; i++) {
        const prefix = String(i).padStart(4, "0");
        await writeFile(path.join(dir, `${prefix}_test.sql`), "SELECT 1;");
      }

      await expect(
        runMigrations({
          databaseUrl: isolatedUrl.toString(),
          migrationsDirectory: dir,
        }),
      ).rejects.toThrow(/tabelas obrigatórias ausentes no baseline/i);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falha-fechado (fail-closed) se o banco possui todas as tabelas mas faltam colunas essenciais", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runner-cols-"));
    const schema = `runner_cols_${Date.now()}`;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);

    try {
      for (const table of BASELINE_REQUIRED_TABLES) {
        await sql.unsafe(`CREATE TABLE "${schema}"."${table}" (id int);`);
      }

      for (let i = 1; i <= 8; i++) {
        const prefix = String(i).padStart(4, "0");
        await writeFile(path.join(dir, `${prefix}_test.sql`), "SELECT 1;");
      }

      await expect(
        runMigrations({
          databaseUrl: isolatedUrl.toString(),
          migrationsDirectory: dir,
        }),
      ).rejects.toThrow(/colunas obrigatórias ausentes no baseline 0001–0008:.*order_items\.snapshot_erp_code/i);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falha-fechado (fail-closed) se falta singleton obrigatório no baseline", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runner-single-"));
    const schema = `runner_single_${Date.now()}`;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);

    try {
      await provisionValidBaseline(sql, schema);
      // Remove o singleton FLV
      await sql.unsafe(`DELETE FROM "${schema}".pricing_settings WHERE id = 'FLV';`);

      for (let i = 1; i <= 8; i++) {
        const prefix = String(i).padStart(4, "0");
        await writeFile(path.join(dir, `${prefix}_test.sql`), "SELECT 1;");
      }

      await expect(
        runMigrations({
          databaseUrl: isolatedUrl.toString(),
          migrationsDirectory: dir,
        }),
      ).rejects.toThrow(/registro singleton obrigatório ausente em pricing_settings/i);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falha-fechado (fail-closed) se falta trigger/função de imutabilidade no baseline", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runner-trig-"));
    const schema = `runner_trig_${Date.now()}`;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);

    try {
      await provisionValidBaseline(sql, schema);
      await sql.unsafe(`DROP TRIGGER immutable_orders ON "${schema}".orders;`);

      for (let i = 1; i <= 8; i++) {
        const prefix = String(i).padStart(4, "0");
        await writeFile(path.join(dir, `${prefix}_test.sql`), "SELECT 1;");
      }

      await expect(
        runMigrations({
          databaseUrl: isolatedUrl.toString(),
          migrationsDirectory: dir,
        }),
      ).rejects.toThrow(/triggers obrigatórias ausentes no baseline 0001–0008:.*orders\.immutable_orders/i);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
