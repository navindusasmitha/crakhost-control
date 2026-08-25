-- CrakHost Control v0.49 customer moderation
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status varchar(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason varchar(255) NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
  ALTER TABLE users ADD CONSTRAINT users_account_status_check CHECK (account_status IN ('ACTIVE','BANNED','DELETED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status,created_at DESC);
