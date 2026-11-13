-- Migration 0026: Exclusividade legada vira vínculo com fornecedor (v1.4)
--
-- O cadastro de produto tinha a caixa "Fornecedor exclusivo" (products.exclusive_supplier)
-- e, depois, a aba de fornecedores com vínculo exclusivo (product_suppliers.is_exclusive).
-- A caixa sai do painel: a exclusividade passa a ser marcada só na aba Fornecedores.
--
-- Produtos marcados apenas pela caixa antiga eram tratados como exclusivos da
-- JEB Distribuidora (fallback em Destinação e no relatório por fornecedor). Esta
-- migration cria esse vínculo explícito (principal + exclusivo + ativo) para que a
-- aba Fornecedores mostre o mesmo que a Destinação já fazia.
--
-- Só age em produtos com exclusive_supplier = true SEM vínculo exclusivo ativo.
-- Se a JEB não estiver cadastrada, nada muda (o fallback continua valendo).

BEGIN;

CREATE TEMP TABLE _jeb ON COMMIT DROP AS
SELECT id
FROM suppliers
WHERE tax_id = '48336863000160' OR upper(corporate_name) LIKE '%JEB DISTRIBUIDORA%'
ORDER BY (tax_id = '48336863000160') DESC, active DESC, created_at
LIMIT 1;

CREATE TEMP TABLE _legacy ON COMMIT DROP AS
SELECT p.id AS product_id
FROM products p
WHERE p.exclusive_supplier = true
  AND EXISTS (SELECT 1 FROM _jeb)
  AND NOT EXISTS (
    SELECT 1 FROM product_suppliers ps
    WHERE ps.product_id = p.id AND ps.is_exclusive = true AND ps.active = true
  );

-- Libera "principal" e "exclusivo" de outros vínculos (os índices únicos valem
-- também para vínculos inativos). Os demais fornecedores ficam como alternativos.
UPDATE product_suppliers ps
SET is_primary = false, is_exclusive = false, updated_at = now()
FROM _legacy l, _jeb j
WHERE ps.product_id = l.product_id
  AND ps.supplier_id <> j.id
  AND (ps.is_primary OR ps.is_exclusive);

INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active, notes)
SELECT l.product_id, j.id, true, true, true, 'Exclusividade migrada da marcação antiga (v1.4)'
FROM _legacy l CROSS JOIN _jeb j
ON CONFLICT (product_id, supplier_id) DO UPDATE
SET is_primary = true, is_exclusive = true, active = true, updated_at = now();

COMMIT;
