-- CrakHost Control v0.50 commerce reliability

-- A browser/network retry must never create a second paid order for the same checkout attempt.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key varchar(160);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency
  ON orders(user_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key<>'';

-- Renewal invoices need an explicit service link so a suspended service can pay the
-- existing due invoice instead of creating a second paid invoice on recovery.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS server_id uuid REFERENCES servers(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS kind varchar(24) NOT NULL DEFAULT 'ORDER';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS period_start timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS period_end timestamptz;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK(status IN ('DRAFT','DUE','PAID','VOID','REFUNDED'));

CREATE INDEX IF NOT EXISTS idx_invoices_server_created
  ON invoices(server_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_open_renewal_server
  ON invoices(server_id)
  WHERE server_id IS NOT NULL AND status='DUE' AND kind='RENEWAL';
