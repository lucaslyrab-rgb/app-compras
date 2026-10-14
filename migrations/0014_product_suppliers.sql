-- Migration 0014: Vinculação de Fornecedores aos Produtos
-- Adiciona a tabela associativa product_suppliers com suporte a múltiplos fornecedores por produto,
-- definição de fornecedor principal único (índice parcial), exclusividade opcional (índice parcial),
-- integridade referencial ON DELETE RESTRICT e rastreabilidade por usuário.

BEGIN;

CREATE TABLE IF NOT EXISTS product_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  is_exclusive boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_suppliers_unique UNIQUE (product_id, supplier_id),
  CONSTRAINT product_suppliers_exclusive_implies_primary CHECK (NOT is_exclusive OR is_primary)
);

-- Garante no máximo um fornecedor principal por produto
CREATE UNIQUE INDEX IF NOT EXISTS product_suppliers_single_primary_idx
ON product_suppliers (product_id)
WHERE is_primary = true;

-- Garante no máximo um fornecedor exclusivo por produto
CREATE UNIQUE INDEX IF NOT EXISTS product_suppliers_single_exclusive_idx
ON product_suppliers (product_id)
WHERE is_exclusive = true;

-- Índices de busca por produto e por fornecedor
CREATE INDEX IF NOT EXISTS product_suppliers_product_idx
ON product_suppliers (product_id);

CREATE INDEX IF NOT EXISTS product_suppliers_supplier_idx
ON product_suppliers (supplier_id);

COMMIT;
