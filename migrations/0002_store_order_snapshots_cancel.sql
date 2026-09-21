BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS snapshot_erp_code integer;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS snapshot_name text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS snapshot_unit text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'order_items'::regclass AND tgname = 'immutable_order_items' AND tgenabled <> 'D') THEN
    ALTER TABLE order_items DISABLE TRIGGER immutable_order_items;
  END IF;
END $$;

UPDATE order_items oi
SET snapshot_erp_code = p.erp_code, snapshot_name = p.name, snapshot_unit = p.unit
FROM products p
WHERE p.id = oi.product_id
  AND (oi.snapshot_erp_code IS NULL OR oi.snapshot_name IS NULL OR oi.snapshot_unit IS NULL);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'order_items'::regclass AND tgname = 'immutable_order_items') THEN
    ALTER TABLE order_items ENABLE TRIGGER immutable_order_items;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM order_items WHERE snapshot_erp_code IS NULL OR snapshot_name IS NULL OR snapshot_unit IS NULL) THEN
    RAISE EXCEPTION 'Não foi possível preencher todos os snapshots de order_items';
  END IF;
END $$;

ALTER TABLE order_items ALTER COLUMN snapshot_erp_code SET NOT NULL;
ALTER TABLE order_items ALTER COLUMN snapshot_name SET NOT NULL;
ALTER TABLE order_items ALTER COLUMN snapshot_unit SET NOT NULL;
CREATE INDEX IF NOT EXISTS orders_store_valid_idx ON orders(store_id, submitted_at) WHERE cancelled_at IS NULL;

CREATE OR REPLACE FUNCTION prevent_order_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' AND TG_OP = 'UPDATE'
     AND (to_jsonb(OLD)->>'cancelled_at') IS NULL
     AND (to_jsonb(NEW)->>'cancelled_at') IS NOT NULL
     AND (to_jsonb(NEW)->>'id') = (to_jsonb(OLD)->>'id')
     AND (to_jsonb(NEW)->>'store_id') = (to_jsonb(OLD)->>'store_id')
     AND (to_jsonb(NEW)->>'order_date') = (to_jsonb(OLD)->>'order_date')
     AND (to_jsonb(NEW)->>'revision') = (to_jsonb(OLD)->>'revision')
     AND (to_jsonb(NEW)->>'submitted_by') = (to_jsonb(OLD)->>'submitted_by')
     AND (to_jsonb(NEW)->>'submitted_at') = (to_jsonb(OLD)->>'submitted_at')
     AND (to_jsonb(NEW)->>'cancelled_by') IS NOT NULL
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Pedidos enviados são imutáveis';
END $$;
DROP TRIGGER IF EXISTS immutable_orders ON orders;
CREATE TRIGGER immutable_orders BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION prevent_order_mutation();

DO $$
DECLARE item_order_id uuid;
BEGIN
  SELECT order_id INTO item_order_id FROM order_items LIMIT 1;
  IF item_order_id IS NOT NULL THEN
    BEGIN
      UPDATE order_items SET stock = stock WHERE order_id = item_order_id;
      RAISE EXCEPTION 'prevent_order_mutation não protege order_items';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'Pedidos enviados são imutáveis' THEN RAISE; END IF;
    END;
  END IF;
END $$;
COMMIT;
