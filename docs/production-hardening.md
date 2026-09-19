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

`/privacy` is the compact factual Privacy & Account Data document. It is not a
Terms-of-Service route and does not invent operator or mail-provider facts.

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

## Policy-gated release surfaces

Account deletion/export scope, session lifetime, legal/support identity and
copy, analytics retention/disclosure, canonical preview origin/artwork, and
horizontal persistence are owner decisions. Until each decision has an
approved contract and source evidence, the corresponding manifest records stay
`planned` or `deferred`; this document makes no public policy promise for them.
