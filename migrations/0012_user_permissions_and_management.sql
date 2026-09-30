-- Migration 0012: Permissões granulares de usuários e gestão de acessos V1
-- Adiciona a coluna permissions na tabela users, executa backfill seguro dos usuários existentes,
-- restringe permissões válidas e substitui a constraint users_store_role_check por regra baseada em permissões.
-- Execução totalmente atômica em transação explícita e retomável de forma segura.

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
-- - Se ausente: cria a constraint.
-- - Se já existente e semanticamente equivalente: aceita e prossegue.
-- - Se já existente com definição divergente: falha imediatamente.
DO $$
DECLARE
  v_current_def text;
  v_expected_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_current_def
  FROM pg_constraint
  WHERE conrelid = 'users'::regclass AND conname = 'users_permissions_valid_check';

  IF v_current_def IS NULL THEN
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
  ELSE
    CREATE TEMP TABLE _tmp_perm_cmp (permissions text[]);
    ALTER TABLE _tmp_perm_cmp ADD CONSTRAINT _tmp_c1 CHECK (
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
    SELECT pg_get_constraintdef(oid) INTO v_expected_def
    FROM pg_constraint
    WHERE conrelid = '_tmp_perm_cmp'::regclass AND conname = '_tmp_c1';
    DROP TABLE _tmp_perm_cmp;

    IF v_current_def <> v_expected_def THEN
      RAISE EXCEPTION 'Constraint users_permissions_valid_check já existe com definição divergente. Atual: %, Esperada: %', v_current_def, v_expected_def;
    END IF;
  END IF;
END $$;

-- 4. Substituição segura da constraint de loja:
-- Usuários com qualquer permissão de loja (pedidos:criar ou pedidos:historico) DEVEM possuir store_id.
-- Usuários sem nenhuma permissão de loja DEVEM possuir store_id = NULL.
-- Remove a constraint legada se ainda existir
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_store_role_check;

-- - Se ausente: cria a constraint.
-- - Se já existente e semanticamente equivalente: aceita e prossegue.
-- - Se já existente com definição divergente: falha imediatamente.
DO $$
DECLARE
  v_current_def text;
  v_expected_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_current_def
  FROM pg_constraint
  WHERE conrelid = 'users'::regclass AND conname = 'users_store_permission_check';

  IF v_current_def IS NULL THEN
    ALTER TABLE users ADD CONSTRAINT users_store_permission_check CHECK (
      (ARRAY['pedidos:criar', 'pedidos:historico']::text[] && permissions AND store_id IS NOT NULL)
      OR
      (NOT (ARRAY['pedidos:criar', 'pedidos:historico']::text[] && permissions) AND store_id IS NULL)
    );
  ELSE
    CREATE TEMP TABLE _tmp_store_cmp (permissions text[], store_id uuid);
    ALTER TABLE _tmp_store_cmp ADD CONSTRAINT _tmp_s1 CHECK (
      (ARRAY['pedidos:criar', 'pedidos:historico']::text[] && permissions AND store_id IS NOT NULL)
      OR
      (NOT (ARRAY['pedidos:criar', 'pedidos:historico']::text[] && permissions) AND store_id IS NULL)
    );
    SELECT pg_get_constraintdef(oid) INTO v_expected_def
    FROM pg_constraint
    WHERE conrelid = '_tmp_store_cmp'::regclass AND conname = '_tmp_s1';
    DROP TABLE _tmp_store_cmp;

    IF v_current_def <> v_expected_def THEN
      RAISE EXCEPTION 'Constraint users_store_permission_check já existe com definição divergente. Atual: %, Esperada: %', v_current_def, v_expected_def;
    END IF;
  END IF;
END $$;

COMMIT;
