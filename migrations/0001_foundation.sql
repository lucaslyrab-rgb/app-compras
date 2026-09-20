CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('LOJA', 'COMPRADOR', 'GESTOR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL,
  store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_store_role_check CHECK ((role = 'LOJA' AND store_id IS NOT NULL) OR (role <> 'LOJA' AND store_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(idle_expires_at);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_code integer NOT NULL UNIQUE CHECK (erp_code > 0),
  name text NOT NULL CHECK (length(trim(name)) >= 2),
  unit text NOT NULL,
  purchase_format text NOT NULL,
  markup numeric(8,2) NOT NULL CHECK (markup >= 0),
  exclusive_supplier boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_date date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, order_date)
);

CREATE TABLE IF NOT EXISTS order_draft_items (
  draft_id uuid NOT NULL REFERENCES order_drafts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  stock numeric(12,2) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  quantity numeric(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY(draft_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  order_date date NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, order_date, revision)
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  stock numeric(12,2) NOT NULL CHECK (stock >= 0),
  quantity numeric(12,2) NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY(order_id, product_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events(entity_type, entity_id);

INSERT INTO stores(slug, name) VALUES
  ('ponta-da-fruta', 'MultiShow Ponta da Fruta'),
  ('balneario', 'MultiShow Balneário'),
  ('santa-monica', 'MultiShow Santa Mônica')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, active = true;

CREATE OR REPLACE FUNCTION prevent_order_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Pedidos enviados são imutáveis';
END $$;

DROP TRIGGER IF EXISTS immutable_orders ON orders;
CREATE TRIGGER immutable_orders BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION prevent_order_mutation();
DROP TRIGGER IF EXISTS immutable_order_items ON order_items;
CREATE TRIGGER immutable_order_items BEFORE UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION prevent_order_mutation();
