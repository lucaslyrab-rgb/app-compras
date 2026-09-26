BEGIN;

ALTER TABLE pricing_reviews
  ADD COLUMN IF NOT EXISTS applied_price numeric(18,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pricing_reviews_applied_price_check'
      AND conrelid = 'pricing_reviews'::regclass
  ) THEN
    ALTER TABLE pricing_reviews
      ADD CONSTRAINT pricing_reviews_applied_price_check
      CHECK (applied_price IS NULL OR applied_price > 0);
  END IF;
END;
$$;

COMMIT;
