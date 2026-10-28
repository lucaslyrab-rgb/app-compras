-- Migration 0019: Reconciliação de Conferência com Revisão Vigente do Pedido (Fase 5)
-- Uma conferência em andamento pode ficar vinculada a uma revisão de pedido que a
-- loja depois revisou ou cancelou. Esta migration prepara a reconciliação explícita
-- (src/modules/purchasing/conferences/repository.ts#reconcileConferenceWithCurrentOrder)
-- sem apagar histórico: itens que saem da revisão vigente são marcados, nunca
-- removidos, preservando a pesagem já registrada para auditoria.

BEGIN;

ALTER TABLE store_delivery_conference_items
  ADD COLUMN IF NOT EXISTS removed_from_order boolean NOT NULL DEFAULT false;

ALTER TABLE store_delivery_conferences
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conference_items_removed_idx
  ON store_delivery_conference_items (conference_id, removed_from_order);

COMMIT;
