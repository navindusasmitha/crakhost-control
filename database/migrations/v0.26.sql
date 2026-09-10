-- CrakHost Control v0.60.0 smart placement + bounded auto recovery

ALTER TABLE servers ADD COLUMN IF NOT EXISTS desired_state varchar(16) NOT NULL DEFAULT 'stopped';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS recovery_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS last_recovery_at timestamptz;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS recovery_failures integer NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS recovery_suppressed_until timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='servers_desired_state_check'
      AND conrelid='servers'::regclass
  ) THEN
    ALTER TABLE servers
      ADD CONSTRAINT servers_desired_state_check
      CHECK(desired_state IN ('running','stopped'));
  END IF;
END $$;

-- Preserve existing operator intent conservatively: only workloads already recorded as
-- running opt in to the running desired state. Existing stopped workloads stay stopped.
UPDATE servers
SET desired_state='running'
WHERE status='running' AND desired_state='stopped' AND suspended=false;

CREATE INDEX IF NOT EXISTS idx_servers_auto_recovery
  ON servers(recovery_enabled,desired_state,recovery_suppressed_until)
  WHERE status<>'deleted' AND suspended=false;
