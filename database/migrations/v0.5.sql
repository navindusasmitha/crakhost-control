ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS description varchar(255) NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS server_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(server_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_server_users_user ON server_users(user_id);

CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  cron varchar(80) NOT NULL DEFAULT '0 4 * * *',
  action varchar(30) NOT NULL CHECK(action IN ('restart','stop','start','backup','command')),
  payload text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedules_server ON schedules(server_id);

CREATE TABLE IF NOT EXISTS server_databases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  username varchar(80) NOT NULL,
  host varchar(255) NOT NULL DEFAULT '127.0.0.1',
  port integer NOT NULL DEFAULT 5432,
  engine varchar(20) NOT NULL DEFAULT 'postgres',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(server_id,name)
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number varchar(40) UNIQUE NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency varchar(8) NOT NULL DEFAULT 'USD',
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','DUE','PAID','VOID')),
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id,created_at DESC);
