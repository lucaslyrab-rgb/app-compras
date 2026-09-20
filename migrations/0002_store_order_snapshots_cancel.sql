ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS snapshot_erp_code integer;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS snapshot_name text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS snapshot_unit text;

UPDATE order_items oi
SET snapshot_erp_code = p.erp_code,
    snapshot_name = p.name,
    snapshot_unit = p.unit
FROM products p
WHERE p.id = oi.product_id
  AND (oi.snapshot_erp_code IS NULL OR oi.snapshot_name IS NULL OR oi.snapshot_unit IS NULL);

ALTER TABLE order_items ALTER COLUMN snapshot_erp_code SET NOT NULL;
ALTER TABLE order_items ALTER COLUMN snapshot_name SET NOT NULL;
ALTER TABLE order_items ALTER COLUMN snapshot_unit SET NOT NULL;
CREATE INDEX IF NOT EXISTS orders_store_valid_idx ON orders(store_id, submitted_at) WHERE cancelled_at IS NULL;

CREATE OR REPLACE FUNCTION prevent_order_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL
     AND NEW.id = OLD.id
     AND NEW.store_id = OLD.store_id
     AND NEW.order_date = OLD.order_date
     AND NEW.revision = OLD.revision
     AND NEW.submitted_by = OLD.submitted_by
     AND NEW.submitted_at = OLD.submitted_at
     AND NEW.cancelled_by IS NOT NULL
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Pedidos enviados são imutáveis';
END $$;

DROP TRIGGER IF EXISTS immutable_orders ON orders;
CREATE TRIGGER immutable_orders BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION prevent_order_mutation();
