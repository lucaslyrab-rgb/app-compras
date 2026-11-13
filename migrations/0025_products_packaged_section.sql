-- Migration 0025: Seção "Embalados" (v1.4)
--
-- Produtos embalados/embandejados (comprados do WG Embalados) aparecem numa
-- seção própria, depois dos demais produtos, em Pedido, Consolidado, Custos,
-- Destinação, Conferência, Perdas e Fechamento. O cadastro de Produtos e a
-- Precificação continuam em ordem alfabética.
--
-- A marcação é feita no cadastro do produto. Marcação inicial: produtos com
-- vínculo exclusivo e ativo com o fornecedor WG Embalados.

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_packaged boolean NOT NULL DEFAULT false;

UPDATE products p
SET is_packaged = true
WHERE p.is_packaged = false
  AND EXISTS (
    SELECT 1
    FROM product_suppliers ps
    JOIN suppliers s ON s.id = ps.supplier_id
    WHERE ps.product_id = p.id
      AND ps.is_exclusive = true
      AND ps.active = true
      AND (upper(s.trade_name) LIKE 'WG EMBALADOS%' OR upper(s.corporate_name) LIKE 'WG EMBALADOS%')
  );

COMMIT;
