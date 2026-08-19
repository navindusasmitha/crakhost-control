-- CrakHost Control v0.6 major business/services update
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS api_token text NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS capacity_memory_mb integer NOT NULL DEFAULT 32768;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS capacity_disk_mb integer NOT NULL DEFAULT 250000;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS capacity_cpu numeric(6,2) NOT NULL DEFAULT 8;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS agent_version varchar(40) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS server_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(80) UNIQUE NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(255) NOT NULL DEFAULT '',
  image text NOT NULL,
  internal_port integer NOT NULL DEFAULT 25565,
  environment jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO server_templates(slug,name,description,image,internal_port,environment)
VALUES
('minecraft','Minecraft Java','Managed Java server using itzg/minecraft-server','itzg/minecraft-server:latest',25565,'{"EULA":"TRUE"}'::jsonb)
ON CONFLICT(slug) DO UPDATE SET name=excluded.name,description=excluded.description,image=excluded.image,internal_port=excluded.internal_port,environment=excluded.environment;

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(80) UNIQUE NOT NULL,
  name varchar(120) NOT NULL,
  memory_mb integer NOT NULL,
  cpu_limit numeric(6,2) NOT NULL,
  disk_mb integer NOT NULL,
  price_monthly numeric(12,2) NOT NULL,
  currency varchar(8) NOT NULL DEFAULT 'LKR',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plans(slug,name,memory_mb,cpu_limit,disk_mb,price_monthly,currency) VALUES
('starter','Starter',2048,1,15000,1490,'LKR'),
('performance','Performance',4096,2,30000,2490,'LKR'),
('pro','Pro',8192,4,60000,4490,'LKR')
ON CONFLICT(slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,
  server_id uuid REFERENCES servers(id) ON DELETE SET NULL,
  status varchar(24) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','PROVISIONING','ACTIVE','CANCELLED','FAILED')),
  amount numeric(12,2) NOT NULL,
  currency varchar(8) NOT NULL DEFAULT 'LKR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL,
  body text NOT NULL DEFAULT '',
  kind varchar(30) NOT NULL DEFAULT 'info',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at DESC);

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS last_error text NOT NULL DEFAULT '';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS run_count bigint NOT NULL DEFAULT 0;

ALTER TABLE server_databases ADD COLUMN IF NOT EXISTS database_name varchar(80);
ALTER TABLE server_databases ADD COLUMN IF NOT EXISTS password_cipher text NOT NULL DEFAULT '';
ALTER TABLE server_databases ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'READY';
UPDATE server_databases SET database_name=name WHERE database_name IS NULL;
