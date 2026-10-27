-- Migration 0017: Registro e Vinculação de Notas Fiscais às Destinações (Fase 4)
-- Cria tabelas para registrar notas fiscais por ciclo, loja e fornecedor com foto no S3
-- e vincular aos produtos destinados da respectiva loja.

BEGIN;

CREATE TABLE IF NOT EXISTS purchase_cycle_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_cycle_date date NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  image_s3_key text NOT NULL,
  content_type text NOT NULL DEFAULT 'image/webp',
  file_size_bytes integer NOT NULL,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_cycle_invoices_unique UNIQUE (purchase_cycle_date, store_id, supplier_id, invoice_number),
  CONSTRAINT invoice_number_not_empty CHECK (length(trim(invoice_number)) > 0),
  CONSTRAINT image_s3_key_not_empty CHECK (length(trim(image_s3_key)) > 0),
  CONSTRAINT file_size_positive CHECK (file_size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS invoices_cycle_store_idx
  ON purchase_cycle_invoices (purchase_cycle_date, store_id);

CREATE INDEX IF NOT EXISTS invoices_cycle_supp_idx
  ON purchase_cycle_invoices (purchase_cycle_date, supplier_id);

CREATE INDEX IF NOT EXISTS invoices_cycle_store_supp_idx
  ON purchase_cycle_invoices (purchase_cycle_date, store_id, supplier_id);

-- Vinculação explícita de produtos da loja abrangidos pela nota
CREATE TABLE IF NOT EXISTS purchase_cycle_invoice_items (
  invoice_id uuid NOT NULL REFERENCES purchase_cycle_invoices(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invoice_id, product_id)
);

CREATE INDEX IF NOT EXISTS invoice_items_product_idx
  ON purchase_cycle_invoice_items (product_id);

COMMIT;
