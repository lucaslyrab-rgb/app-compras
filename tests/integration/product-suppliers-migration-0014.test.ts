import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  runMigrations,
} from "../../scripts/migration-runner.mjs";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Migration 0014: product_suppliers, constraints, unicidade e exclusividade", () => {
  const stamp = Date.now();
  const schemaA = `test_ps_a_${stamp}`;
  const schemaB = `test_ps_b_${stamp}`;

  afterAll(async () => {
    if (process.env.DATABASE_URL) {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaA}" CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaB}" CASCADE`);
      await sql.end();
    }
  });

  it("Cenário A: executa migrations 0001 -> 0014 e valida estrutura de product_suppliers", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaA}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaA},public`);

    const result = await runMigrations({
      databaseUrl: isolatedUrl.toString(),
      migrationsDirectory: path.resolve("migrations"),
    });

    expect(result.length).toBeGreaterThanOrEqual(14);
    expect(result).toContain("0014_product_suppliers.sql");

    const client = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // 1. Valida presença e tipos de colunas em product_suppliers
      const columns = await client<{ column_name: string; data_type: string; is_nullable: string }[]>`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${schemaA} AND table_name = 'product_suppliers'
        ORDER BY ordinal_position
      `;
      const colMap = new Map(columns.map((c) => [c.column_name, c]));

      expect(colMap.has("id")).toBe(true);
      expect(colMap.get("id")?.data_type).toBe("uuid");

      expect(colMap.has("product_id")).toBe(true);
      expect(colMap.get("product_id")?.data_type).toBe("uuid");

      expect(colMap.has("supplier_id")).toBe(true);
      expect(colMap.get("supplier_id")?.data_type).toBe("uuid");

      expect(colMap.has("is_primary")).toBe(true);
      expect(colMap.get("is_primary")?.data_type).toBe("boolean");

      expect(colMap.has("is_exclusive")).toBe(true);
      expect(colMap.get("is_exclusive")?.data_type).toBe("boolean");

      expect(colMap.has("active")).toBe(true);
      expect(colMap.get("active")?.data_type).toBe("boolean");

      expect(colMap.has("notes")).toBe(true);
      expect(colMap.get("notes")?.data_type).toBe("text");

      expect(colMap.has("created_by")).toBe(true);
      expect(colMap.has("updated_by")).toBe(true);
      expect(colMap.has("created_at")).toBe(true);
      expect(colMap.has("updated_at")).toBe(true);

      // 2. Valida compatibilidade retroativa: products.exclusive_supplier ainda existe
      const productCols = await client<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ${schemaA} AND table_name = 'products' AND column_name = 'exclusive_supplier'
      `;
      expect(productCols.length).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("Cenário B: valida integridade, índices parciais e regras de exclusividade", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaB}"`);
    await sql.end();

    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schemaB},public`);

    await runMigrations({
      databaseUrl: isolatedUrl.toString(),
      migrationsDirectory: path.resolve("migrations"),
    });

    const client = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      // Cria 1 produto de teste
      const [product] = await client<{ id: string }[]>`
        INSERT INTO products (erp_code, name, unit, purchase_format, markup, active)
        VALUES (99001, 'TOMATE DE TESTE MIGRATION 0014', 'KG', 'CX', 30.00, true)
        RETURNING id
      `;

      // Cria 2 fornecedores de teste
      const [supplier1] = await client<{ id: string }[]>`
        INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
        VALUES ('FORNECEDOR 1 TESTE LTDA', 'F1', '11111111000191', 'CNPJ', 'STANDARD', true)
        RETURNING id
      `;

      const [supplier2] = await client<{ id: string }[]>`
        INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
        VALUES ('FORNECEDOR 2 TESTE LTDA', 'F2', '22222222000191', 'CNPJ', 'STANDARD', true)
        RETURNING id
      `;

      // 1. Vincula supplier1 como principal e exclusivo -> deve ter sucesso
      await client`
        INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive)
        VALUES (${product.id}, ${supplier1.id}, true, true)
      `;

      // 2. Tentar vincular novamente supplier1 ao mesmo produto -> viola unicidade (product_id, supplier_id)
      await expect(
        client`
          INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive)
          VALUES (${product.id}, ${supplier1.id}, false, false)
        `
      ).rejects.toThrow(/product_suppliers_product_supplier_unique|duplicate key/i);

      // 3. Tentar vincular supplier2 como outro principal -> viola product_suppliers_single_primary_idx
      await expect(
        client`
          INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive)
          VALUES (${product.id}, ${supplier2.id}, true, false)
        `
      ).rejects.toThrow(/product_suppliers_single_primary_idx|duplicate key/i);

      // 4. Tentar vincular supplier2 com is_exclusive = true mas is_primary = false -> viola CHECK constraint
      await expect(
        client`
          INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive)
          VALUES (${product.id}, ${supplier2.id}, false, true)
        `
      ).rejects.toThrow(/product_suppliers_exclusive_must_be_primary_check|violates check constraint/i);

      // 5. Vincular supplier2 como alternativo (is_primary = false, is_exclusive = false) -> deve ter sucesso
      await client`
        INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive)
        VALUES (${product.id}, ${supplier2.id}, false, false)
      `;

      // 6. Tentar remover supplier1 -> deve falhar devido a ON DELETE RESTRICT
      await expect(
        client`
          DELETE FROM suppliers WHERE id = ${supplier1.id}
        `
      ).rejects.toThrow(/foreign key constraint/i);

      // 7. Tentar remover o produto -> deve falhar devido a ON DELETE RESTRICT
      await expect(
        client`
          DELETE FROM products WHERE id = ${product.id}
        `
      ).rejects.toThrow(/foreign key constraint/i);

    } finally {
      await client.end();
    }
  });
});
