BEGIN;

CREATE TABLE IF NOT EXISTS purchase_cycle_product_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  purchase_cycle_date date NOT NULL,
  cost numeric(12,2),
  purchased boolean NOT NULL DEFAULT false,
  purchased_at timestamptz,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_cycle_product_costs_product_cycle_unique
    UNIQUE(product_id, purchase_cycle_date),
  CONSTRAINT purchase_cycle_product_costs_cost_check
    CHECK (cost IS NULL OR (cost > 0 AND cost <= 99999999.99)),
  CONSTRAINT purchase_cycle_product_costs_purchased_cost_check
    CHECK (NOT purchased OR cost IS NOT NULL),
  CONSTRAINT purchase_cycle_product_costs_purchased_at_check
    CHECK ((purchased AND purchased_at IS NOT NULL) OR (NOT purchased AND purchased_at IS NULL)),
  CONSTRAINT purchase_cycle_product_costs_version_check CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS purchase_cycle_product_costs_official_idx
  ON purchase_cycle_product_costs(product_id, purchase_cycle_date DESC)
  WHERE purchased = true;

CREATE INDEX IF NOT EXISTS purchase_cycle_product_costs_cycle_idx
  ON purchase_cycle_product_costs(purchase_cycle_date, purchased);

COMMIT;
