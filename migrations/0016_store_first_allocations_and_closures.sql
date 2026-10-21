-- Migration 0016: Nova Experiência Operacional de Destinação Store-First e Fechamento por Loja
-- Implementa decisões de não compra por fornecedor, conferência em lote, confirmação conjunta de cortes por loja,
-- histórico append-only imutável de fechamentos e conjunto histórico de lojas participantes por ciclo.

BEGIN;

-- 1. Decisões explícitas por ciclo, fornecedor, produto e loja (ex: NÃO COMPREI DESTE FORNECEDOR)
CREATE TABLE IF NOT EXISTS purchase_cycle_product_supplier_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_cycle_date date NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('NOT_PURCHASED')),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decisions_cycle_supp_prod_store_unique UNIQUE (purchase_cycle_date, supplier_id, product_id, store_id)
);

CREATE INDEX IF NOT EXISTS decisions_cycle_store_idx
ON purchase_cycle_product_supplier_decisions (purchase_cycle_date, store_id);

CREATE INDEX IF NOT EXISTS decisions_cycle_supp_idx
ON purchase_cycle_product_supplier_decisions (supplier_id, purchase_cycle_date);

-- 2. Registro de conferência / conclusão de fornecedor por loja
CREATE TABLE IF NOT EXISTS purchase_cycle_supplier_store_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_cycle_date date NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'REVIEWED' CHECK (status IN ('REVIEWED', 'PENDING')),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_store_review_unique UNIQUE (purchase_cycle_date, supplier_id, store_id),
  CONSTRAINT supplier_store_review_version_check CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS supplier_store_review_cycle_idx
ON purchase_cycle_supplier_store_reviews (purchase_cycle_date, store_id);

-- 3. Histórico Append-Only de Conferência Conjunta dos Cortes e Finalização da Loja
CREATE TABLE IF NOT EXISTS purchase_cycle_store_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_cycle_date date NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_revision integer,
  status text NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN', 'CLOSED', 'REOPENED')),
  total_ordered_items integer NOT NULL DEFAULT 0,
  total_destined_items integer NOT NULL DEFAULT 0,
  total_cut_items integer NOT NULL DEFAULT 0,
  cut_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  allocations_hash text NOT NULL,
  order_hash text,
  costs_hash text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  reopened_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reopen_reason text,
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_closures_cycle_store_version_unique UNIQUE (purchase_cycle_date, store_id, version),
  CONSTRAINT store_closures_version_check CHECK (version > 0),
  CONSTRAINT store_closures_closed_check CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL) OR
    (status IN ('OPEN', 'REOPENED'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS store_closures_current_unique
ON purchase_cycle_store_closures (purchase_cycle_date, store_id)
WHERE is_current = true;

CREATE INDEX IF NOT EXISTS store_closures_cycle_idx
ON purchase_cycle_store_closures (purchase_cycle_date);

CREATE INDEX IF NOT EXISTS store_closures_store_idx
ON purchase_cycle_store_closures (store_id);

-- 4. Conjunto Histórico de Lojas Participantes por Ciclo
CREATE TABLE IF NOT EXISTS purchase_cycle_participating_stores (
  purchase_cycle_date date NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (purchase_cycle_date, store_id)
);

CREATE INDEX IF NOT EXISTS participating_stores_cycle_idx
ON purchase_cycle_participating_stores (purchase_cycle_date);

COMMIT;
