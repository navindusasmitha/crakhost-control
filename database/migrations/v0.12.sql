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
