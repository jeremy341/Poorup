# Nest Live Runbook

## Verified baseline

The previous Nest checkout was /root/Poorup on main at b1f3cd7 (23 June 2026). PM2 process poorup served node /root/Poorup/server/server.js on port 8080 and had been online for about 24 hours. pm2-root.service was enabled; poorup.service was disabled. No automatic pull, webhook, or deploy timer existed.

## First migration

1. Announce a maintenance window.
2. Confirm the old SHA and capture a backup outside the release directory.
3. Install the dedicated poorup runtime user.
4. Install PM2 startup for that user.
5. Create /srv/poorup/releases, /srv/poorup/data, and /srv/poorup/backups.
6. Bootstrap the maintenance-capable release during the approved window.
7. Verify /healthz, /readyz, and Socket.IO.
8. Only then enable automatic main deployments.

The deploy script refuses to continue when the old server does not expose /internal/maintenance; this prevents an unplanned restart of the live legacy version.

## Automatic main deployment

.github/workflows/deploy-nest.yml runs after CI succeeds for main. It uploads the exact verified SHA, calls the drain endpoint, installs production dependencies, atomically switches /srv/poorup/current, reloads PM2, verifies health/readiness, and returns to normal service.

## Emergency rollback

    APP_ROOT=/srv/poorup MAINTENANCE_URL=http://127.0.0.1:8080/internal/maintenance HEALTH_URL=http://127.0.0.1:8080/healthz READY_URL=http://127.0.0.1:8080/readyz MAINTENANCE_TOKEN=<secret> /srv/poorup/current/scripts/rollback-nest.sh

Do not delete the previous release until the replacement has passed its smoke checks.

