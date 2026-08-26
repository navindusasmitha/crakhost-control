-- CrakHost Control v0.58.4 public uptime history
-- Stores lightweight per-component samples used by the public status page.
CREATE TABLE IF NOT EXISTS status_component_snapshots (
  id bigserial PRIMARY KEY,
  component_id varchar(80) NOT NULL,
  status varchar(20) NOT NULL CHECK(status IN ('operational','degraded','outage','maintenance')),
  detail varchar(255) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_component_snapshots_component_created
  ON status_component_snapshots(component_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_component_snapshots_created
  ON status_component_snapshots(created_at DESC);
