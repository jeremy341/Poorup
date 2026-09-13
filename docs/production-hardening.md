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
POORUP_TRUST_PROXY_HOPS=0
POORUP_RELEASE_ID=<commit-sha>
POORUP_MAINTENANCE_MODE=normal
POORUP_MAINTENANCE_TOKEN=<operator-secret>
POORUP_ADMIN_ACCOUNT_IDS=<comma-separated-account-ids>
```

`POORUP_ALLOWED_ORIGINS` is mandatory for browser-origin production traffic.
The HTTP/IP limiter is a process-level second layer; put Cloudflare (or an
equivalent edge WAF) in front of it for distributed rate limiting.

## Backup and restore drill

`server/backupStore.js` rotates checksummed copies without touching the live
files. Operators should verify a recent `.sha256`, restore into a staging data
directory, boot the server with that directory, and confirm account/session,
room-list, season, and cosmetic reads before promoting the directory.

PostgreSQL is the next migration gate before horizontal scaling. A non-empty
`POORUP_POSTGRES_URL` is not sufficient: production must also set
`POORUP_PERSISTENCE_ADAPTER=postgres` after the transactional adapter and its
health checks are deployed. The provider-neutral interfaces in
`server/authoritativeStore.js` and `server/pubsubAdapter.js` keep that
migration independent from GameState and Socket.IO contracts; their JSON and
in-process implementations are single-process adapters only.

## Health and maintenance

`GET /healthz` reports process liveness. `GET /readyz` reports whether the
instance accepts new rooms and rounds, plus the bounded active-round count and
release ID. Both responses contain no account or game-private data.

`POST /internal/maintenance` is operator-only and requires the
`x-poorup-maintenance-token` header. Its JSON body accepts `normal`, `draining`,
or `maintenance`. Draining rejects new rooms, Quick Tables, and round starts
while existing rounds continue. The deployment runbook waits for
`activeRounds = 0` before switching releases.

## Nest deployment

Development and testing use immutable release directories with PM2. The live
beta deployment is promoted from a clean `main` SHA by GitHub Actions after CI
passes. Persistent data and backups live outside the release directory. The
runtime account is a dedicated unprivileged `poorup` user; secrets are host
environment values only. Rollback switches the active release pointer back to
the previous verified SHA.

The deploy workflow is fail-closed until the repository variable
`NEST_DEPLOY_ENABLED=true` and all `nest-production` environment secrets are
configured. This keeps normal main CI green while the one-time Nest bootstrap
is still pending.
