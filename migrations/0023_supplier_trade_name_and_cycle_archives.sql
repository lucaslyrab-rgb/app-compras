-- Migration 0023: Nome fantasia obrigatório e encerramento de ciclos pelo Gestor
-- 1. Fornecedores sem nome fantasia recebem os 15 primeiros caracteres da razão
--    social (mesma regra que o cadastro passa a aplicar quando o campo vem vazio).
-- 2. Registro dos ciclos encerrados pelo Gestor ("Encerrar ciclo"): quem, quando,
--    por quê e o retrato do que estava aberto. Nada é apagado.

BEGIN;

UPDATE suppliers
SET trade_name = btrim(left(btrim(corporate_name), 15)),
    updated_at = now()
WHERE trade_name IS NULL OR btrim(trade_name) = '';

CREATE TABLE IF NOT EXISTS purchase_cycle_archives (
  purchase_cycle_date date PRIMARY KEY,
  reason text NOT NULL,
  archived_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  archived_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT purchase_cycle_archives_reason_check CHECK (length(btrim(reason)) >= 3)
);

COMMIT;
