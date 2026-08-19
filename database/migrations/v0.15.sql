-- CrakHost Control v0.15 business/storefront
ALTER TABLE plans ADD COLUMN IF NOT EXISTS description varchar(255) NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS template_slug varchar(80) NOT NULL DEFAULT 'minecraft';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;

UPDATE plans SET description='Entry Minecraft hosting with automatic provisioning',template_slug='minecraft',sort_order=10 WHERE slug='starter';
UPDATE plans SET description='Balanced Minecraft hosting for communities',template_slug='minecraft',featured=true,sort_order=20 WHERE slug='performance';
UPDATE plans SET description='High performance game hosting',template_slug='minecraft',sort_order=30 WHERE slug='pro';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method varchar(40) NOT NULL DEFAULT 'wallet';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS provisioned_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status,created_at DESC);
