/**
 * Prepara o banco do ambiente local (docs/desenvolvimento-local.md):
 * migrations, base de produtos e um usuário de teste por papel/loja.
 *
 *   npm run dev:setup
 *
 * Só roda com DATABASE_URL apontando para localhost. Pode ser repetido: não
 * duplica nada e redefine as senhas dos usuários de teste para DEV_PASSWORD.
 */
import "dotenv/config";
import postgres from "postgres";
import { assertLocalDatabaseUrl } from "../src/lib/dev-safety";
import { hashPassword, ROLE_DEFAULT_PERMISSIONS } from "../src/modules/identity/domain";
import { importProducts } from "./import-products";
import { runMigrations } from "./migration-runner.mjs";

const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL).toString();
const password = process.env.DEV_PASSWORD ?? "";
if (password.length < 8) throw new Error("Defina DEV_PASSWORD no .env (mínimo 8 caracteres).");

await runMigrations({ databaseUrl, onApplied: (file) => console.log(`Migration ${file} aplicada.`) });
await importProducts("base_produtos_atual.xlsx");

const sql = postgres(databaseUrl, { max: 1 });
try {
  const passwordHash = await hashPassword(password);
  const stores = await sql<{ id: string; slug: string; name: string }[]>`
    SELECT id, slug, name FROM stores WHERE active ORDER BY name
  `;
  const users = [
    { email: "gestor@local.test", name: "Gestor (local)", role: "GESTOR" as const, storeId: null as string | null },
    { email: "comprador@local.test", name: "Comprador (local)", role: "COMPRADOR" as const, storeId: null as string | null },
    ...stores.map((store) => ({
      email: `loja-${store.slug}@local.test`,
      name: `${store.name} (local)`,
      role: "LOJA" as const,
      storeId: store.id as string | null,
    })),
  ];
  for (const user of users) {
    const permissions = [...ROLE_DEFAULT_PERMISSIONS[user.role]];
    await sql`
      INSERT INTO users (email, name, password_hash, role, store_id, permissions, active)
      VALUES (${user.email}, ${user.name}, ${passwordHash}, ${user.role}, ${user.storeId}, ${permissions}::text[], true)
      ON CONFLICT ((lower(email))) DO UPDATE
        SET password_hash = EXCLUDED.password_hash, active = true
    `;
  }
  console.log("\nAmbiente local pronto. Logins (senha = DEV_PASSWORD do .env):");
  for (const user of users) console.log(`  ${user.email.padEnd(36)} ${user.role}`);
} finally {
  await sql.end();
}
