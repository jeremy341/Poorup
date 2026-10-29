# Poorup production hardening

Poorup remains one modular monolith. The authoritative room state stays in
memory for a single process, while account, social, match, achievement,
season, cosmetic, and telemetry projections use atomic JSON stores.

Current feature status, evidence paths, and policy-gated surfaces are tracked
in [`docs/feature-status.json`](feature-status.json). This runbook does not
invent an operator identity, retention period, legal copy, canonical hostname,
preview artwork approval, or production adapter credentials.

## Required production variables

```text
NODE_ENV=production
POORUP_ALLOWED_ORIGINS=<approved-https-origin>
POORUP_PUBLIC_ORIGIN=<approved-https-origin>
POORUP_DATA_DIR=/var/lib/poorup
POORUP_BACKUP_DIR=/var/backups/poorup
POORUP_BACKUP_INTERVAL_MS=900000
POORUP_HTTP_RATE_LIMIT=240
POORUP_HTTP_RATE_WINDOW_MS=60000
POORUP_SOCKET_RATE_LIMIT=120
POORUP_SOCKET_RATE_WINDOW_MS=60000
POORUP_SOCKET_MAX_CONNECTIONS=2000
POORUP_SOCKET_HANDSHAKE_RATE=120
POORUP_SOCKET_HANDSHAKE_WINDOW_MS=60000
POORUP_TRUST_PROXY_HOPS=0
POORUP_RELEASE_ID=<commit-sha>
POORUP_MAINTENANCE_MODE=normal
POORUP_MAINTENANCE_TOKEN=<operator-secret>
POORUP_ADMIN_ACCOUNT_IDS=<comma-separated-account-ids>
POORUP_AI_CONFIG_KEY=<32+ character secret used to encrypt admin provider profiles>
POORUP_MAIL_API_URL=<provider-neutral transactional mail endpoint>
POORUP_MAIL_API_KEY=<mail provider secret>
POORUP_MAIL_FROM=<verified sender address>
POORUP_COOKIE_SECURE=true
POORUP_ANALYTICS_PSEUDONYM_KEY=<stable aggregate-only HMAC key>
```

`POORUP_ALLOWED_ORIGINS` is mandatory for browser-origin production traffic.
The HTTP/IP limiter is a process-level second layer; put Cloudflare (or an
equivalent edge WAF) in front of it for distributed rate limiting.

`POORUP_DATA_DIR` and `POORUP_BACKUP_DIR` must be absolute paths outside the
application directory. With `NODE_ENV=production` the server refuses to start
when either is unset, relative, or inside the release directory, and it names
the variable in the error. Every deploy replaces the release directory, so a
store kept there is deleted by the next release. Relative values are resolved
to absolute paths at boot in every environment.

The internal `/admin/analytics?admin=provider` surface stores provider
profiles in `POORUP_DATA_DIR/ai-providers.json`. `POORUP_AI_CONFIG_KEY` is
required for durable encrypted API-key storage; without it, provider profiles
remain memory-only. The optional `POORUP_AI_API_KEY`, `POORUP_AI_BASE_URL`,
`POORUP_AI_MODEL`, and `POORUP_AI_PROTOCOL` variables bootstrap a read-only
environment profile. Legacy `DEEPSEEK_*` variables remain supported.

Bankruptcy is one authoritative lifecycle: an open payment may be rescued through
selling, mortgaging, trading, or borrowing, but `END TURN` stays blocked until the
payment is settled. Choosing bankruptcy eliminates the seat; a human remains as a
read-only spectator until leaving the table. The legacy `bankruptMode=debt` setting is
normalized to elimination for snapshot compatibility and no longer keeps a seat active.

Game end has two authoritative paths. The last connected solvent seat wins outright,
as before. A table that is still running after `ROUND_LIMIT` rounds (300, in
`server/gameData.js`) ends through the same `endGame` path with the richest solvent
seat as winner. Richest means net worth: cash, deed face value (half while mortgaged),
buildings at half build cost, less open debt. A tie goes to the seat earlier in turn
order. The result carries `lastEndReason: 'round-limit'`, and the feed warns at round
250 and round 290. The limit stops endless endgames when a poor seat stays solvent
on the catch-up bonus. It needs at least two solvent seats, so it never overrides a
bankruptcy that already leaves one.

## Backup and restore drill

`server/backupStore.js` writes checksummed copies of every JSON store every
`POORUP_BACKUP_INTERVAL_MS` without touching the live files. Each copy has a
`.sha256` sidecar. Retention is tiered per store:

- the newest 7 verified copies always survive;
- beyond those, the newest copy of each UTC hour survives for 48 hours;
- beyond those, the newest copy of each UTC day survives for 30 days.

Copies older than 30 days are pruned by the retention job
(`POORUP_RETENTION_BACKUPS_MS`). Two guards protect the good copies:

