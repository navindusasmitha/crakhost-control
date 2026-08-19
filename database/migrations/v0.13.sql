-- CrakHost Control v0.13 production
ALTER TABLE server_templates ADD COLUMN IF NOT EXISTS game_type varchar(30) NOT NULL DEFAULT 'generic';
ALTER TABLE server_templates ADD COLUMN IF NOT EXISTS required_secret varchar(80) NOT NULL DEFAULT '';
INSERT INTO server_templates(slug,name,description,image,internal_port,environment,game_type,required_secret)
VALUES
('minecraft-java','Minecraft Java','Production Minecraft Java','itzg/minecraft-server:latest',25565,'{"EULA":"TRUE","TYPE":"PAPER"}'::jsonb,'minecraft',''),
('fivem','FiveM FXServer','Production FiveM FXServer','spritsail/fivem:latest',30120,'{}'::jsonb,'fivem','FIVEM_LICENSE_KEY')
ON CONFLICT(slug) DO UPDATE SET name=excluded.name,description=excluded.description,image=excluded.image,internal_port=excluded.internal_port,environment=excluded.environment,game_type=excluded.game_type,required_secret=excluded.required_secret;
CREATE TABLE IF NOT EXISTS deployment_settings(id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),panel_domain varchar(255) NOT NULL DEFAULT '',panel_email varchar(255) NOT NULL DEFAULT '',github_repo varchar(255) NOT NULL DEFAULT '',release_channel varchar(30) NOT NULL DEFAULT 'stable',auto_update boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO deployment_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS update_history(id bigserial PRIMARY KEY,version varchar(40) NOT NULL,status varchar(30) NOT NULL,detail text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
