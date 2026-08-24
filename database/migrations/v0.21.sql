-- CrakHost Control v0.49 website + business administration
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_users_banned_at ON users(banned_at) WHERE banned_at IS NOT NULL;
