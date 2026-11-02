-- Migration 0022: Ajustes pós-Fase 6
-- 1. Permissão 'perdas:excluir' (Gestor exclui lançamento de perda errado, com motivo).
-- 2. Conferência: item recebido fora do pedido, lançado pela loja.
--    Esses itens têm quantidade pedida 0 e ficam marcados com quem lançou e quando.
-- Totalmente aditiva: nenhum dado existente é alterado além do backfill de permissões.

BEGIN;

-- 1. Permissões válidas (lista completa) + backfill para Gestores
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
    'perdas:excluir',
    'fechamento:consultar',
    'gestor:produtos',
    'gestor:precificacao',
    'gestor:fornecedores',
    'gestor:configuracoes',
    'gestor:usuarios'
  ]::text[]
);

UPDATE users
SET permissions = array_append(permissions, 'perdas:excluir')
WHERE role = 'GESTOR'
  AND store_id IS NULL
  AND NOT ('perdas:excluir' = ANY(permissions));

-- 2. Itens recebidos fora do pedido na conferência
ALTER TABLE store_delivery_conference_items
  ADD COLUMN IF NOT EXISTS added_outside_order boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS added_at timestamptz;

-- Quantidade pedida: continua obrigatoriamente > 0 para itens do pedido;
-- itens fora do pedido têm quantidade pedida 0.
ALTER TABLE store_delivery_conference_items DROP CONSTRAINT IF EXISTS conference_items_ordered_qty_positive;
ALTER TABLE store_delivery_conference_items ADD CONSTRAINT conference_items_ordered_qty_positive CHECK (
  ordered_quantity <> 'NaN'::numeric
  AND (
    (added_outside_order = false AND ordered_quantity > 0)
    OR (added_outside_order = true AND ordered_quantity = 0)
  )
);

ALTER TABLE store_delivery_conference_items DROP CONSTRAINT IF EXISTS conference_items_outside_order_coherence_check;
ALTER TABLE store_delivery_conference_items ADD CONSTRAINT conference_items_outside_order_coherence_check CHECK (
  (added_outside_order = false AND added_at IS NULL)
  OR (added_outside_order = true AND added_at IS NOT NULL)
);

COMMIT;
