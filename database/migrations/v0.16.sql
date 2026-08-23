-- CrakHost Control v0.43 backend hardening
-- New nodes must report or receive explicit capacity; schema defaults must never invent capacity.
ALTER TABLE nodes ALTER COLUMN enabled SET DEFAULT false;
ALTER TABLE nodes ALTER COLUMN capacity_memory_mb SET DEFAULT 0;
ALTER TABLE nodes ALTER COLUMN capacity_disk_mb SET DEFAULT 0;
ALTER TABLE nodes ALTER COLUMN capacity_cpu SET DEFAULT 0;
ALTER TABLE nodes ALTER COLUMN agent_version TYPE varchar(60);

-- Remove the original development-only workload from databases that still contain it.
DELETE FROM servers
WHERE identifier='minecraft-production'
  AND container_name='crakhost-minecraft-production';

DELETE FROM nodes n
WHERE n.name='LOCAL-DEV-01'
  AND NOT EXISTS (
    SELECT 1 FROM servers s
    WHERE s.node_id=n.id AND s.status<>'deleted'
  );
