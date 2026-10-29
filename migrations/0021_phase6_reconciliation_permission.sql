-- Migration 0021: Permissão do Fechamento Integrado (Fase 6)
-- O confronto pedido x destinação x conferência é calculado na leitura e não cria tabelas.
-- Esta migration apenas:
-- 1. registra a permissão 'fechamento:consultar' na lista de permissões válidas;
-- 2. concede a permissão aos usuários GESTOR existentes (Comprador e Loja não recebem).
-- Usuários do CPD recebem a permissão manualmente pela tela de Usuários.

BEGIN;

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
    'fechamento:consultar',
    'gestor:produtos',
    'gestor:precificacao',
    'gestor:fornecedores',
    'gestor:configuracoes',
    'gestor:usuarios'
  ]::text[]
);

UPDATE users
SET permissions = array_append(permissions, 'fechamento:consultar')
WHERE role = 'GESTOR'
  AND store_id IS NULL
  AND NOT ('fechamento:consultar' = ANY(permissions));

COMMIT;
