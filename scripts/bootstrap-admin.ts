import "dotenv/config";
import postgres from "postgres";
import { hashPassword } from "../src/modules/identity/domain";

const url = process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
export async function bootstrapAdmin(databaseUrl: string, adminEmail: string, adminPassword: string) {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [{ count }] = await sql<[{ count: number }]>`SELECT count(*)::int AS count FROM users WHERE role = 'GESTOR' AND active`;
    if (count > 0) throw new Error("Já existe Gestor ativo; bootstrap recusado");
    const passwordHash = await hashPassword(adminPassword);
    await sql`INSERT INTO users (email, name, password_hash, role) VALUES (${adminEmail.trim().toLowerCase()}, 'Gestor inicial', ${passwordHash}, 'GESTOR')`;
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!url || !email || !password) throw new Error("DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD são obrigatórios");
  await bootstrapAdmin(url, email, password);
  console.log("Gestor inicial criado; remova o secret de bootstrap.");
}
