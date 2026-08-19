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
