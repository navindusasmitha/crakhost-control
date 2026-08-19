CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  email varchar(255) UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role varchar(20) NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','ADMIN','SUPPORT')),
  credits numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) UNIQUE NOT NULL,
  location varchar(120) NOT NULL,
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id uuid REFERENCES nodes(id) ON DELETE SET NULL,
  name varchar(120) NOT NULL,
  identifier varchar(80) UNIQUE NOT NULL,
  container_name varchar(128) UNIQUE NOT NULL,
  image text NOT NULL DEFAULT 'itzg/minecraft-server:latest',
  cpu_limit numeric(6,2) NOT NULL DEFAULT 2,
  memory_mb integer NOT NULL DEFAULT 4096,
  disk_mb integer NOT NULL DEFAULT 20000,
  primary_ip varchar(64) NOT NULL DEFAULT '127.0.0.1',
  primary_port integer NOT NULL DEFAULT 25565,
  status varchar(30) NOT NULL DEFAULT 'offline',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers(owner_id);

INSERT INTO users(name,email,password_hash,role,credits)
VALUES ('CrakHost Admin','admin@crakhost.local','scrypt$16384$8$1$3Z1QNAQ6XkNWxJoGTwwlGg==$vlJgY49/W+zqggiSEgd1h52I0ZwL91lsXvC7T4aTrSVjRgkxQNCgXgKykfanHG3fuYCbNKLrdlCBqIGNycHayA==','ADMIN',42.50)
ON CONFLICT(email) DO NOTHING;
CREATE TABLE IF NOT EXISTS backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'CREATING' CHECK (status IN ('CREATING','READY','FAILED')),
  size_bytes bigint NOT NULL DEFAULT 0,
  remote_path text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backups_server ON backups(server_id,created_at DESC);

CREATE TABLE IF NOT EXISTS allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid REFERENCES nodes(id) ON DELETE CASCADE,
  ip varchar(64) NOT NULL DEFAULT '0.0.0.0',
  port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
  server_id uuid REFERENCES servers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(node_id,ip,port)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event varchar(120) NOT NULL,
  subject_type varchar(50),
  subject_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);

INSERT INTO nodes(name,location,base_url,enabled)
VALUES ('LOCAL-DEV-01','Local Docker Desktop','http://localhost:8088',true)
ON CONFLICT(name) DO NOTHING;

INSERT INTO servers(owner_id,node_id,name,identifier,container_name,image,cpu_limit,memory_mb,disk_mb,primary_ip,primary_port,status)
SELECT u.id,n.id,'Minecraft Production','minecraft-production','crakhost-minecraft-production','itzg/minecraft-server:latest',2,2048,20000,'127.0.0.1',25565,'offline'
FROM users u CROSS JOIN nodes n
WHERE u.email='admin@crakhost.local' AND n.name='LOCAL-DEV-01'
ON CONFLICT(identifier) DO NOTHING;


-- v0.5 business foundation
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
-- CrakHost Control v0.8: support, developer API, webhooks, reseller foundation
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('USER','ADMIN','SUPPORT','RESELLER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name varchar(160) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reseller_discount numeric(5,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject varchar(180) NOT NULL,
  priority varchar(20) NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ANSWERED','CUSTOMER_REPLY','CLOSED')),
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  staff_reply boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id,created_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  token_prefix varchar(16) NOT NULL,
  token_hash char(64) UNIQUE NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['servers:read']::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT ARRAY['server.status']::text[],
  enabled boolean NOT NULL DEFAULT true,
  last_status integer,
  last_error text NOT NULL DEFAULT '',
  last_delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event varchar(80) NOT NULL,
  response_status integer,
  success boolean NOT NULL DEFAULT false,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reseller_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reseller_id, customer_id)
);

