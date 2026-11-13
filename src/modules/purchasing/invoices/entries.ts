/**
 * Notas no Fechamento integrado (v1.3): "entrada dada" e número informado sem foto.
 *
 * A nota é identificada por ciclo × loja × fornecedor × número, a mesma chave
 * única de purchase_cycle_invoices. Assim, quando o comprador anexa na Destinação
 * a foto de um número já informado no Fechamento, as duas viram uma só, e a
 * marcação de entrada continua valendo. Toda alteração grava auditoria.
 */
import type postgres from "postgres";
import { database } from "@/db/client";
import { validateInvoiceNumber } from "./domain";

export class InvoiceEntryError extends Error {
  override name = "InvoiceEntryError";
}

export type InvoiceKey = {
  cycleDate: string;
  storeId: string;
  supplierId: string;
  invoiceNumber: string;
};

export type InformedInvoiceNumber = { storeId: string; supplierId: string; invoiceNumber: string };

async function audit(
  tx: postgres.TransactionSql,
  actorId: string,
  action: string,
  entityId: string | null,
  key: InvoiceKey,
  extra: Record<string, unknown> = {},
) {
  await tx`
    INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
    VALUES (${actorId}::uuid, ${action}, 'purchase_cycle_invoice_entry', ${entityId},
      ${JSON.stringify({ ...key, ...extra })}::jsonb)
  `;
}

/** Marca ou desmarca "entrada dada" de uma nota (com foto ou só com número informado). */
export async function setInvoiceEntryConfirmed(
  params: InvoiceKey & { confirmed: boolean; actorId: string },
): Promise<{ confirmedAt: string | null }> {
  const invoiceNumber = validateInvoiceNumber(params.invoiceNumber);
  const key: InvoiceKey = { ...params, invoiceNumber };
  const { sql } = database();
  return sql.begin(async (tx) => {
    const [known] = await tx<{ found: number }[]>`
      SELECT 1 AS found FROM purchase_cycle_invoices
      WHERE purchase_cycle_date = ${key.cycleDate}::date AND store_id = ${key.storeId}::uuid
        AND supplier_id = ${key.supplierId}::uuid AND invoice_number = ${invoiceNumber}
      UNION ALL
      SELECT 1 FROM purchase_cycle_invoice_entries
      WHERE purchase_cycle_date = ${key.cycleDate}::date AND store_id = ${key.storeId}::uuid
        AND supplier_id = ${key.supplierId}::uuid AND invoice_number = ${invoiceNumber}
        AND informed_at IS NOT NULL
      LIMIT 1
    `;
    if (!known) throw new InvoiceEntryError("Nota não encontrada para esta loja e fornecedor neste ciclo.");

    const [row] = await tx<{ id: string; entry_confirmed_at: string | null; informed_at: string | null }[]>`
      INSERT INTO purchase_cycle_invoice_entries
        (purchase_cycle_date, store_id, supplier_id, invoice_number, entry_confirmed_at, entry_confirmed_by)
      VALUES (${key.cycleDate}::date, ${key.storeId}::uuid, ${key.supplierId}::uuid, ${invoiceNumber},
        CASE WHEN ${params.confirmed} THEN now() ELSE NULL END,
        ${params.confirmed ? params.actorId : null}::uuid)
      ON CONFLICT (purchase_cycle_date, store_id, supplier_id, invoice_number) DO UPDATE
        SET entry_confirmed_at = EXCLUDED.entry_confirmed_at,
            entry_confirmed_by = EXCLUDED.entry_confirmed_by,
            updated_at = now()
      RETURNING id, entry_confirmed_at::text AS entry_confirmed_at, informed_at::text AS informed_at
    `;
    await audit(tx, params.actorId, params.confirmed ? "INVOICE_ENTRY_CONFIRMED" : "INVOICE_ENTRY_UNCONFIRMED", row.id, key);

    // Sem marcação e sem número informado, o registro não guarda mais nada.
    if (!params.confirmed && !row.informed_at) {
      await tx`DELETE FROM purchase_cycle_invoice_entries WHERE id = ${row.id}::uuid`;
    }
    return { confirmedAt: row.entry_confirmed_at };
  });
}

