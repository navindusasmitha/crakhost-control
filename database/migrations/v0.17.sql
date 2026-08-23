-- CrakHost Control v0.45 provisioning safety
DO $$
BEGIN
  ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
  ALTER TABLE invoices
    ADD CONSTRAINT invoices_status_check
    CHECK(status IN ('DRAFT','DUE','PAID','VOID','REFUNDED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_servers_node_active
  ON servers(node_id)
  WHERE status <> 'deleted';

CREATE INDEX IF NOT EXISTS idx_orders_status_updated
  ON orders(status,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_events_type_created
  ON service_events(type,created_at DESC);
