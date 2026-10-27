import { database } from "@/db/client";
import { BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE } from "../allocations/domain";
import {
  CycleClosedError,
  InvoiceValidationError,
  type InvoiceRecord,
} from "./domain";

export async function listInvoicesForCycleAndStore(
  cycleDate: string,
  storeId: string
): Promise<InvoiceRecord[]> {
  const { sql } = database();
  const rows = await sql`
    SELECT 
      i.id,
      i.purchase_cycle_date::text AS purchase_cycle_date,
      i.store_id,
      i.supplier_id,
      i.invoice_number,
      i.image_s3_key,
      i.content_type,
      i.file_size_bytes,
      i.notes,
      i.created_by,
      i.created_at::text AS created_at,
      i.updated_at::text AS updated_at,
      COALESCE(
        array_agg(it.product_id) FILTER (WHERE it.product_id IS NOT NULL),
        ARRAY[]::uuid[]
      ) AS item_product_ids
    FROM purchase_cycle_invoices i
    LEFT JOIN purchase_cycle_invoice_items it ON it.invoice_id = i.id
    WHERE i.purchase_cycle_date = ${cycleDate}::date
      AND i.store_id = ${storeId}::uuid
    GROUP BY i.id
    ORDER BY i.created_at DESC
  `;

  return rows.map((r) => ({
    id: r.id as string,
    purchaseCycleDate: r.purchase_cycle_date as string,
    storeId: r.store_id as string,
    supplierId: r.supplier_id as string,
    invoiceNumber: r.invoice_number as string,
    imageS3Key: r.image_s3_key as string,
    contentType: r.content_type as string,
    fileSizeBytes: Number(r.file_size_bytes),
    notes: r.notes as string | null,
    createdBy: r.created_by as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    itemProductIds: ((r.item_product_ids as string[]) || []).filter(Boolean),
  }));
}

export async function listInvoicesForCycle(
  cycleDate: string
): Promise<InvoiceRecord[]> {
  const { sql } = database();
  const rows = await sql`
    SELECT 
      i.id,
      i.purchase_cycle_date::text AS purchase_cycle_date,
      i.store_id,
      i.supplier_id,
      i.invoice_number,
      i.image_s3_key,
      i.content_type,
      i.file_size_bytes,
      i.notes,
      i.created_by,
      i.created_at::text AS created_at,
      i.updated_at::text AS updated_at,
      COALESCE(
        array_agg(it.product_id) FILTER (WHERE it.product_id IS NOT NULL),
        ARRAY[]::uuid[]
      ) AS item_product_ids
    FROM purchase_cycle_invoices i
    LEFT JOIN purchase_cycle_invoice_items it ON it.invoice_id = i.id
    WHERE i.purchase_cycle_date = ${cycleDate}::date
    GROUP BY i.id
    ORDER BY i.created_at DESC
  `;

  return rows.map((r) => ({
    id: r.id as string,
    purchaseCycleDate: r.purchase_cycle_date as string,
    storeId: r.store_id as string,
    supplierId: r.supplier_id as string,
    invoiceNumber: r.invoice_number as string,
    imageS3Key: r.image_s3_key as string,
    contentType: r.content_type as string,
    fileSizeBytes: Number(r.file_size_bytes),
    notes: r.notes as string | null,
    createdBy: r.created_by as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    itemProductIds: ((r.item_product_ids as string[]) || []).filter(Boolean),
  }));
}

export async function getInvoiceById(
  invoiceId: string
): Promise<InvoiceRecord | null> {
  const { sql } = database();
  const rows = await sql`
    SELECT 
      i.id,
      i.purchase_cycle_date::text AS purchase_cycle_date,
      i.store_id,
      i.supplier_id,
      i.invoice_number,
      i.image_s3_key,
      i.content_type,
      i.file_size_bytes,
      i.notes,
      i.created_by,
      i.created_at::text AS created_at,
      i.updated_at::text AS updated_at,
      COALESCE(
        array_agg(it.product_id) FILTER (WHERE it.product_id IS NOT NULL),
        ARRAY[]::uuid[]
      ) AS item_product_ids
    FROM purchase_cycle_invoices i
    LEFT JOIN purchase_cycle_invoice_items it ON it.invoice_id = i.id
    WHERE i.id = ${invoiceId}::uuid
    GROUP BY i.id
  `;

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id as string,
    purchaseCycleDate: r.purchase_cycle_date as string,
    storeId: r.store_id as string,
    supplierId: r.supplier_id as string,
    invoiceNumber: r.invoice_number as string,
    imageS3Key: r.image_s3_key as string,
    contentType: r.content_type as string,
    fileSizeBytes: Number(r.file_size_bytes),
    notes: r.notes as string | null,
    createdBy: r.created_by as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    itemProductIds: ((r.item_product_ids as string[]) || []).filter(Boolean),
  };
}

