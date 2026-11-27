-- Migration 0027: Peso da caixa por compra e padrão por fornecedor (v1.6)
--
-- O peso da caixa muda conforme o fornecedor e até de uma compra para outra
-- (ex.: maçã com caixa de 18 kg ou de 10 kg). A conversão do produto continua
-- sendo o padrão geral; agora há dois níveis acima dela:
--   1. product_suppliers.box_weight_kg — padrão daquele fornecedor;
--   2. purchase_cycle_box_weights — peso informado na Destinação para a compra
--      (ciclo × produto × fornecedor), válido para todas as lojas.
-- Cada destinação já guarda o peso usado (conversion_factor_kg); o Fechamento
-- passa a refletir o peso real sem mudar o que a loja lançou.
-- Aditiva: não altera dados existentes.

BEGIN;

ALTER TABLE product_suppliers
  ADD COLUMN IF NOT EXISTS box_weight_kg numeric(12, 3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_suppliers_box_weight_positive') THEN
    ALTER TABLE product_suppliers
      ADD CONSTRAINT product_suppliers_box_weight_positive CHECK (box_weight_kg IS NULL OR box_weight_kg > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS purchase_cycle_box_weights (
  purchase_cycle_date date NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  box_weight_kg numeric(12, 3) NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (purchase_cycle_date, product_id, supplier_id),
  CONSTRAINT purchase_cycle_box_weights_positive CHECK (box_weight_kg > 0 AND box_weight_kg <= 9999)
);

CREATE INDEX IF NOT EXISTS purchase_cycle_box_weights_product_supplier_idx
  ON purchase_cycle_box_weights (product_id, supplier_id, purchase_cycle_date DESC);

COMMIT;
