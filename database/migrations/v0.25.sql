-- CrakHost Control v0.58.9 deterministic public uptime minute-history storage
-- Rebuilds ONLY the short-lived public status snapshot cache once. Customer data,
-- billing, provisioning, backups and workload tables are not touched.

CREATE TABLE IF NOT EXISTS feature_migration_markers (
  key varchar(120) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_migration_markers
    WHERE key='v0.58.9-status-minute-buckets'
  ) THEN
    DROP TABLE IF EXISTS status_component_snapshots_v0589;

    CREATE TABLE status_component_snapshots_v0589 (
      component_id varchar(80) NOT NULL,
      bucket_at timestamptz NOT NULL,
      status varchar(20) NOT NULL CHECK(status IN ('operational','degraded','outage','maintenance')),
      detail varchar(255) NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(component_id,bucket_at)
    );

    IF to_regclass('public.status_component_snapshots') IS NOT NULL THEN
      INSERT INTO status_component_snapshots_v0589(component_id,bucket_at,status,detail,created_at)
      SELECT DISTINCT ON (component_id,date_trunc('minute',created_at))
        left(component_id::text,80),
        date_trunc('minute',created_at),
        CASE WHEN status::text IN ('operational','degraded','outage','maintenance') THEN status::text ELSE 'degraded' END,
        left(coalesce(detail::text,''),255),
        created_at
      FROM status_component_snapshots
      WHERE created_at >= now()-interval '10 minutes'
      ORDER BY component_id,date_trunc('minute',created_at),created_at DESC
      ON CONFLICT(component_id,bucket_at) DO UPDATE
        SET status=excluded.status,detail=excluded.detail,created_at=excluded.created_at;
    END IF;

    DROP TABLE IF EXISTS status_component_snapshots;
    ALTER TABLE status_component_snapshots_v0589 RENAME TO status_component_snapshots;

    CREATE INDEX idx_status_component_snapshots_created
      ON status_component_snapshots(created_at DESC);
    CREATE INDEX idx_status_component_snapshots_bucket
      ON status_component_snapshots(bucket_at DESC);

    INSERT INTO feature_migration_markers(key)
    VALUES('v0.58.9-status-minute-buckets')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE status_component_snapshots TO crakhost;

-- Verify the exact write contract used by recordPublicStatusSample().
DO $$
DECLARE
  probe_component text := '__crakhost_status_probe__';
  probe_bucket timestamptz := date_trunc('minute', now());
BEGIN
  INSERT INTO status_component_snapshots(component_id,bucket_at,status,detail,created_at)
  VALUES(probe_component,probe_bucket,'operational','v0.58.9 collector verification',now())
  ON CONFLICT(component_id,bucket_at) DO UPDATE
    SET status=excluded.status,detail=excluded.detail,created_at=excluded.created_at;

  IF NOT EXISTS (
    SELECT 1 FROM status_component_snapshots
    WHERE component_id=probe_component AND bucket_at=probe_bucket
  ) THEN
    RAISE EXCEPTION 'status snapshot minute-bucket INSERT verification failed';
  END IF;

  DELETE FROM status_component_snapshots WHERE component_id=probe_component;
END $$;