export async function createInvoiceRecord(data: {
  cycleDate: string;
  storeId: string;
  supplierId: string;
  invoiceNumber: string;
  imageS3Key: string;
  contentType: string;
  fileSizeBytes: number;
  notes?: string | null;
  createdBy?: string | null;
  productIds?: string[];
}): Promise<InvoiceRecord> {
  const { sql } = database();

  return await sql.begin(async (tx) => {
    // 1. Lock transacional serializado por ciclo para evitar concorrência com fechamento
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${data.cycleDate}::text))`;

    // 2. Valida se o ciclo geral de compras está fechado
    const [buyerClosure] = await tx<{ status: string }[]>`
      SELECT status
      FROM purchase_cycle_buyer_closures
      WHERE purchase_cycle_date = ${data.cycleDate}::date
    `;
    if (buyerClosure && buyerClosure.status === "CLOSED") {
      throw new CycleClosedError(
        "O ciclo de compras está fechado. Não é permitido registrar notas fiscais neste ciclo."
      );
    }

    // 3. Valida se a conferência desta loja está finalizada
    const [storeClosure] = await tx<{ status: string }[]>`
      SELECT status
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${data.cycleDate}::date
        AND store_id = ${data.storeId}::uuid
        AND is_current = true
    `;
    if (storeClosure && storeClosure.status === "CLOSED") {
      throw new CycleClosedError(
        "A conferência desta loja já foi finalizada neste ciclo. Reabra a conferência para realizar alterações."
      );
    }

    // 4. Busca os produtos efetivamente destinados (destined_quantity > 0) para esta loja e fornecedor
    const destinedRows = await tx<{ product_id: string; destined_quantity: string }[]>`
      SELECT product_id, destined_quantity::text
      FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${data.cycleDate}::date
        AND store_id = ${data.storeId}::uuid
        AND supplier_id = ${data.supplierId}::uuid
        AND destined_quantity > 0
    `;

    if (destinedRows.length === 0) {
      throw new InvoiceValidationError(
        "Não é possível vincular nota fiscal: não há produtos com destinação positiva para esta loja e fornecedor neste ciclo."
      );
    }

    const destinedProductSet = new Set(destinedRows.map((r) => r.product_id));

    // Determina quais produtos serão vinculados
    let targetProductIds: string[];
    if (data.productIds && data.productIds.length > 0) {
      // Valida estritamente se todos os produtos enviados pertencem às destinações válidas
      for (const pid of data.productIds) {
        if (!destinedProductSet.has(pid)) {
          throw new InvoiceValidationError(
            "Um ou mais produtos selecionados não possuem destinação positiva para esta loja e fornecedor."
          );
        }
      }
      targetProductIds = data.productIds;
    } else {
      // Se não especificado explicitamente, vincula a todos os produtos destinados da combinação
      targetProductIds = Array.from(destinedProductSet);
    }

    // 5. Insere a nota fiscal
    const inserted = await tx`
      INSERT INTO purchase_cycle_invoices (
        purchase_cycle_date,
        store_id,
        supplier_id,
        invoice_number,
        image_s3_key,
        content_type,
        file_size_bytes,
        notes,
        created_by,
        updated_by
      ) VALUES (
        ${data.cycleDate}::date,
        ${data.storeId}::uuid,
        ${data.supplierId}::uuid,
        ${data.invoiceNumber},
        ${data.imageS3Key},
        ${data.contentType},
        ${data.fileSizeBytes},
        ${data.notes ?? null},
        ${data.createdBy ?? null}::uuid,
        ${data.createdBy ?? null}::uuid
      )
      RETURNING 
        id,
        purchase_cycle_date::text AS purchase_cycle_date,
        store_id,
        supplier_id,
        invoice_number,
        image_s3_key,
        content_type,
        file_size_bytes,
        notes,
        created_by,
        created_at::text AS created_at,
        updated_at::text AS updated_at
    `;

    const invoiceRow = inserted[0];
    const invoiceId = invoiceRow.id as string;

    // 6. Insere os vínculos de produtos na tabela purchase_cycle_invoice_items
    for (const prodId of targetProductIds) {
      await tx`
        INSERT INTO purchase_cycle_invoice_items (invoice_id, product_id)
        VALUES (${invoiceId}::uuid, ${prodId}::uuid)
        ON CONFLICT DO NOTHING
      `;
    }

    // 7. Grava a auditoria atomicamente na mesma transação
    await tx`
      INSERT INTO audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
      ) VALUES (
        ${data.createdBy ?? null}::uuid,
        'INVOICE_REGISTERED',
        'purchase_cycle_invoice',
        ${invoiceId},
        ${JSON.stringify({
          cycleDate: data.cycleDate,
          storeId: data.storeId,
          supplierId: data.supplierId,
          invoiceNumber: data.invoiceNumber,
          fileSizeBytes: data.fileSizeBytes,
          productIds: targetProductIds,
        })}::jsonb
      )
    `;

    return {
      id: invoiceId,
      purchaseCycleDate: invoiceRow.purchase_cycle_date as string,
      storeId: invoiceRow.store_id as string,
      supplierId: invoiceRow.supplier_id as string,
      invoiceNumber: invoiceRow.invoice_number as string,
      imageS3Key: invoiceRow.image_s3_key as string,
      contentType: invoiceRow.content_type as string,
      fileSizeBytes: Number(invoiceRow.file_size_bytes),
      notes: invoiceRow.notes as string | null,
      createdBy: invoiceRow.created_by as string | null,
      createdAt: invoiceRow.created_at as string,
      updatedAt: invoiceRow.updated_at as string,
      itemProductIds: targetProductIds,
    };
  });
}

export async function deleteInvoiceRecord(
  invoiceId: string,
  actorId: string | null
): Promise<{ id: string; imageS3Key: string } | null> {
  const { sql } = database();

  return await sql.begin(async (tx) => {
    // 1. Busca os dados da nota
    const existingRows = await tx<{
      id: string;
      purchase_cycle_date: string;
      store_id: string;
      supplier_id: string;
      invoice_number: string;
      image_s3_key: string;
    }[]>`
      SELECT
        id,
        purchase_cycle_date::text AS purchase_cycle_date,
        store_id,
        supplier_id,
        invoice_number,
        image_s3_key
      FROM purchase_cycle_invoices
      WHERE id = ${invoiceId}::uuid
      FOR UPDATE
    `;

    if (existingRows.length === 0) return null;
    const existing = existingRows[0];

    // 2. Lock transacional no ciclo
    await tx`SELECT pg_advisory_xact_lock(${BUYER_CYCLE_ADVISORY_LOCK_NAMESPACE}, hashtext(${existing.purchase_cycle_date}::text))`;

    // 3. Valida se o ciclo geral está fechado
    const [buyerClosure] = await tx<{ status: string }[]>`
      SELECT status
      FROM purchase_cycle_buyer_closures
      WHERE purchase_cycle_date = ${existing.purchase_cycle_date}::date
    `;
    if (buyerClosure && buyerClosure.status === "CLOSED") {
      throw new CycleClosedError(
        "O ciclo de compras está fechado. Não é permitido excluir notas fiscais deste ciclo."
      );
    }

    // 4. Valida se a conferência da loja está fechada
    const [storeClosure] = await tx<{ status: string }[]>`
      SELECT status
      FROM purchase_cycle_store_closures
      WHERE purchase_cycle_date = ${existing.purchase_cycle_date}::date
        AND store_id = ${existing.store_id}::uuid
        AND is_current = true
    `;
    if (storeClosure && storeClosure.status === "CLOSED") {
      throw new CycleClosedError(
        "A conferência desta loja já foi finalizada neste ciclo. Reabra a conferência para realizar alterações."
      );
    }

    // 5. Exclui a nota (os itens em purchase_cycle_invoice_items são removidos em cascata pela FK)
    await tx`
      DELETE FROM purchase_cycle_invoices
      WHERE id = ${invoiceId}::uuid
    `;

    // 6. Grava a auditoria atomicamente na mesma transação
    await tx`
      INSERT INTO audit_events (
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata
      ) VALUES (
        ${actorId ?? null}::uuid,
        'INVOICE_DELETED',
        'purchase_cycle_invoice',
        ${invoiceId},
        ${JSON.stringify({
          cycleDate: existing.purchase_cycle_date,
          storeId: existing.store_id,
          supplierId: existing.supplier_id,
          invoiceNumber: existing.invoice_number,
          imageS3Key: existing.image_s3_key,
        })}::jsonb
      )
    `;

    return {
      id: existing.id,
      imageS3Key: existing.image_s3_key,
    };
  });
}
