# v0.27 First Stability Slice

- Docker-network fallback for CrakNode changed from localhost to `http://craknode:8088`.
- CrakNode requests now have a configurable timeout (`CRAKNODE_TIMEOUT_MS`, default 10 seconds).
- Authorization header is omitted when no token is configured.
- Server-specific node routing rejects unknown identifiers instead of silently using fallback.
- Lifecycle action API uses shared auth/error mapping and validates malformed request bodies.
- Status API is explicitly no-store and no longer reports zero/fake resource metrics when a node is unreachable.
