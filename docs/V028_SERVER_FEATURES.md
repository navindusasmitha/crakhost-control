# v0.28 Server Features Overhaul

This release continues the real-data migration of the client server workspace.

## First batch
- File manager now preserves authorization errors, validates write payloads, disables caching, rejects null-byte paths, and refuses root deletion.
- Backups expose no-store real database state and reliably mark a backup FAILED when CrakNode creation fails.
- Network allocations now show only the current server's allocations plus unassigned capacity instead of allocations belonging to other servers.
- Allocation deletion validates the identifier and returns 404 when no allocation belonging to the server was removed.
- Allocation creation uses the server primary IP as the default rather than blindly storing 0.0.0.0.

## Remaining release gate
Console/log streaming, databases, schedules, startup/settings, subusers, backup restore/delete and the client workspace UI must be reviewed before production merge.
