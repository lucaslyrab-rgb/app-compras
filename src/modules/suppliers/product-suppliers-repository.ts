import type postgres from "postgres";
import { database } from "@/db/client";
import {
  type LinkSupplierInput,
  type ProductSupplierLink,
  type SetPrimarySupplierInput,
  type SupplierProductLink,
  type ToggleExclusivityInput,
  type UnlinkSupplierInput,
  ProductSupplierConflictError,
  ProductSupplierNotFoundError,
  ProductSupplierValidationError,
} from "./product-suppliers-domain";

type SqlClient = postgres.Sql | postgres.TransactionSql;

type RawProductSupplierRow = {
  id: string;
  productId: string;
  supplierId: string;
  isPrimary: boolean;
  isExclusive: boolean;
  active: boolean;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  corporateName: string;
  tradeName: string | null;
  taxId: string | null;
  taxIdType: string;
  taxInvoiceRule: string;
  supplierActive: boolean;
};

type RawSupplierProductRow = {
  id: string;
  productId: string;
  supplierId: string;
  isPrimary: boolean;
  isExclusive: boolean;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  erpCode: number;
  productName: string;
  unit: string;
  purchaseFormat: string;
  productActive: boolean;
};

export async function listSuppliersByProduct(
  productId: string,
  db: SqlClient = database().sql
): Promise<ProductSupplierLink[]> {
  const rows = await db<RawProductSupplierRow[]>`
    SELECT
      ps.id,
      ps.product_id AS "productId",
      ps.supplier_id AS "supplierId",
      ps.is_primary AS "isPrimary",
      ps.is_exclusive AS "isExclusive",
      ps.active,
      ps.notes,
      ps.created_by AS "createdBy",
      ps.updated_by AS "updatedBy",
      ps.created_at AS "createdAt",
      ps.updated_at AS "updatedAt",
      s.corporate_name AS "corporateName",
      s.trade_name AS "tradeName",
      s.tax_id AS "taxId",
      s.tax_id_type AS "taxIdType",
      s.tax_invoice_rule AS "taxInvoiceRule",
      s.active AS "supplierActive"
    FROM product_suppliers ps
    JOIN suppliers s ON s.id = ps.supplier_id
    WHERE ps.product_id = ${productId}::uuid
    ORDER BY ps.is_exclusive DESC, ps.is_primary DESC, s.corporate_name ASC
  `;

  return rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  }));
}

export async function listProductsBySupplier(
  supplierId: string,
  db: SqlClient = database().sql
): Promise<SupplierProductLink[]> {
  const rows = await db<RawSupplierProductRow[]>`
    SELECT
      ps.id,
      ps.product_id AS "productId",
      ps.supplier_id AS "supplierId",
      ps.is_primary AS "isPrimary",
      ps.is_exclusive AS "isExclusive",
      ps.active,
      ps.notes,
      ps.created_at AS "createdAt",
      ps.updated_at AS "updatedAt",
      p.erp_code AS "erpCode",
      p.name AS "productName",
      p.unit,
      p.purchase_format AS "purchaseFormat",
      p.active AS "productActive"
    FROM product_suppliers ps
    JOIN products p ON p.id = ps.product_id
    WHERE ps.supplier_id = ${supplierId}::uuid
    ORDER BY ps.is_exclusive DESC, ps.is_primary DESC, p.erp_code ASC
  `;

  return rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  }));
}

