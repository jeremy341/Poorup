# Nest Live Runbook

## Verified baseline (2026-09-19)

The previous Nest checkout was /root/Poorup on main at b1f3cd7 (23 June 2026):
an old pre-rewrite build (public/gameClient.js, 18 KB server.js, express +
socket.io only) with a catch-all `app.get('*')` route, so /healthz, /readyz,
and /internal/maintenance all returned the SPA shell with HTTP 200. No
maintenance, drain, or readiness code existed in the deployed tree. PM2 process
poorup ran as root on port 8080 (watch off, pm2-root.service enabled). No
crontab, systemd timer, webhook, or deploy script existed.

## First migration (completed 2026-09-19)

1. Captured `/root/poorup-legacy-20260919-190348.tgz` (code only, no node_modules).
2. Created dedicated `poorup` system user and `/srv/poorup/{releases,data,backups,shared}`.
3. Provisioned `/srv/poorup/shared/poorup.env` (0600, poorup-owned): production
   origin `https://poorup.jeremy-d.hackclub.app`, data/backup dirs,
   `POORUP_TRUST_PROXY_HOPS=1` (single Caddy hop), generated
   `POORUP_MAINTENANCE_TOKEN`, `POORUP_AI_CONFIG_KEY`,
   `POORUP_ANALYTICS_PSEUDONYM_KEY`. No dotenv loader exists;
   `ecosystem.config.cjs` merges the shared env file so bare-shell `pm2 startOrReload`
   cannot boot without it.
4. Seeded valid empty stores (arrays for accounts/matches/achievements/
   telemetry, objects for social/cosmetics/analytics-rollup, versioned object
   for ai-providers). Required because backup rotation treats a missing source
   as failure, which wedged `/readyz` on fresh volumes (fixed in server.js to
   back up only existing files).
5. Verified release `3e26d3c` on port 8082: real `/healthz`, `/readyz` ready,
   drain/normal cycle, 403 on wrong token.
6. Cut over: deleted legacy root PM2 process, symlinked
   `/srv/poorup/current`, started via poorup PM2, enabled `pm2-poorup.service`.
7. Verified publicly: page serves new build (maintenance panel, no
   gameClient.js), `/healthz` JSON, Socket.IO handshake, all 200.

Legacy root PM2 dump saved empty so the old app cannot resurrect on reboot.
The deploy script refuses to continue when the old server does not expose
/internal/maintenance; this prevented an unplanned restart of the legacy
version during bootstrap (bootstrap ran outside the script for that reason).

## Automatic main deployment (active path: pull timer)

`poorup-update.timer` (every 3 min, `User=poorup`) runs
`/srv/poorup/shared/nest-auto-update.sh`, which polls `origin/main`. On a new
SHA it downloads the exact codeload tarball, runs `npm ci --omit=dev`, and
hands off to the NEW release's `scripts/deploy-nest.sh`: drain via
`/internal/maintenance`, wait for `"activeRounds":0`, atomically switch
`/srv/poorup/current`, `pm2 startOrReload` the new `ecosystem.config.cjs`
(which merges the shared env file), verify health/readiness, return to
`normal`, and refresh the shared updater copy on success. Overlaps are
skipped via `flock`; failures run `rollback-nest.sh` (`previous` is seeded).
No GitHub secrets are needed for this path.

Push-triggered maintenance screen: `maintenance-drain.yml` (push to main) and
`maintenance-undrain.yml` (CI non-success) exist for the push path but stay
parked: the front gateway only forwards the existing `jeremy-d` SSH identity
and rejects newly provisioned keys, so Actions cannot SSH in. If the gateway
authorizes a deploy key later, set the repository variable
`NEST_DEPLOY_ENABLED=true` plus the `nest-production` secrets (`NEST_HOST`,
`NEST_USER`, `NEST_DEPLOY_KEY`, `NEST_KNOWN_HOSTS`, `POORUP_MAINTENANCE_TOKEN`)
and the SSH path activates. Until then those workflows skip.

## Custom-domain migration: `poorup.tech`

The current production hostname remains available throughout this migration.
Do not add an application redirect or remove the old hostname until the new
domain has passed the checks below. The application already serves static files
and Socket.IO from the same origin; no second app, database, or game server is
needed.

### Nest routing and DNS

In the Nest Dashboard, associate both `poorup.tech` and `www.poorup.tech` with
the existing Poorup service and its internal application port **8080**. Keep
the current `poorup.jeremy-d.hackclub.app` mapping. The Nest setup documents
Caddy as its public reverse proxy, and the current application response is
served through that proxy. If the Dashboard does not offer custom-hostname
routing for this service, ask Nest support for the supported mapping before
changing DNS; do not create a second proxy or target the Node process directly
from the public internet.