- A store quarantined as corrupt at load is not copied until the server
  restarts, because its in-memory replacement is empty. The skip is logged on
  every backup run.
- If a live store is under half the size of a copy taken in the last 48 hours,
  rotation pauses and every older copy is kept. The candidate is still written
  and a warning is logged once. The pause ends when that large copy leaves the
  48-hour window, so an intentional large purge is accepted later.

The backup set covers the account, social, match, achievement, season,
cosmetic, telemetry, analytics-rollup, and AI-provider stores. Sessions and
single-use recovery tokens are not backed up: restoring them would revive
revoked sessions and consumed tokens.

Restore drill:

1. List copies and their verification state:
   `node scripts/restore-backup.mjs --backup-dir <dir> --store accounts --list`.
2. Restore the newest verified copy, or the newest one at or before a time, into
   a staging directory:
   `node scripts/restore-backup.mjs --backup-dir <dir> --store accounts --at 2026-10-11T12:00:00Z --to <staging-dir>`.
   The tool refuses to overwrite an existing file without `--force`, refuses
   a corrupt copy instead of falling back silently, and refuses to write into
   `POORUP_DATA_DIR` unless `--to` is that exact directory and `--force` is set.
3. Repeat for each store. Boot the server against the staging directory and
   confirm account/session, room-list, season, and cosmetic reads before
   promoting it. Stop the server before restoring into a live data directory.

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

## Account rights lifecycle

The Profile account surface now exposes an owner-safe export, other-session
revocation, verified recovery-email setup, and deletion/cancellation. Deletion
requires the current password and the exact phrase `DELETE ACCOUNT`, is blocked
while seated, and marks the account restricted for 30 days before the daily
retention job can purge or anonymize account-linked records. `/account/session`
performs a one-time legacy-token exchange into an HttpOnly/Secure/SameSite
cookie; raw bearer tokens are not written by the session store. The existing
localStorage token remains a compatibility migration seam and must be removed
after the cookie fixture is promoted.

An operator can trigger one bounded pass with `POST /internal/retention/run`
using `x-poorup-retention-token` (or the maintenance token when no dedicated
retention token is set). The route is absent when no token is configured.

`POST /internal/maintenance` is operator-only and requires the
`x-poorup-maintenance-token` header. Its JSON body accepts `normal`, `draining`,
or `maintenance`. Draining rejects new rooms, Quick Tables, and round starts
while existing rounds continue. The deployment runbook waits for
`activeRounds = 0` before switching releases.

### Maintenance lockout and operator sign-in

The lockout is a flag on `maintenance` mode (`lockout: true` in the
maintenance snapshot). Admins toggle it from the Release area
(`POST /admin/ops/lockout`); deploy scripts can send
`{"mode":"maintenance","lockout":true}` to `/internal/maintenance`. While it is
on, the public site shows a full "Under maintenance" panel and the server
refuses new rooms, new seats, invite seats and round starts for every socket
without a bypass. Seated players keep playing and may reconnect to their seat.
Draining and plain maintenance are unchanged; the lockout survives a restart
with its maintenance window, and `/readyz` reports it as `unavailable`.

A bypass is granted to admin accounts (`POORUP_ADMIN_ACCOUNT_IDS`) and to a
browser that signed in on the panel with `POORUP_MAINTENANCE_PASSWORD`.

```sh
POORUP_MAINTENANCE_PASSWORD=<operator password, 12+ characters>
POORUP_MAINTENANCE_COOKIE_SECRET=<optional HMAC secret; unset = random per process>
POORUP_MAINTENANCE_ACCESS_TTL_MS=43200000
```

With no password set, `/maintenance/unlock` answers 404 and only admin
accounts bypass. The password is compared as a SHA-256 digest in constant
time and is never logged, audited, metered or stored. Sign-in is limited per
IP (10 requests a minute, then 5 failures per 15 minutes with a growing
delay). Success sets `poorup_operator`, an HttpOnly, SameSite=Strict, `Path=/`
cookie (Secure on HTTPS behind a trusted proxy or with
`POORUP_COOKIE_SECURE=true`) holding an HMAC-signed token that expires after
`POORUP_MAINTENANCE_ACCESS_TTL_MS` (default 12 hours, 5 minutes to 7 days).
Rotating the password, or restarting without a cookie secret, signs every
operator out; `POST /maintenance/logout` clears the cookie and revokes its
token.

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

## Policy-gated release surfaces

Account deletion/export scope, session lifetime, legal/support identity and
copy, analytics retention/disclosure, canonical preview origin/artwork, and
horizontal persistence are owner decisions. Until each decision has an
approved contract and source evidence, the corresponding manifest records stay
`planned` or `deferred`, and no public policy promise is made for them.