export async function linkSupplierToProduct(
  input: LinkSupplierInput & { actorId: string }
): Promise<ProductSupplierLink> {
  const sql = database().sql;

  return await sql.begin(async (tx) => {
    // Lock consultivo atômico para o produto
    await tx`SELECT pg_advisory_xact_lock(hashtext('product_suppliers:' || ${input.productId}))`;

    // 1. Valida existência do produto
    const [product] = await tx<{ id: string }[]>`
      SELECT id FROM products WHERE id = ${input.productId}::uuid
    `;
    if (!product) {
      throw new ProductSupplierNotFoundError("Produto não encontrado.");
    }

    // 2. Valida existência e status ativo do fornecedor
    const [supplier] = await tx<{ id: string; active: boolean; corporateName: string }[]>`
      SELECT id, active, corporate_name AS "corporateName"
      FROM suppliers
      WHERE id = ${input.supplierId}::uuid
    `;
    if (!supplier) {
      throw new ProductSupplierNotFoundError("Fornecedor não encontrado.");
    }
    if (!supplier.active) {
      throw new ProductSupplierValidationError(
        `O fornecedor '${supplier.corporateName}' está inativo e não pode ser vinculado a produtos.`
      );
    }

    // 3. Verifica se vínculo já existe
    const [existingLink] = await tx<{ id: string }[]>`
      SELECT id FROM product_suppliers
      WHERE product_id = ${input.productId}::uuid AND supplier_id = ${input.supplierId}::uuid
    `;
    if (existingLink) {
      throw new ProductSupplierConflictError("Este fornecedor já está vinculado a este produto.");
    }

    const isExclusive = Boolean(input.isExclusive);
    // Exclusividade exige que o fornecedor seja o principal
    const isPrimary = isExclusive || Boolean(input.isPrimary);

    // 4. Se for principal ou exclusivo, desmarca qualquer outro principal/exclusivo anterior
    if (isPrimary) {
      await tx`
        UPDATE product_suppliers
        SET is_primary = false, is_exclusive = false, updated_at = now()
        WHERE product_id = ${input.productId}::uuid AND (is_primary = true OR is_exclusive = true)
      `;
    }

    // 5. Insere o novo vínculo
    const [inserted] = await tx<{ id: string }[]>`
      INSERT INTO product_suppliers (
        product_id,
        supplier_id,
        is_primary,
        is_exclusive,
        active,
        notes,
        created_by,
        updated_by
      ) VALUES (
        ${input.productId}::uuid,
        ${input.supplierId}::uuid,
        ${isPrimary},
        ${isExclusive},
        true,
        ${input.notes ?? null},
        ${input.actorId}::uuid,
        ${input.actorId}::uuid
      )
      RETURNING id
    `;

    // 6. Sincroniza o campo legado products.exclusive_supplier
    await tx`
      UPDATE products
      SET exclusive_supplier = ${isExclusive}, updated_at = now()
      WHERE id = ${input.productId}::uuid
    `;

    // 7. Retorna o registro completo
    const [result] = await listSuppliersByProduct(input.productId, tx);
    const link = (await listSuppliersByProduct(input.productId, tx)).find((l) => l.id === inserted.id);
    return link ?? result;
  });
}

