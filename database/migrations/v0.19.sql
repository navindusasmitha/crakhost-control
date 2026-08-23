-- CrakHost Control v0.47 CrakMail self-hosted mail platform
CREATE TABLE IF NOT EXISTS mail_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain varchar(255) NOT NULL UNIQUE,
  hostname varchar(255) NOT NULL,
  dkim_selector varchar(80) NOT NULL DEFAULT 'mail',
  enabled boolean NOT NULL DEFAULT true,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_domains_domain_lower CHECK(domain = lower(domain)),
  CONSTRAINT mail_domains_hostname_lower CHECK(hostname = lower(hostname))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_domains_one_primary
  ON mail_domains(is_primary) WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES mail_domains(id) ON DELETE CASCADE,
  email varchar(320) NOT NULL UNIQUE,
  local_part varchar(128) NOT NULL,
  display_name varchar(160) NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  quota_mb integer NOT NULL DEFAULT 1024 CHECK(quota_mb BETWEEN 64 AND 102400),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailboxes_email_lower CHECK(email = lower(email)),
  CONSTRAINT mailboxes_local_part_lower CHECK(local_part = lower(local_part))
);
CREATE INDEX IF NOT EXISTS idx_mailboxes_domain_enabled ON mailboxes(domain_id,enabled);

CREATE TABLE IF NOT EXISTS mail_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES mail_domains(id) ON DELETE CASCADE,
  source varchar(320) NOT NULL UNIQUE,
  destination varchar(320) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_aliases_source_lower CHECK(source = lower(source)),
  CONSTRAINT mail_aliases_destination_lower CHECK(destination = lower(destination))
);
CREATE INDEX IF NOT EXISTS idx_mail_aliases_domain_enabled ON mail_aliases(domain_id,enabled);
