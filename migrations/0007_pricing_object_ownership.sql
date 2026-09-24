BEGIN;

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

  -- O database da aplicação pertence ao papel operacional (app_compras em
  -- produção), enquanto a migration pode ser executada por um administrador.
  EXECUTE format(
    'ALTER TABLE public.product_pricing_parameters OWNER TO %I',
    application_owner
  );
  EXECUTE format(
    'ALTER TABLE public.pricing_settings OWNER TO %I',
    application_owner
  );
  EXECUTE format(
    'ALTER TABLE public.pricing_reviews OWNER TO %I',
    application_owner
  );
  EXECUTE format(
    'ALTER FUNCTION public.prevent_pricing_review_mutation() OWNER TO %I',
    application_owner
  );
END;
$$;

COMMIT;
