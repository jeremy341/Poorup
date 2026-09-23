#!/usr/bin/env bash
set -euo pipefail

# Pin PM2 to the invoking user's daemon. A bare non-interactive SSH shell can
# otherwise resolve a different PM2_HOME and reload the wrong process list.
export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"

if [ -z "$RELEASE_SHA" ] || [ -z "$RELEASE_ARCHIVE" ] || [ -z "$APP_ROOT" ] || [ -z "$MAINTENANCE_URL" ] || [ -z "$HEALTH_URL" ] || [ -z "$READY_URL" ] || [ -z "$MAINTENANCE_TOKEN" ]; then
  echo "RELEASE_SHA, RELEASE_ARCHIVE, APP_ROOT, MAINTENANCE_URL, HEALTH_URL, READY_URL, and MAINTENANCE_TOKEN are required"
  exit 2
fi

case "$RELEASE_SHA" in
  *[!a-fA-F0-9]*|'') echo "RELEASE_SHA must be a hexadecimal commit"; exit 2 ;;
esac

if [ ! -f "$RELEASE_ARCHIVE" ]; then
  echo "Release archive not found"
  exit 2
fi

RELEASE_DIR="$APP_ROOT/releases/$RELEASE_SHA"
CURRENT_LINK="$APP_ROOT/current"
PREVIOUS_LINK="$APP_ROOT/previous"
mkdir -p "$APP_ROOT/releases"

if [ -e "$RELEASE_DIR/package.json" ]; then
  echo "Release already unpacked; reusing verified directory"
else
  mkdir -p "$RELEASE_DIR"
  tar -xzf "$RELEASE_ARCHIVE" -C "$RELEASE_DIR"
fi

if [ ! -f "$RELEASE_DIR/package.json" ] || [ ! -f "$RELEASE_DIR/server/server.js" ]; then
  echo "Release archive is missing the server contract"
  exit 2
fi

npm ci --omit=dev --prefix "$RELEASE_DIR"

curl --fail --silent --show-error --max-time 10 -X POST "$MAINTENANCE_URL" -H "content-type: application/json" -H "x-poorup-maintenance-token: $MAINTENANCE_TOKEN" --data-binary "{\"mode\":\"draining\",\"releaseId\":\"$RELEASE_SHA\"}" >/dev/null

DRAIN_TIMEOUT_SECONDS="${DRAIN_TIMEOUT_SECONDS:-1800}"
drain_complete=false
for attempt in $(seq 1 "$DRAIN_TIMEOUT_SECONDS"); do
  ready_body="$(curl --fail --silent --show-error --max-time 5 "$READY_URL")"
  if printf '%s' "$ready_body" | grep -q '"activeRounds":0'; then
    drain_complete=true
    break
  fi
  sleep 1
done
if [ "$drain_complete" != true ]; then
  echo "Active rounds did not drain before the deployment deadline"
  exit 1
fi

if [ -L "$CURRENT_LINK" ]; then
  ln -sfn "$(readlink "$CURRENT_LINK")" "$PREVIOUS_LINK"
fi
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

pm2 startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --update-env
pm2 save

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null && curl --fail --silent --show-error --max-time 5 "$READY_URL" >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "New release failed health checks; rolling back"
    "$CURRENT_LINK/scripts/rollback-nest.sh"
    exit 1
  fi
  sleep 1
done

curl --fail --silent --show-error --max-time 10 -X POST "$MAINTENANCE_URL" -H "content-type: application/json" -H "x-poorup-maintenance-token: $MAINTENANCE_TOKEN" --data-binary "{\"mode\":\"normal\",\"releaseId\":\"$RELEASE_SHA\"}" >/dev/null

# Keep the pull-timer entrypoint in sync with the deployed release so updater
# improvements ship automatically with the code.
if [ -f "$RELEASE_DIR/scripts/nest-auto-update.sh" ]; then
  cp "$RELEASE_DIR/scripts/nest-auto-update.sh" "$APP_ROOT/shared/nest-auto-update.sh" \
    || echo "Warning: could not refresh the update entrypoint"
fi

echo "Deployed $RELEASE_SHA"
