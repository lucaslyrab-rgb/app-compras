BEGIN;

ALTER TABLE pricing_reviews
  ADD COLUMN IF NOT EXISTS decided_price numeric(18,2),
  ADD COLUMN IF NOT EXISTS decision_origin text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pricing_reviews_decision_check'
      AND conrelid = 'pricing_reviews'::regclass
  ) THEN
    ALTER TABLE pricing_reviews
      ADD CONSTRAINT pricing_reviews_decision_check CHECK (
        (decided_price IS NULL AND decision_origin IS NULL)
        OR (decided_price > 0 AND decision_origin IN ('SUGGESTED', 'MANUAL'))
      );
  END IF;
END;
$$;

COMMIT;
