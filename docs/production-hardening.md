# Poorup production hardening

Poorup remains one modular monolith. The authoritative room state stays in
memory for a single process, while account, social, match, achievement,
season, cosmetic, and telemetry projections use atomic JSON stores.

## Required production variables

```text
NODE_ENV=production
POORUP_ALLOWED_ORIGINS=https://play.example.com
POORUP_DATA_DIR=/var/lib/poorup
POORUP_BACKUP_DIR=/var/backups/poorup
POORUP_BACKUP_INTERVAL_MS=900000
POORUP_HTTP_RATE_LIMIT=240
POORUP_HTTP_RATE_WINDOW_MS=60000
POORUP_SOCKET_RATE_LIMIT=120
POORUP_SOCKET_RATE_WINDOW_MS=60000
```

`POORUP_ALLOWED_ORIGINS` is mandatory for browser-origin production traffic.
The HTTP/IP limiter is a process-level second layer; put Cloudflare (or an
equivalent edge WAF) in front of it for distributed rate limiting.

## Backup and restore drill

`server/backupStore.js` rotates checksummed copies without touching the live
files. Operators should verify a recent `.sha256`, restore into a staging data
directory, boot the server with that directory, and confirm account/session,
room-list, season, and cosmetic reads before promoting the directory.

PostgreSQL is the next migration gate before horizontal scaling. The store
interfaces are intentionally small so the JSON adapter can be replaced with a
transactional adapter without changing GameState or socket contracts.
