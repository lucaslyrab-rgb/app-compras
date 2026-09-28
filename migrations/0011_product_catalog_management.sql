BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS photo_key text,
  ADD COLUMN IF NOT EXISTS photo_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_version_check' AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_version_check CHECK (version > 0);
  END IF;
END;
$$;

COMMIT;