At the domain provider, after the Nest hostname association is accepted, point
the apex and `www` at the verified Hack Club public ingress:

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | `65.108.74.29` |
| AAAA | `@` | `2a01:4f9:6b:4a05::360` |
| CNAME | `www` | `poorup.tech.` |

These are the current A/AAAA records published for `hackclub.app`, which the
existing Nest-hosted Poorup hostname resolves through. Re-check the official
Hack Club DNS record before applying them, since ingress addresses can change.
The new domain currently has no A/AAAA answer. Do not add a CAA restriction
unless Nest confirms its certificate issuer; the published Hack Club zone
currently permits Let's Encrypt, Sectigo, and ZeroSSL.

The public Nest edge already terminates HTTPS for the current hostname. Once
the new hosts are routed and their DNS resolves, verify valid certificates for
both `poorup.tech` and `www.poorup.tech`; do not configure TLS in Express or
change the app's listening port. No additional app-level reverse proxy is
required.

### Environment and safe rollout

The Nest-only `/srv/poorup/shared/poorup.env` is loaded by PM2 and must remain
outside the repository. Do not paste it into issues, logs, or Git. For the
dual-host test phase, configure:

```text
POORUP_ALLOWED_ORIGINS=https://poorup.jeremy-d.hackclub.app,https://poorup.tech,https://www.poorup.tech
POORUP_PUBLIC_ORIGIN=https://poorup.jeremy-d.hackclub.app
POORUP_META_DESCRIPTION=Poorup is a browser-based real-time multiplayer property-trading game.
POORUP_COOKIE_SECURE=true
```

Keep the old `POORUP_PUBLIC_ORIGIN` during the test phase so canonical links,
sitemap entries, and account-recovery emails do not point users to an
unverified hostname. After both new hosts pass the checks, set it to
`https://poorup.tech`. This makes the new domain canonical without redirecting
the old hostname. Later, decide separately whether to redirect the old hostname
and/or `www` to the apex; do not do that as part of initial validation.

Changing the shared environment requires reloading the app. Room state is held
in memory, so do not restart while games are active. Use the existing drain
flow and wait until there are no started games or waiting rooms before reload.
`/readyz` reports started games only (`activeRounds`), not waiting lobbies, so
`activeRounds: 0` by itself does not show that every in-memory room will be kept
through the reload. Confirm the active-room count through the operator surface or choose
a quiet window and verify no rooms remain. Then reload PM2 with the updated
environment and verify `/healthz`, `/readyz`, and Socket.IO before returning
maintenance mode to normal. Do not move, overwrite, or reseed the existing data
or backup directories.

### Migration verification

Keep the old and new hostnames pointed to the same service during this phase.
Verify the following on the new apex and `www` hostnames before changing the
canonical origin:

- Homepage, styles, scripts, favicon, and asset requests load over HTTPS.
- HTTP redirects to HTTPS and each certificate is valid for its hostname.
- Guest play works; a registered user can sign in and retain their existing
  account data. A user should expect to sign in once on the new hostname because
  session cookies are host-only and cannot be shared across domains.
- Two separate devices can create/join a room, exchange game/chat updates over
  Socket.IO, and reconnect after a network interruption.
- The old hostname still serves the same application and can still create/join
  rooms; existing cookies remain usable there.
- Canonical, Open Graph URL, sitemap, and recovery-email links use the configured
  `POORUP_PUBLIC_ORIGIN`. Do not treat the Open Graph image as verified until
  approved preview artwork exists at the configured path.
- No host redirect is enabled during dual-host testing.

Live room creation and registered-account checks require a planned production
smoke test with two devices; do not use production for synthetic load or leave
test rooms active.

### Rollback

If the new hostname fails, leave or restore `POORUP_PUBLIC_ORIGIN` to the old
Nest hostname, keep that hostname in `POORUP_ALLOWED_ORIGINS`, remove or disable
only the new host mappings, and restore the previous DNS records at the domain
provider. Do not change the app data, accounts, or old-host routing. If an app
reload is required, drain active rounds first using the normal deployment flow.

## Emergency rollback

    APP_ROOT=/srv/poorup MAINTENANCE_URL=http://127.0.0.1:8080/internal/maintenance HEALTH_URL=http://127.0.0.1:8080/healthz READY_URL=http://127.0.0.1:8080/readyz MAINTENANCE_TOKEN=<secret> /srv/poorup/current/scripts/rollback-nest.sh

Do not delete the previous release until the replacement has passed its smoke checks.

