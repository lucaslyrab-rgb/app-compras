-- Migration 0015: Vinculação das Compras aos Fornecedores e Fechamento Operacional do Comprador (Fase 3)
-- Cria tabelas para destinação de compras por fornecedor/produto/loja e controle de fechamento/reabertura operacional.

BEGIN;

CREATE TABLE IF NOT EXISTS purchase_cycle_product_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_cycle_date date NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  ordered_quantity numeric(12, 2) NOT NULL DEFAULT 0,
  destined_quantity numeric(12, 2) NOT NULL,
  purchase_format text NOT NULL,
  is_additional_purchase boolean NOT NULL DEFAULT false,
  conversion_factor_kg numeric(12, 3),
  conversion_origin text,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allocations_cycle_supp_prod_store_unique UNIQUE (purchase_cycle_date, supplier_id, product_id, store_id),
  CONSTRAINT allocations_quantities_nonnegative CHECK (ordered_quantity >= 0 AND destined_quantity >= 0),
  CONSTRAINT allocations_version_check CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS allocations_cycle_idx
ON purchase_cycle_product_allocations (purchase_cycle_date);

CREATE INDEX IF NOT EXISTS allocations_supplier_cycle_idx
ON purchase_cycle_product_allocations (supplier_id, purchase_cycle_date);

CREATE INDEX IF NOT EXISTS allocations_product_cycle_idx
ON purchase_cycle_product_allocations (product_id, purchase_cycle_date);

CREATE INDEX IF NOT EXISTS allocations_store_cycle_idx
ON purchase_cycle_product_allocations (store_id, purchase_cycle_date);

CREATE TABLE IF NOT EXISTS purchase_cycle_buyer_closures (
  purchase_cycle_date date PRIMARY KEY,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  reopened_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reopen_reason text,
  total_purchased_products integer NOT NULL DEFAULT 0,
  total_allocated_products integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT closures_version_check CHECK (version > 0),
  CONSTRAINT closures_closed_check CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL) OR
    (status = 'OPEN')
  )
);

-- Atualiza constraint de permissões válidas para incluir compras:destinacao
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_permissions_valid_check;

ALTER TABLE users ADD CONSTRAINT users_permissions_valid_check CHECK (
  permissions <@ ARRAY[
    'pedidos:criar',
    'pedidos:historico',
    'compras:consolidado',
    'compras:custos',
    'compras:fornecedores',
    'compras:destinacao',
    'gestor:produtos',
    'gestor:precificacao',
    'gestor:fornecedores',
    'gestor:configuracoes',
    'gestor:usuarios'
  ]::text[]
);

-- Backfill seguro e idempotente: adiciona compras:destinacao aos compradores existentes
UPDATE users
SET permissions = array_append(permissions, 'compras:destinacao')
WHERE role = 'COMPRADOR'
  AND NOT ('compras:destinacao' = ANY(permissions));

-- Backfill seguro e idempotente: adiciona compras:destinacao aos gestores existentes
UPDATE users
SET permissions = array_append(permissions, 'compras:destinacao')
WHERE role = 'GESTOR'
  AND NOT ('compras:destinacao' = ANY(permissions));

COMMIT;
