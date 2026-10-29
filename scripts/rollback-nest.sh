#!/usr/bin/env bash
set -euo pipefail

# Pin PM2 to the invoking user's daemon (see deploy-nest.sh).
export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"

if [ -z "$APP_ROOT" ] || [ -z "$MAINTENANCE_URL" ] || [ -z "$HEALTH_URL" ] || [ -z "$READY_URL" ] || [ -z "$MAINTENANCE_TOKEN" ]; then
  echo "APP_ROOT, MAINTENANCE_URL, HEALTH_URL, READY_URL, and MAINTENANCE_TOKEN are required"
  exit 2
fi

PREVIOUS_LINK="$APP_ROOT/previous"
CURRENT_LINK="$APP_ROOT/current"

if [ ! -L "$PREVIOUS_LINK" ]; then
  echo "No previous release is available"
  exit 1
fi

PREVIOUS_DIR="$(readlink "$PREVIOUS_LINK")"
if [ ! -f "$PREVIOUS_DIR/server/server.js" ]; then
  echo "Previous release is incomplete"
  exit 1
fi

ln -sfn "$PREVIOUS_DIR" "$CURRENT_LINK"
pm2 startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --update-env
pm2 save

curl --fail --silent --show-error --max-time 10 -X POST "$MAINTENANCE_URL" -H "content-type: application/json" -H "x-poorup-maintenance-token: $MAINTENANCE_TOKEN" --data-binary '{"mode":"normal"}' >/dev/null
curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null
curl --fail --silent --show-error --max-time 5 "$READY_URL" >/dev/null

echo "Rolled back to $PREVIOUS_DIR"

