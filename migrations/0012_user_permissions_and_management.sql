-- Migration 0012: Permissões granulares de usuários e gestão de acessos V1
-- Adiciona a coluna permissions na tabela users, executa backfill seguro dos usuários existentes,
-- restringe permissões válidas e substitui a constraint users_store_role_check por regra baseada em permissões.
-- Execução totalmente atômica em transação explícita.

BEGIN;

-- 1. Adiciona a coluna permissions com array vazio padrão
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}';

-- 2. Backfill inicial dos usuários existentes baseado no perfil-base (role):
-- LOJA: pedidos:criar e pedidos:historico (mantém store_id obrigatório)
UPDATE users
SET permissions = ARRAY['pedidos:criar', 'pedidos:historico']::text[]
WHERE role = 'LOJA' AND permissions = '{}';

-- COMPRADOR: compras:consolidado e compras:custos (store_id = NULL)
UPDATE users
SET permissions = ARRAY['compras:consolidado', 'compras:custos']::text[]
WHERE role = 'COMPRADOR' AND permissions = '{}';

-- GESTOR: compras:consolidado, compras:custos, gestor:produtos, gestor:precificacao, gestor:configuracoes, gestor:usuarios
-- ATENÇÃO: GESTOR NÃO recebe permissões operacionais de Loja (pedidos:criar / pedidos:historico), preservando store_id = NULL.
UPDATE users
SET permissions = ARRAY[
  'compras:consolidado',
  'compras:custos',
  'gestor:produtos',
  'gestor:precificacao',
  'gestor:configuracoes',
  'gestor:usuarios'
]::text[]
WHERE role = 'GESTOR' AND permissions = '{}';

-- 3. Constraint de permissões permitidas: aceita exclusivamente as 8 permissões oficiais V1.
-- Falha de forma segura caso a constraint já exista com definição divergente.
ALTER TABLE users ADD CONSTRAINT users_permissions_valid_check CHECK (
  permissions <@ ARRAY[
    'pedidos:criar',
    'pedidos:historico',
    'compras:consolidado',
    'compras:custos',
    'gestor:produtos',
    'gestor:precificacao',
    'gestor:configuracoes',
    'gestor:usuarios'
  ]::text[]
);

-- 4. Substituição segura da constraint de loja:
-- Usuários com qualquer permissão de loja (pedidos:criar ou pedidos:historico) DEVEM possuir store_id.
-- Usuários sem nenhuma permissão de loja DEVEM possuir store_id = NULL.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_store_role_check;

ALTER TABLE users ADD CONSTRAINT users_store_permission_check CHECK (
  (ARRAY['pedidos:criar', 'pedidos:historico']::text[] && permissions AND store_id IS NOT NULL)
  OR
  (NOT (ARRAY['pedidos:criar', 'pedidos:historico']::text[] && permissions) AND store_id IS NULL)
);

COMMIT;