-- CrakHost Control v0.9: API reliability, auditing and rate-limit foundation
CREATE TABLE IF NOT EXISTS api_request_log (
  id bigserial PRIMARY KEY,
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method varchar(12) NOT NULL,
  path varchar(240) NOT NULL,
  status integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_request_log_key_time ON api_request_log(api_key_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_log_user_time ON api_request_log(user_id,created_at DESC);
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
-- CrakHost Control v0.11 operations + safer upgrades
CREATE TABLE IF NOT EXISTS system_settings (
  key varchar(120) PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  from_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  initiated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_server_transfers_server ON server_transfers(server_id,created_at DESC);

CREATE TABLE IF NOT EXISTS node_health_snapshots (
  id bigserial PRIMARY KEY,
  node_id uuid REFERENCES nodes(id) ON DELETE CASCADE,
  status varchar(30) NOT NULL,
  latency_ms integer,
  docker_version varchar(80) NOT NULL DEFAULT '',
  managed_containers integer NOT NULL DEFAULT 0,
  running_containers integer NOT NULL DEFAULT 0,
  disk_free_bytes bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_node_health_recent ON node_health_snapshots(node_id,created_at DESC);

INSERT INTO system_settings(key,value)
VALUES ('operations', '{"maintenanceMode":false,"maintenanceMessage":"Scheduled maintenance in progress.","healthRetentionDays":14}'::jsonb)
ON CONFLICT(key) DO NOTHING;


-- CrakHost Control v0.12 infrastructure + security
ALTER TABLE users ADD COLUMN IF NOT EXISTS reseller_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('USER','ADMIN','SUPPORT','RESELLER'));

CREATE TABLE IF NOT EXISTS database_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) UNIQUE NOT NULL,
  engine varchar(24) NOT NULL CHECK(engine IN ('postgres','mysql','mariadb')),
  host varchar(255) NOT NULL,
  port integer NOT NULL,
  username varchar(120) NOT NULL,
  password_enc text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smtp_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
  host varchar(255) NOT NULL DEFAULT '',
  port integer NOT NULL DEFAULT 587,
  username varchar(255) NOT NULL DEFAULT '',
  password_enc text NOT NULL DEFAULT '',
  from_email varchar(255) NOT NULL DEFAULT '',
  from_name varchar(120) NOT NULL DEFAULT 'CrakHost',
  secure boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO smtp_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS server_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  source_node_id uuid REFERENCES nodes(id) ON DELETE SET NULL,
  target_node_id uuid REFERENCES nodes(id) ON DELETE SET NULL,
  status varchar(24) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PREPARING','TRANSFERRING','VERIFYING','COMPLETED','FAILED')),
  progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  detail text NOT NULL DEFAULT '',
  initiated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_server_migrations_server ON server_migrations(server_id,created_at DESC);

CREATE TABLE IF NOT EXISTS sftp_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username varchar(120) UNIQUE NOT NULL,
  password_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(server_id,user_id)
);

INSERT INTO system_settings(key,value)
VALUES ('security','{"require2FAForStaff":false,"sessionDays":30,"sftpEnabled":false,"smtpEnabled":false}'::jsonb)
ON CONFLICT(key) DO NOTHING;

-- CrakHost Control v0.13 production
ALTER TABLE server_templates ADD COLUMN IF NOT EXISTS game_type varchar(30) NOT NULL DEFAULT 'generic';
ALTER TABLE server_templates ADD COLUMN IF NOT EXISTS required_secret varchar(80) NOT NULL DEFAULT '';
INSERT INTO server_templates(slug,name,description,image,internal_port,environment,game_type,required_secret)
VALUES
('minecraft-java','Minecraft Java','Production Minecraft Java','itzg/minecraft-server:latest',25565,'{"EULA":"TRUE","TYPE":"PAPER"}'::jsonb,'minecraft',''),
('fivem','FiveM FXServer','Production FiveM FXServer','spritsail/fivem:latest',30120,'{}'::jsonb,'fivem','FIVEM_LICENSE_KEY')
ON CONFLICT(slug) DO UPDATE SET name=excluded.name,description=excluded.description,image=excluded.image,internal_port=excluded.internal_port,environment=excluded.environment,game_type=excluded.game_type,required_secret=excluded.required_secret;
CREATE TABLE IF NOT EXISTS deployment_settings(id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),panel_domain varchar(255) NOT NULL DEFAULT '',panel_email varchar(255) NOT NULL DEFAULT '',github_repo varchar(255) NOT NULL DEFAULT '',release_channel varchar(30) NOT NULL DEFAULT 'stable',auto_update boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO deployment_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS update_history(id bigserial PRIMARY KEY,version varchar(40) NOT NULL,status varchar(30) NOT NULL,detail text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
