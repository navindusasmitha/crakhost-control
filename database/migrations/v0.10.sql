-- CrakHost Control v0.10: stability defaults
-- Keep Minecraft templates console-ready. docker-minecraft-server generates a random RCON password when none is supplied.
UPDATE server_templates
SET environment = COALESCE(environment,'{}'::jsonb) || '{"ENABLE_RCON":"TRUE"}'::jsonb
WHERE image='itzg/minecraft-server:latest';
