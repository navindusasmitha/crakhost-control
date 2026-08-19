-- CrakHost Control v0.14 real-production cleanup
-- Remove only the legacy demo server/node seeded by early development versions.
DELETE FROM servers
WHERE identifier='minecraft-production'
  AND container_name='crakhost-minecraft-production'
  AND primary_ip='127.0.0.1'
  AND primary_port=25565;

DELETE FROM nodes
WHERE name='LOCAL-DEV-01'
  AND location='Local Docker Desktop';

-- Production node is inserted/updated by install.sh because its hostname/token are runtime values.
