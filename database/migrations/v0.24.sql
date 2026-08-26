-- CrakHost Control v0.58.8 public status snapshot storage repair
-- Rebuilds the minute-history table once into a sequence-free, one-row-per-minute schema.
-- Existing compatible samples from the last 10 minutes are preserved.

CREATE TABLE IF NOT EXISTS feature_migration_markers (
  key varchar(120) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM feature_migration_markers
    WHERE key='v0.58.8-status-snapshot-storage-v2'
  ) THEN
    DROP TABLE IF EXISTS status_component_snapshots_v0588;

    CREATE TABLE status_component_snapshots_v0588 (
      component_id varchar(80) NOT NULL,
      bucket_at timestamptz NOT NULL,
      status varchar(20) NOT NULL CHECK(status IN ('operational','degraded','outage','maintenance')),
      detail varchar(255) NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(component_id,bucket_at)
    );

    IF to_regclass('public.status_component_snapshots') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='status_component_snapshots' AND column_name='component_id')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='status_component_snapshots' AND column_name='status')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='status_component_snapshots' AND column_name='created_at') THEN
      EXECUTE $copy$
        INSERT INTO status_component_snapshots_v0588(component_id,bucket_at,status,detail,created_at)
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
          SET status=excluded.status,detail=excluded.detail,created_at=excluded.created_at
      $copy$;
    END IF;

    DROP TABLE IF EXISTS status_component_snapshots;
    ALTER TABLE status_component_snapshots_v0588 RENAME TO status_component_snapshots;

    CREATE INDEX idx_status_component_snapshots_created
      ON status_component_snapshots(created_at DESC);
    CREATE INDEX idx_status_component_snapshots_bucket
      ON status_component_snapshots(bucket_at DESC);

    INSERT INTO feature_migration_markers(key)
    VALUES('v0.58.8-status-snapshot-storage-v2')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
