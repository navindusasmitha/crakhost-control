-- CrakHost Control v0.11 operations + safer upgrades
CREATE TABLE IF NOT EXISTS system_settings (
  key varchar(120) PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  from_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  initiated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_server_transfers_server ON server_transfers(server_id,created_at DESC);

CREATE TABLE IF NOT EXISTS node_health_snapshots (
  id bigserial PRIMARY KEY,
  node_id uuid REFERENCES nodes(id) ON DELETE CASCADE,
  status varchar(30) NOT NULL,
  latency_ms integer,
  docker_version varchar(80) NOT NULL DEFAULT '',
  managed_containers integer NOT NULL DEFAULT 0,
  running_containers integer NOT NULL DEFAULT 0,
  disk_free_bytes bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_node_health_recent ON node_health_snapshots(node_id,created_at DESC);

INSERT INTO system_settings(key,value)
VALUES ('operations', '{"maintenanceMode":false,"maintenanceMessage":"Scheduled maintenance in progress.","healthRetentionDays":14}'::jsonb)
ON CONFLICT(key) DO NOTHING;
