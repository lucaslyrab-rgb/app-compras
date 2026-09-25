BEGIN;

CREATE TABLE IF NOT EXISTS purchase_calendar_settings (
  id text PRIMARY KEY,
  timezone text NOT NULL,
  cutoff_time time without time zone NOT NULL,
  enabled_iso_weekdays smallint[] NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_calendar_settings_singleton_check
    CHECK (id = 'OPERATIONAL'),
  CONSTRAINT purchase_calendar_settings_timezone_check
    CHECK (btrim(timezone) <> ''),
  CONSTRAINT purchase_calendar_settings_weekdays_nonempty_check
    CHECK (cardinality(enabled_iso_weekdays) > 0),
  CONSTRAINT purchase_calendar_settings_weekdays_range_check
    CHECK (enabled_iso_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  CONSTRAINT purchase_calendar_settings_version_check
    CHECK (version > 0)
);

INSERT INTO purchase_calendar_settings (
  id, timezone, cutoff_time, enabled_iso_weekdays
)
VALUES (
  'OPERATIONAL',
  'America/Sao_Paulo',
  time '19:00',
  ARRAY[1, 2, 4, 5]::smallint[]
)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  application_owner name;
BEGIN
  SELECT pg_get_userbyid(datdba)
  INTO application_owner
  FROM pg_database
  WHERE datname = current_database();

  IF application_owner IS NULL THEN
    RAISE EXCEPTION 'Não foi possível identificar o owner do database atual';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.purchase_calendar_settings OWNER TO %I',
    application_owner
  );
END;
$$;

COMMIT;