export async function unlinkSupplierFromProduct(
  input: UnlinkSupplierInput & { actorId: string }
): Promise<void> {
  const sql = database().sql;

  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('product_suppliers:' || ${input.productId}))`;

    const [existing] = await tx<{ id: string; isExclusive: boolean }[]>`
      SELECT id, is_exclusive AS "isExclusive"
      FROM product_suppliers
      WHERE product_id = ${input.productId}::uuid AND supplier_id = ${input.supplierId}::uuid
    `;

    if (!existing) {
      throw new ProductSupplierNotFoundError("Vínculo entre o produto e fornecedor não encontrado.");
    }

    await tx`
      DELETE FROM product_suppliers
      WHERE product_id = ${input.productId}::uuid AND supplier_id = ${input.supplierId}::uuid
    `;

    // Se o fornecedor desvinculado era exclusivo, garante products.exclusive_supplier = false
    if (existing.isExclusive) {
      await tx`
        UPDATE products
        SET exclusive_supplier = false, updated_at = now()
        WHERE id = ${input.productId}::uuid
      `;
    }
  });
}

export async function setPrimarySupplier(
  input: SetPrimarySupplierInput & { actorId: string }
): Promise<ProductSupplierLink> {
  const sql = database().sql;

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('product_suppliers:' || ${input.productId}))`;

    const [existing] = await tx<{ id: string; active: boolean; supplierActive: boolean }[]>`
      SELECT ps.id, ps.active, s.active AS "supplierActive"
      FROM product_suppliers ps
      JOIN suppliers s ON s.id = ps.supplier_id
      WHERE ps.product_id = ${input.productId}::uuid AND ps.supplier_id = ${input.supplierId}::uuid
    `;

    if (!existing) {
      throw new ProductSupplierNotFoundError("Fornecedor não está vinculado a este produto.");
    }
    if (!existing.supplierActive) {
      throw new ProductSupplierValidationError("Não é possível definir um fornecedor inativo como principal.");
    }

    const isExclusive = Boolean(input.isExclusive);

    // Desmarca outros principais/exclusivos
    await tx`
      UPDATE product_suppliers
      SET is_primary = false, is_exclusive = false, updated_at = now()
      WHERE product_id = ${input.productId}::uuid
    `;

    // Marca o alvo como principal
    await tx`
      UPDATE product_suppliers
      SET is_primary = true, is_exclusive = ${isExclusive}, updated_by = ${input.actorId}::uuid, updated_at = now()
      WHERE product_id = ${input.productId}::uuid AND supplier_id = ${input.supplierId}::uuid
    `;

    // Sincroniza products.exclusive_supplier
    await tx`
      UPDATE products
      SET exclusive_supplier = ${isExclusive}, updated_at = now()
      WHERE id = ${input.productId}::uuid
    `;

    const link = (await listSuppliersByProduct(input.productId, tx)).find(
      (l) => l.supplierId === input.supplierId
    );
    if (!link) throw new ProductSupplierNotFoundError("Erro ao recuperar vínculo atualizado.");
    return link;
  });
}

export async function toggleExclusivity(
  input: ToggleExclusivityInput & { actorId: string }
): Promise<ProductSupplierLink> {
  const sql = database().sql;

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('product_suppliers:' || ${input.productId}))`;

    const [existing] = await tx<{ id: string; isPrimary: boolean; supplierActive: boolean }[]>`
      SELECT ps.id, ps.is_primary AS "isPrimary", s.active AS "supplierActive"
      FROM product_suppliers ps
      JOIN suppliers s ON s.id = ps.supplier_id
      WHERE ps.product_id = ${input.productId}::uuid AND ps.supplier_id = ${input.supplierId}::uuid
    `;

    if (!existing) {
      throw new ProductSupplierNotFoundError("Fornecedor não está vinculado a este produto.");
    }

    if (input.isExclusive) {
      if (!existing.supplierActive) {
        throw new ProductSupplierValidationError("Não é possível tornar exclusivo um fornecedor inativo.");
      }

      // Torna exclusivo (e consequentemente principal), limpando qualquer outro
      await tx`
        UPDATE product_suppliers
        SET is_primary = false, is_exclusive = false, updated_at = now()
        WHERE product_id = ${input.productId}::uuid
      `;

      await tx`
        UPDATE product_suppliers
        SET is_primary = true, is_exclusive = true, updated_by = ${input.actorId}::uuid, updated_at = now()
        WHERE product_id = ${input.productId}::uuid AND supplier_id = ${input.supplierId}::uuid
      `;

      await tx`
        UPDATE products
        SET exclusive_supplier = true, updated_at = now()
        WHERE id = ${input.productId}::uuid
      `;
    } else {
      // Remove apenas exclusividade, mantendo como principal
      await tx`
        UPDATE product_suppliers
        SET is_exclusive = false, updated_by = ${input.actorId}::uuid, updated_at = now()
        WHERE product_id = ${input.productId}::uuid AND supplier_id = ${input.supplierId}::uuid
      `;

      await tx`
        UPDATE products
        SET exclusive_supplier = false, updated_at = now()
        WHERE id = ${input.productId}::uuid
      `;
    }

    const link = (await listSuppliersByProduct(input.productId, tx)).find(
      (l) => l.supplierId === input.supplierId
    );
    if (!link) throw new ProductSupplierNotFoundError("Erro ao recuperar vínculo atualizado.");
    return link;
  });
}
