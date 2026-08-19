CREATE TABLE IF NOT EXISTS backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'CREATING' CHECK (status IN ('CREATING','READY','FAILED')),
  size_bytes bigint NOT NULL DEFAULT 0,
  remote_path text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backups_server ON backups(server_id,created_at DESC);

CREATE TABLE IF NOT EXISTS allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid REFERENCES nodes(id) ON DELETE CASCADE,
  ip varchar(64) NOT NULL DEFAULT '0.0.0.0',
  port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
  server_id uuid REFERENCES servers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(node_id,ip,port)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event varchar(120) NOT NULL,
  subject_type varchar(50),
  subject_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);

INSERT INTO nodes(name,location,base_url,enabled)
VALUES ('LOCAL-DEV-01','Local Docker Desktop','http://localhost:8088',true)
ON CONFLICT(name) DO NOTHING;

INSERT INTO servers(owner_id,node_id,name,identifier,container_name,image,cpu_limit,memory_mb,disk_mb,primary_ip,primary_port,status)
SELECT u.id,n.id,'Minecraft Production','minecraft-production','crakhost-minecraft-production','itzg/minecraft-server:latest',2,2048,20000,'127.0.0.1',25565,'offline'
FROM users u CROSS JOIN nodes n
WHERE u.email='admin@crakhost.local' AND n.name='LOCAL-DEV-01'
ON CONFLICT(identifier) DO NOTHING;
