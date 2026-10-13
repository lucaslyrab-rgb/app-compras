-- Migration 0013: Cadastro de Fornecedores e Regras Documentais V1
-- Adiciona a tabela suppliers com suporte a identificação fiscal (CNPJ/CPF), regras de emissão de NF,
-- auditoria, concorrência otimista (version) e status ativo/inativo.
-- Atualiza a constraint de permissões de usuários para incluir compras:fornecedores e gestor:fornecedores.

BEGIN;

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_name text NOT NULL,
  trade_name text,
  tax_id text,
  tax_id_type text NOT NULL DEFAULT 'NOT_INFORMED',
  tax_invoice_rule text NOT NULL DEFAULT 'STANDARD',
  contact_name text,
  contact_phone text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_corporate_name_check CHECK (btrim(corporate_name) <> ''),
  CONSTRAINT suppliers_tax_id_type_check CHECK (tax_id_type IN ('CNPJ', 'CPF', 'NOT_INFORMED')),
  CONSTRAINT suppliers_tax_invoice_rule_check CHECK (tax_invoice_rule IN ('STANDARD', 'AFTER_WEIGHING', 'SPECIAL_REGIME')),
  CONSTRAINT suppliers_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tax_id_unique
ON suppliers (tax_id)
WHERE tax_id IS NOT NULL AND btrim(tax_id) <> '';

CREATE INDEX IF NOT EXISTS suppliers_active_name_idx
ON suppliers (active, corporate_name);

-- Atualiza constraint de permissões válidas para incluir compras:fornecedores e gestor:fornecedores
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_permissions_valid_check;

ALTER TABLE users ADD CONSTRAINT users_permissions_valid_check CHECK (
  permissions <@ ARRAY[
    'pedidos:criar',
    'pedidos:historico',
    'compras:consolidado',
    'compras:custos',
    'compras:fornecedores',
    'gestor:produtos',
    'gestor:precificacao',
    'gestor:fornecedores',
    'gestor:configuracoes',
    'gestor:usuarios'
  ]::text[]
);

-- Backfill seguro e idempotente: adiciona compras:fornecedores aos compradores existentes
UPDATE users
SET permissions = array_append(permissions, 'compras:fornecedores')
WHERE role = 'COMPRADOR'
  AND NOT ('compras:fornecedores' = ANY(permissions));

-- Backfill seguro e idempotente: adiciona compras:fornecedores aos gestores existentes
UPDATE users
SET permissions = array_append(permissions, 'compras:fornecedores')
WHERE role = 'GESTOR'
  AND NOT ('compras:fornecedores' = ANY(permissions));

-- Backfill seguro e idempotente: adiciona gestor:fornecedores aos gestores existentes
UPDATE users
SET permissions = array_append(permissions, 'gestor:fornecedores')
WHERE role = 'GESTOR'
  AND NOT ('gestor:fornecedores' = ANY(permissions));

COMMIT;
