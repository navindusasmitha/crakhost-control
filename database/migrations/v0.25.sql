-- CrakHost Control v0.58.9 status collector schema contract verification
-- The v0.24 migration introduced one row per component/minute using bucket_at.
-- This smoke test intentionally matches the application collector SQL so a deploy
-- cannot report success while minute-history writes are broken.

DO $$
DECLARE
  probe_component text := '__crakhost_status_probe__';
  probe_bucket timestamptz := date_trunc('minute', now());
BEGIN
  IF to_regclass('public.status_component_snapshots') IS NULL THEN
    RAISE EXCEPTION 'status_component_snapshots table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='status_component_snapshots' AND column_name='bucket_at'
  ) THEN
    RAISE EXCEPTION 'status_component_snapshots.bucket_at is missing';
  END IF;

  INSERT INTO status_component_snapshots(component_id,bucket_at,status,detail,created_at)
  VALUES(probe_component,probe_bucket,'operational','migration smoke test',now())
  ON CONFLICT(component_id,bucket_at) DO UPDATE
    SET status=excluded.status,detail=excluded.detail,created_at=excluded.created_at;

  DELETE FROM status_component_snapshots WHERE component_id=probe_component;
END $$;
