import { database } from "@/db/client";
import type { InvoiceRecord } from "./domain";

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

    const productIds = (data.productIds || []).filter(Boolean);
    if (productIds.length > 0) {
      for (const prodId of productIds) {
        await tx`
          INSERT INTO purchase_cycle_invoice_items (invoice_id, product_id)
          VALUES (${invoiceId}::uuid, ${prodId}::uuid)
          ON CONFLICT DO NOTHING
        `;
      }
    }

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
      itemProductIds: productIds,
    };
  });
}

export async function deleteInvoiceRecord(
  invoiceId: string
): Promise<{ id: string; imageS3Key: string } | null> {
  const { sql } = database();
  const deleted = await sql`
    DELETE FROM purchase_cycle_invoices
    WHERE id = ${invoiceId}::uuid
    RETURNING id, image_s3_key
  `;
  if (deleted.length === 0) return null;
  return {
    id: deleted[0].id as string,
    imageS3Key: deleted[0].image_s3_key as string,
  };
}
