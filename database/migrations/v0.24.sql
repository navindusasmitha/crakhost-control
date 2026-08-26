-- CrakHost Control v0.58.8 public status minute-history storage repair
-- v0.58.7 surfaced a production schema mismatch where status samples could not be inserted.
-- This migration repairs the existing table in place and verifies the exact INSERT shape used by the panel.

CREATE TABLE IF NOT EXISTS status_component_snapshots (
  id bigserial PRIMARY KEY,
  component_id varchar(80) NOT NULL,
  status varchar(20) NOT NULL CHECK(status IN ('operational','degraded','outage','maintenance')),
  detail varchar(255) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE status_component_snapshots ADD COLUMN IF NOT EXISTS component_id varchar(80);
ALTER TABLE status_component_snapshots ADD COLUMN IF NOT EXISTS status varchar(20);
ALTER TABLE status_component_snapshots ADD COLUMN IF NOT EXISTS detail varchar(255) DEFAULT '';
ALTER TABLE status_component_snapshots ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE status_component_snapshots ADD COLUMN IF NOT EXISTS id bigint;

CREATE SEQUENCE IF NOT EXISTS status_component_snapshots_id_seq;
ALTER SEQUENCE status_component_snapshots_id_seq OWNED BY status_component_snapshots.id;
ALTER TABLE status_component_snapshots
  ALTER COLUMN id SET DEFAULT nextval('status_component_snapshots_id_seq'::regclass);

UPDATE status_component_snapshots
SET id=nextval('status_component_snapshots_id_seq'::regclass)
WHERE id IS NULL;

SELECT setval(
  'status_component_snapshots_id_seq'::regclass,
  GREATEST(COALESCE((SELECT max(id) FROM status_component_snapshots),0)+1,1),
  false
);

UPDATE status_component_snapshots SET component_id=left(coalesce(component_id,'unknown'),80) WHERE component_id IS NULL OR component_id='';
UPDATE status_component_snapshots SET status='degraded' WHERE status IS NULL OR status NOT IN ('operational','degraded','outage','maintenance');
UPDATE status_component_snapshots SET detail='' WHERE detail IS NULL;
UPDATE status_component_snapshots SET created_at=now() WHERE created_at IS NULL;

ALTER TABLE status_component_snapshots ALTER COLUMN id SET NOT NULL;
ALTER TABLE status_component_snapshots ALTER COLUMN component_id SET NOT NULL;
ALTER TABLE status_component_snapshots ALTER COLUMN status SET NOT NULL;
ALTER TABLE status_component_snapshots ALTER COLUMN detail SET NOT NULL;
ALTER TABLE status_component_snapshots ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE status_component_snapshots ALTER COLUMN detail SET DEFAULT '';
ALTER TABLE status_component_snapshots ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_status_component_snapshots_component_created
  ON status_component_snapshots(component_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_component_snapshots_created
  ON status_component_snapshots(created_at DESC);

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE status_component_snapshots TO crakhost;
GRANT USAGE,SELECT,UPDATE ON SEQUENCE status_component_snapshots_id_seq TO crakhost;

-- Production smoke test. It deliberately mirrors recordPublicStatusSample() and is deleted immediately.
DO $$
DECLARE
  probe_id bigint;
BEGIN
  INSERT INTO status_component_snapshots(component_id,status,detail,created_at)
  VALUES('__v0588_probe__','operational','v0.58.8 storage verification',now())
  RETURNING id INTO probe_id;

  IF probe_id IS NULL THEN
    RAISE EXCEPTION 'status snapshot INSERT returned no id';
  END IF;

  DELETE FROM status_component_snapshots WHERE component_id='__v0588_probe__';
END $$;
