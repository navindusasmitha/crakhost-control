-- CrakHost Control v0.7 commerce + lifecycle update
ALTER TABLE servers ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS billing_status varchar(24) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS next_due_at timestamptz;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE server_templates ADD COLUMN IF NOT EXISTS startup_command text NOT NULL DEFAULT '';
ALTER TABLE server_templates ADD COLUMN IF NOT EXISTS category varchar(60) NOT NULL DEFAULT 'Game Servers';
ALTER TABLE server_templates ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  type varchar(24) NOT NULL CHECK(type IN ('CREDIT','DEBIT','REFUND','ADJUSTMENT')),
  description varchar(255) NOT NULL DEFAULT '',
  reference_type varchar(40),
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id,created_at DESC);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description varchar(255) NOT NULL DEFAULT '';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS template_slug varchar(80) NOT NULL DEFAULT 'minecraft';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS server_name varchar(120) NOT NULL DEFAULT 'Hosted Server';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS node_id uuid REFERENCES nodes(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS primary_port integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS failure_reason text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS service_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_events_server ON service_events(server_id,created_at DESC);