/** Gestor/CPD informa o número de uma nota que ficou sem registro na Destinação (sem foto). */
export async function informInvoiceNumber(
  params: InvoiceKey & { actorId: string },
): Promise<{ status: "informed" | "already-registered" }> {
  const invoiceNumber = validateInvoiceNumber(params.invoiceNumber);
  const key: InvoiceKey = { ...params, invoiceNumber };
  const { sql } = database();
  return sql.begin(async (tx) => {
    const [allocated] = await tx<{ found: number }[]>`
      SELECT 1 AS found FROM purchase_cycle_product_allocations
      WHERE purchase_cycle_date = ${key.cycleDate}::date AND store_id = ${key.storeId}::uuid
        AND supplier_id = ${key.supplierId}::uuid AND destined_quantity > 0
      LIMIT 1
    `;
    if (!allocated) {
      throw new InvoiceEntryError("Não há destinação deste fornecedor para esta loja neste ciclo.");
    }
    const [withPhoto] = await tx<{ found: number }[]>`
      SELECT 1 AS found FROM purchase_cycle_invoices
      WHERE purchase_cycle_date = ${key.cycleDate}::date AND store_id = ${key.storeId}::uuid
        AND supplier_id = ${key.supplierId}::uuid AND invoice_number = ${invoiceNumber}
    `;
    if (withPhoto) return { status: "already-registered" as const };

    const [row] = await tx<{ id: string }[]>`
      INSERT INTO purchase_cycle_invoice_entries
        (purchase_cycle_date, store_id, supplier_id, invoice_number, informed_at, informed_by)
      VALUES (${key.cycleDate}::date, ${key.storeId}::uuid, ${key.supplierId}::uuid, ${invoiceNumber}, now(), ${params.actorId}::uuid)
      ON CONFLICT (purchase_cycle_date, store_id, supplier_id, invoice_number) DO UPDATE
        SET informed_at = COALESCE(purchase_cycle_invoice_entries.informed_at, now()),
            informed_by = COALESCE(purchase_cycle_invoice_entries.informed_by, EXCLUDED.informed_by),
            updated_at = now()
      RETURNING id
    `;
    await audit(tx, params.actorId, "INVOICE_NUMBER_INFORMED", row.id, key);
    return { status: "informed" as const };
  });
}

/** Remove um número informado por engano (só antes de marcar a entrada). */
export async function removeInformedInvoiceNumber(params: InvoiceKey & { actorId: string }): Promise<void> {
  const invoiceNumber = validateInvoiceNumber(params.invoiceNumber);
  const key: InvoiceKey = { ...params, invoiceNumber };
  const { sql } = database();
  await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; entry_confirmed_at: string | null }[]>`
      SELECT id, entry_confirmed_at::text AS entry_confirmed_at FROM purchase_cycle_invoice_entries
      WHERE purchase_cycle_date = ${key.cycleDate}::date AND store_id = ${key.storeId}::uuid
        AND supplier_id = ${key.supplierId}::uuid AND invoice_number = ${invoiceNumber}
        AND informed_at IS NOT NULL
      FOR UPDATE
    `;
    if (!row) throw new InvoiceEntryError("Número informado não encontrado.");
    if (row.entry_confirmed_at) throw new InvoiceEntryError("Desmarque a entrada dada antes de remover o número.");
    await tx`DELETE FROM purchase_cycle_invoice_entries WHERE id = ${row.id}::uuid`;
    await audit(tx, params.actorId, "INVOICE_NUMBER_REMOVED", row.id, key);
  });
}

/** Números informados no Fechamento ainda sem foto, para sugerir na Destinação. */
export async function listInformedInvoiceNumbers(cycleDate: string): Promise<InformedInvoiceNumber[]> {
  const { sql } = database();
  const rows = await sql<{ store_id: string; supplier_id: string; invoice_number: string }[]>`
    SELECT e.store_id, e.supplier_id, e.invoice_number
    FROM purchase_cycle_invoice_entries e
    WHERE e.purchase_cycle_date = ${cycleDate}::date
      AND e.informed_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM purchase_cycle_invoices i
        WHERE i.purchase_cycle_date = e.purchase_cycle_date AND i.store_id = e.store_id
          AND i.supplier_id = e.supplier_id AND i.invoice_number = e.invoice_number
      )
    ORDER BY e.informed_at
  `;
  return rows.map((r) => ({ storeId: r.store_id, supplierId: r.supplier_id, invoiceNumber: r.invoice_number }));
}
