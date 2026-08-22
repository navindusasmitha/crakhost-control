# CrakHost v0.27 Runtime Verification

This release treats unavailable data as unavailable; it must not replace node failures with demo metrics.

## Verified production base before v0.27
- Panel HTTP endpoint on `127.0.0.1:4310` returns 200.
- PostgreSQL is healthy.
- Redis is running.
- CrakNode is healthy.
- Panel container can reach `http://craknode:8088/health`.

## v0.27 functional gate
1. Server status must come from the server's assigned CrakNode.
2. Offline/unreachable node must return `node_offline` with null metrics, never fake CPU/RAM values.
3. Start, stop, restart and kill must require server console permission and return useful HTTP errors.
4. CrakNode calls must have a finite timeout.
5. Files, console/logs, backups, databases, allocations, schedules, startup, settings and subusers must be exercised against a real provisioned server before merge.
6. Checkout must create one order and at most one server per successful payment.
7. Admin retry must never provision an unpaid/refunded order.
8. Production build gate must be green before merge.
