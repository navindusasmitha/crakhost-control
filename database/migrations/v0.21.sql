-- CrakHost Control v0.49 account moderation + admin commerce
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason varchar(255) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_users_banned_at ON users(banned_at) WHERE banned_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plans_enabled_sort ON plans(enabled,sort_order,price_monthly);
