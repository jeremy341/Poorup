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
   `POORUP_ANALYTICS_PSEUDONYM_KEY`. No dotenv loader exists by design;
   `ecosystem.config.cjs` merges this file so bare-shell `pm2 startOrReload`
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

## Automatic main deployment

Set the repository variable `NEST_DEPLOY_ENABLED=true` and configure the
environment `nest-production` secrets `NEST_HOST`, `NEST_USER`,
`NEST_DEPLOY_KEY`, `NEST_KNOWN_HOSTS`, and `POORUP_MAINTENANCE_TOKEN` once the
first maintenance-capable bootstrap is complete. Until that variable is true,
`.github/workflows/deploy-nest.yml` is intentionally skipped so a main push
cannot produce a misleading failed deployment or touch the legacy process.

When enabled, the workflow runs after CI succeeds for main. It uploads the
exact verified SHA, calls the drain endpoint, installs production dependencies,
atomically switches `/srv/poorup/current`, reloads PM2, verifies
health/readiness, and returns to normal service.

## Emergency rollback

    APP_ROOT=/srv/poorup MAINTENANCE_URL=http://127.0.0.1:8080/internal/maintenance HEALTH_URL=http://127.0.0.1:8080/healthz READY_URL=http://127.0.0.1:8080/readyz MAINTENANCE_TOKEN=<secret> /srv/poorup/current/scripts/rollback-nest.sh

Do not delete the previous release until the replacement has passed its smoke checks.

