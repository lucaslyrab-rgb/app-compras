BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS purchase_cycle_date date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cutoff_at timestamptz;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'orders'::regclass AND tgname = 'immutable_orders' AND tgenabled <> 'D') THEN
    ALTER TABLE orders DISABLE TRIGGER immutable_orders;
  END IF;
END $$;

UPDATE orders
SET purchase_cycle_date = local_day + CASE WHEN local_time < time '19:00' THEN 1 ELSE 2 END,
    cutoff_at = ((local_day + CASE WHEN local_time < time '19:00' THEN 0 ELSE 1 END)::timestamp + interval '19 hours') AT TIME ZONE 'America/Sao_Paulo'
FROM (
  SELECT id,
         (submitted_at AT TIME ZONE 'America/Sao_Paulo')::date AS local_day,
         (submitted_at AT TIME ZONE 'America/Sao_Paulo')::time AS local_time
  FROM orders
) historical
WHERE orders.id = historical.id
  AND (orders.purchase_cycle_date IS NULL OR orders.cutoff_at IS NULL);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'orders'::regclass AND tgname = 'immutable_orders') THEN
    ALTER TABLE orders ENABLE TRIGGER immutable_orders;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM orders WHERE purchase_cycle_date IS NULL OR cutoff_at IS NULL) THEN
    RAISE EXCEPTION 'Não foi possível determinar o ciclo de compra de todos os pedidos';
  END IF;
END $$;

ALTER TABLE orders ALTER COLUMN purchase_cycle_date SET NOT NULL;
ALTER TABLE orders ALTER COLUMN cutoff_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS orders_store_cycle_idx ON orders(store_id, purchase_cycle_date, revision);
CREATE INDEX IF NOT EXISTS orders_store_cycle_valid_idx ON orders(store_id, purchase_cycle_date, revision) WHERE cancelled_at IS NULL;

COMMIT;
