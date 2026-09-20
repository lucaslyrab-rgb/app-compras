import "dotenv/config";
import postgres from "postgres";
import { hashPassword } from "../src/modules/identity/domain";

const url = process.env.DATABASE_URL;
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
if (!url || !email || !password) throw new Error("DATABASE_URL, E2E_EMAIL e E2E_PASSWORD obrigatórios");
const sql = postgres(url, { max: 1 });
try {
  const [{ id: storeId }] = await sql<[{ id: string }]>`SELECT id FROM stores WHERE slug = 'ponta-da-fruta'`;
  const passwordHash = await hashPassword(password);
  await sql`INSERT INTO users (email, name, password_hash, role, store_id) VALUES (${email.toLowerCase()}, 'Loja E2E', ${passwordHash}, 'LOJA', ${storeId}) ON CONFLICT ((lower(email))) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`;
} finally { await sql.end(); }
