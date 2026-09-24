BEGIN;

ALTER TABLE purchase_cycle_product_costs
  ADD COLUMN IF NOT EXISTS cost_is_unit boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM products
    WHERE upper(purchase_format) NOT IN ('CX', 'SC', 'UND', 'PCT', 'BDJ')
  ) THEN
    RAISE EXCEPTION 'Existem produtos com formato de compra sem conversão inicial suportada';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS product_pricing_parameters (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE RESTRICT,
  sale_unit text NOT NULL,
  conversion_quantity numeric(14,6) NOT NULL,
  conversion_origin text NOT NULL,
  beneficiation_loss_percent numeric(7,4) NOT NULL DEFAULT 0,
  specific_margin_percent numeric(7,4),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_pricing_parameters_sale_unit_check
    CHECK (btrim(sale_unit) <> ''),
  CONSTRAINT product_pricing_parameters_conversion_check
    CHECK (conversion_quantity > 0),
  CONSTRAINT product_pricing_parameters_origin_check
    CHECK (conversion_origin IN ('PROVISIONAL', 'UNIT', 'MANUAL')),
  CONSTRAINT product_pricing_parameters_loss_check
    CHECK (beneficiation_loss_percent >= 0 AND beneficiation_loss_percent < 100),
  CONSTRAINT product_pricing_parameters_margin_check
    CHECK (specific_margin_percent IS NULL OR (specific_margin_percent >= 0 AND specific_margin_percent < 100)),
  CONSTRAINT product_pricing_parameters_version_check CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS product_pricing_parameters_origin_idx
  ON product_pricing_parameters(conversion_origin);

CREATE TABLE IF NOT EXISTS pricing_settings (
  id text PRIMARY KEY,
  operating_cost_percent numeric(7,4) NOT NULL,
  default_margin_percent numeric(7,4) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_settings_singleton_check CHECK (id = 'FLV'),
  CONSTRAINT pricing_settings_operating_check
    CHECK (operating_cost_percent >= 0 AND operating_cost_percent < 100),
  CONSTRAINT pricing_settings_margin_check
    CHECK (default_margin_percent >= 0 AND default_margin_percent < 100),
  CONSTRAINT pricing_settings_denominator_check
    CHECK (operating_cost_percent + default_margin_percent < 100),
  CONSTRAINT pricing_settings_version_check CHECK (version > 0)
);

INSERT INTO product_pricing_parameters (
  product_id, sale_unit, conversion_quantity, conversion_origin,
  beneficiation_loss_percent, specific_margin_percent
)
SELECT
  id,
  CASE WHEN upper(purchase_format) IN ('CX', 'SC') THEN 'KG' ELSE 'UND' END,
  CASE WHEN upper(purchase_format) IN ('CX', 'SC') THEN 20 ELSE 1 END,
  CASE WHEN upper(purchase_format) IN ('CX', 'SC') THEN 'PROVISIONAL' ELSE 'UNIT' END,
  0,
  NULL
FROM products
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO pricing_settings (
  id, operating_cost_percent, default_margin_percent
)
VALUES ('FLV', 23.00, 20.00)
ON CONFLICT (id) DO NOTHING;

COMMIT;
