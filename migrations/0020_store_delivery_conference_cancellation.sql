-- Migration 0020: Cancelamento Auditado de Conferência sem Pedido Substituto (Fase 5)
-- Quando a revisão de pedido que originou uma conferência é cancelada e não existe
-- nenhuma revisão vigente para substituí-la, não há pedido para conferir. Antes
-- desta migration não havia operação correspondente (ver
-- src/modules/purchasing/conferences/repository.ts#cancelConferenceWithoutReplacementOrder);
-- a conferência ficava presa em IN_PROGRESS sem saída possível.

BEGIN;

ALTER TABLE store_delivery_conferences
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE store_delivery_conferences DROP CONSTRAINT IF EXISTS store_delivery_conferences_status_check;
ALTER TABLE store_delivery_conferences ADD CONSTRAINT store_delivery_conferences_status_check
  CHECK (status IN ('IN_PROGRESS', 'FINALIZED', 'CANCELLED'));

-- Substitui a coerência de finalização por uma coerência que também cobre o
-- cancelamento: cada status fechado (FINALIZED/CANCELLED) exige seus próprios
-- campos de encerramento preenchidos, e nenhum dos dois conjuntos se mistura.
ALTER TABLE store_delivery_conferences DROP CONSTRAINT IF EXISTS delivery_conf_finalized_coherence_check;
ALTER TABLE store_delivery_conferences ADD CONSTRAINT delivery_conf_closure_coherence_check CHECK (
  (
    status = 'FINALIZED'
    AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL
    AND total_items = verified_items
    AND cancelled_at IS NULL AND cancelled_by IS NULL
  ) OR (
    status = 'CANCELLED'
    AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
    AND finalized_at IS NULL AND finalized_by IS NULL
  ) OR (
    status = 'IN_PROGRESS'
    AND finalized_at IS NULL AND finalized_by IS NULL
    AND cancelled_at IS NULL AND cancelled_by IS NULL
  )
);

COMMIT;
