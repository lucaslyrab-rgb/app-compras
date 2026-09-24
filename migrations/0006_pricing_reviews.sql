BEGIN;

CREATE TABLE IF NOT EXISTS pricing_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  official_cost_id uuid NOT NULL REFERENCES purchase_cycle_product_costs(id) ON DELETE RESTRICT,
  official_cost_version integer NOT NULL,
  official_purchase_cycle_date date NOT NULL,
  official_cost numeric(12,2) NOT NULL,
  cost_is_unit boolean NOT NULL,
  sale_unit text NOT NULL,
  conversion_quantity numeric(14,6) NOT NULL,
  conversion_origin text NOT NULL,
  beneficiation_loss_percent numeric(7,4) NOT NULL,
  parameter_version integer NOT NULL,
  operating_cost_percent numeric(7,4) NOT NULL,
  desired_margin_percent numeric(7,4) NOT NULL,
  margin_origin text NOT NULL,
  settings_version integer NOT NULL,
  gross_unit_cost numeric(18,6) NOT NULL,
  effective_unit_cost numeric(18,6) NOT NULL,
  calculated_price numeric(18,6) NOT NULL,
  suggested_price numeric(18,2) NOT NULL,
  input_fingerprint text NOT NULL,
  reviewed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_reviews_cost_check CHECK (official_cost > 0),
  CONSTRAINT pricing_reviews_conversion_check CHECK (conversion_quantity > 0),
  CONSTRAINT pricing_reviews_origin_check CHECK (conversion_origin IN ('PROVISIONAL', 'UNIT', 'MANUAL')),
  CONSTRAINT pricing_reviews_loss_check CHECK (beneficiation_loss_percent >= 0 AND beneficiation_loss_percent < 100),
  CONSTRAINT pricing_reviews_margin_origin_check CHECK (margin_origin IN ('DEFAULT', 'SPECIFIC')),
  CONSTRAINT pricing_reviews_percentages_check CHECK (
    operating_cost_percent >= 0 AND desired_margin_percent >= 0
    AND operating_cost_percent + desired_margin_percent < 100
  ),
  CONSTRAINT pricing_reviews_versions_check CHECK (
    official_cost_version > 0 AND parameter_version > 0 AND settings_version > 0
  ),
  CONSTRAINT pricing_reviews_derived_values_check CHECK (
    gross_unit_cost > 0 AND effective_unit_cost > 0
    AND calculated_price > 0 AND suggested_price > 0
  )
);

CREATE INDEX IF NOT EXISTS pricing_reviews_product_date_idx
  ON pricing_reviews(product_id, reviewed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS pricing_reviews_official_cost_idx
  ON pricing_reviews(official_cost_id);

CREATE OR REPLACE FUNCTION prevent_pricing_review_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Revisões de precificação são imutáveis';
END;
$$;

DROP TRIGGER IF EXISTS pricing_reviews_immutable ON pricing_reviews;
CREATE TRIGGER pricing_reviews_immutable
BEFORE UPDATE OR DELETE ON pricing_reviews
FOR EACH ROW EXECUTE FUNCTION prevent_pricing_review_mutation();

COMMIT;
