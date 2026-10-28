-- Migration 0018: Conferência de Mercadorias Recebidas e Lançamento de Perdas (Fase 5)
-- Cria tabelas para:
-- 1. store_delivery_conferences: cabeçalho da conferência física da loja por ciclo (em andamento ou finalizada)
-- 2. store_delivery_conference_items: itens conferidos em peso (KG) com ação de 'Não recebido' (0 KG)
-- 3. store_loss_records: registro diário de quebras e descartes durante o expediente da loja
-- 4. Atualização de constraints de permissões e backfill seguro para papéis LOJA, COMPRADOR e GESTOR

BEGIN;

-- 1. Cabeçalho de Conferência de Recebimento por Loja e Ciclo
CREATE TABLE IF NOT EXISTS store_delivery_conferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_cycle_date date NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  order_revision integer,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'FINALIZED')),
  total_items integer NOT NULL DEFAULT 0,
  verified_items integer NOT NULL DEFAULT 0,
  finalized_at timestamptz,
  finalized_by uuid REFERENCES users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_delivery_conferences_cycle_store_unique UNIQUE (purchase_cycle_date, store_id),
  CONSTRAINT store_delivery_conferences_version_check CHECK (version > 0),
  CONSTRAINT delivery_conf_items_count_check CHECK (
    total_items >= 0 AND verified_items >= 0 AND verified_items <= total_items
  ),
  CONSTRAINT delivery_conf_finalized_coherence_check CHECK (
    (status = 'FINALIZED' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL AND total_items = verified_items)
    OR
    (status = 'IN_PROGRESS' AND finalized_at IS NULL AND finalized_by IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS delivery_conferences_cycle_idx
  ON store_delivery_conferences (purchase_cycle_date);

CREATE INDEX IF NOT EXISTS delivery_conferences_store_cycle_idx
  ON store_delivery_conferences (store_id, purchase_cycle_date);

-- 2. Itens da Conferência de Recebimento (Pesagem em KG)
CREATE TABLE IF NOT EXISTS store_delivery_conference_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference_id uuid NOT NULL REFERENCES store_delivery_conferences(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  ordered_quantity numeric(10, 2) NOT NULL,
  ordered_unit text NOT NULL,
  received_weight_kg numeric(10, 2),
  is_unreceived boolean NOT NULL DEFAULT false,
  checked_at timestamptz,
  checked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conference_items_unique UNIQUE (conference_id, product_id),
  CONSTRAINT conference_items_weight_coherence_check CHECK (
    (is_unreceived = true AND received_weight_kg = 0)
    OR
    (is_unreceived = false AND (received_weight_kg IS NULL OR received_weight_kg > 0))
  )
);

CREATE INDEX IF NOT EXISTS conference_items_product_idx
  ON store_delivery_conference_items (product_id);

CREATE INDEX IF NOT EXISTS conference_items_conf_idx
  ON store_delivery_conference_items (conference_id);

-- 3. Registro de Perdas e Quebras Diárias das Lojas
CREATE TABLE IF NOT EXISTS store_loss_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity numeric(10, 2) NOT NULL,
  unit text NOT NULL DEFAULT 'KG',
  reason text,
  notes text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_losses_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS store_losses_store_date_idx
  ON store_loss_records (store_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS store_losses_product_idx
  ON store_loss_records (product_id);

CREATE INDEX IF NOT EXISTS store_losses_date_idx
  ON store_loss_records (recorded_at DESC);

-- 4. Atualização das Constraints de Permissões de Usuários
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_permissions_valid_check;

ALTER TABLE users ADD CONSTRAINT users_permissions_valid_check CHECK (
  permissions <@ ARRAY[
    'pedidos:criar',
    'pedidos:historico',
    'loja:conferencia',
    'loja:perdas',
    'compras:consolidado',
    'compras:custos',
    'compras:fornecedores',
    'compras:destinacao',
    'perdas:consultar',
    'gestor:produtos',
    'gestor:precificacao',
    'gestor:fornecedores',
    'gestor:configuracoes',
    'gestor:usuarios'
  ]::text[]
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_store_permission_check;

ALTER TABLE users ADD CONSTRAINT users_store_permission_check CHECK (
  (ARRAY['pedidos:criar', 'pedidos:historico', 'loja:conferencia', 'loja:perdas']::text[] && permissions AND store_id IS NOT NULL) OR
  (NOT (ARRAY['pedidos:criar', 'pedidos:historico', 'loja:conferencia', 'loja:perdas']::text[] && permissions) AND store_id IS NULL)
);

-- Backfill seguro: adiciona cada permissão individualmente evitando duplicações ou omissões em estados parciais
UPDATE users
SET permissions = array_append(permissions, 'loja:conferencia')
WHERE role = 'LOJA'
  AND store_id IS NOT NULL
  AND NOT ('loja:conferencia' = ANY(permissions));

UPDATE users
SET permissions = array_append(permissions, 'loja:perdas')
WHERE role = 'LOJA'
  AND store_id IS NOT NULL
  AND NOT ('loja:perdas' = ANY(permissions));

UPDATE users
SET permissions = array_append(permissions, 'perdas:consultar')
WHERE role IN ('COMPRADOR', 'GESTOR')
  AND NOT ('perdas:consultar' = ANY(permissions));

COMMIT;