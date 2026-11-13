-- Migration 0024: Notas no Fechamento integrado (v1.3)
--
-- Registro por nota (ciclo × loja × fornecedor × número) de:
-- - "entrada dada": o CPD/Gestor marca que a nota já foi lançada no sistema fiscal;
-- - número informado no Fechamento, sem foto, para loja que ficou sem nota na
--   Destinação. A foto continua sendo anexada só na Destinação: quando o
--   comprador anexar a nota com o mesmo número, as duas viram uma só pela chave.
--
-- Fica em tabela própria para não mexer em purchase_cycle_invoices (que exige foto).

BEGIN;

CREATE TABLE IF NOT EXISTS purchase_cycle_invoice_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_cycle_date date NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  informed_at timestamptz,
  informed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  entry_confirmed_at timestamptz,
  entry_confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_cycle_invoice_entries_unique UNIQUE (purchase_cycle_date, store_id, supplier_id, invoice_number),
  CONSTRAINT invoice_entries_number_valid CHECK (length(trim(invoice_number)) > 0 AND length(invoice_number) <= 100),
  CONSTRAINT invoice_entries_confirmed_by_needs_date CHECK (entry_confirmed_by IS NULL OR entry_confirmed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS invoice_entries_cycle_store_idx
  ON purchase_cycle_invoice_entries (purchase_cycle_date, store_id);

COMMIT;
