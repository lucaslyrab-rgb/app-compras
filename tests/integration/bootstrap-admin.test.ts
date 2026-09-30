import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { bootstrapAdmin } from "../../scripts/bootstrap-admin";
import { runMigrations } from "../../scripts/migration-runner.mjs";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Bootstrap Administrativo baseado em permissões", () => {
  const stamp = Date.now();
  const testSchema = `test_bootstrap_${stamp}`;

  afterAll(async () => {
    if (process.env.DATABASE_URL) {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await sql.end();
    }
  });

  async function setupCleanSchema() {
    const rootSql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await rootSql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`);
    await rootSql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${testSchema},public`);

    await runMigrations({
      databaseUrl: isolatedUrl.toString(),
      migrationsDirectory: path.resolve("migrations"),
    });

    return isolatedUrl.toString();
  }

  it("Cenário 1: COMPRADOR com permissão gestor:usuarios conta como admin e recusa bootstrap", async () => {
    const dbUrl = await setupCleanSchema();
    const sql = postgres(dbUrl, { max: 1 });
    try {
      await sql`
        INSERT INTO users (email, name, password_hash, role, active, permissions)
        VALUES ('buyer-admin@example.com', 'Comprador Admin', 'dummy-hash', 'COMPRADOR', true, ARRAY['compras:consolidado', 'gestor:usuarios']::text[])
      `;

      await expect(
        bootstrapAdmin(dbUrl, "gestor.novo@example.com", "senha-super-segura-1234")
      ).rejects.toThrow("Já existe administrador ativo com permissão gestor:usuarios; bootstrap recusado");
    } finally {
      await sql`DELETE FROM users`;
      await sql.end();
    }
  });

  it("Cenário 2: GESTOR sem permissão gestor:usuarios NÃO conta como admin e permite bootstrap", async () => {
    const dbUrl = await setupCleanSchema();
    const sql = postgres(dbUrl, { max: 1 });
    try {
      await sql`
        INSERT INTO users (email, name, password_hash, role, active, permissions)
        VALUES ('gestor-sem-usuarios@example.com', 'Gestor Produtos', 'dummy-hash', 'GESTOR', true, ARRAY['gestor:produtos', 'gestor:precificacao']::text[])
      `;

      await expect(
        bootstrapAdmin(dbUrl, "gestor.inicial@example.com", "senha-super-segura-1234")
      ).resolves.not.toThrow();

      const [created] = await sql<{ email: string; permissions: string[] }[]>`
        SELECT email, permissions FROM users WHERE email = 'gestor.inicial@example.com'
      `;
      expect(created).toBeDefined();
      expect(created.permissions).toContain("gestor:usuarios");
    } finally {
      await sql`DELETE FROM users`;
      await sql.end();
    }
  });

  it("Cenário 3: GESTOR com permissão gestor:usuarios conta como admin e recusa bootstrap", async () => {
    const dbUrl = await setupCleanSchema();
    const sql = postgres(dbUrl, { max: 1 });
    try {
      await sql`
        INSERT INTO users (email, name, password_hash, role, active, permissions)
        VALUES ('gestor-master@example.com', 'Gestor Master', 'dummy-hash', 'GESTOR', true, ARRAY['gestor:usuarios']::text[])
      `;

      await expect(
        bootstrapAdmin(dbUrl, "gestor.segundo@example.com", "senha-super-segura-1234")
      ).rejects.toThrow("Já existe administrador ativo com permissão gestor:usuarios; bootstrap recusado");
    } finally {
      await sql`DELETE FROM users`;
      await sql.end();
    }
  });

  it("Cenário 4: Usuário inativo com gestor:usuarios NÃO impede bootstrap para garantir admin ativo", async () => {
    const dbUrl = await setupCleanSchema();
    const sql = postgres(dbUrl, { max: 1 });
    try {
      await sql`
        INSERT INTO users (email, name, password_hash, role, active, permissions)
        VALUES ('gestor-inativo@example.com', 'Gestor Inativo', 'dummy-hash', 'GESTOR', false, ARRAY['gestor:usuarios']::text[])
      `;

      await expect(
        bootstrapAdmin(dbUrl, "gestor.reativado@example.com", "senha-super-segura-1234")
      ).resolves.not.toThrow();

      const [created] = await sql<{ email: string; active: boolean }[]>`
        SELECT email, active FROM users WHERE email = 'gestor.reativado@example.com'
      `;
      expect(created).toBeDefined();
      expect(created.active).toBe(true);
    } finally {
      await sql`DELETE FROM users`;
      await sql.end();
    }
  });
});
