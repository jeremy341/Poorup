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

# deploy-nest.sh stamps the failed SHA into POORUP_RELEASE_ID before the swap.
# Stamp the release being returned to, so /healthz and /readyz stop reporting
# the SHA that was rolled back.
SHARED_ENV_FILE="${SHARED_ENV_FILE:-$APP_ROOT/shared/poorup.env}"
PREVIOUS_SHA="$(basename "$PREVIOUS_DIR")"
case "$PREVIOUS_SHA" in
  *[!a-fA-F0-9]*|'') PREVIOUS_SHA="" ;;
esac
if [ -n "$PREVIOUS_SHA" ] && [ -f "$SHARED_ENV_FILE" ]; then
  if grep -q '^POORUP_RELEASE_ID=' "$SHARED_ENV_FILE"; then
    sed -i "s|^POORUP_RELEASE_ID=.*|POORUP_RELEASE_ID=$PREVIOUS_SHA|" "$SHARED_ENV_FILE"
  else
    printf 'POORUP_RELEASE_ID=%s\n' "$PREVIOUS_SHA" >> "$SHARED_ENV_FILE"
  fi
fi

pm2 startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --update-env
pm2 save

# Token via a 0600 header file, not argv (see deploy-nest.sh).
MAINTENANCE_HEADER="$(mktemp)"
chmod 600 "$MAINTENANCE_HEADER"
trap 'rm -f "$MAINTENANCE_HEADER"' EXIT
printf 'x-poorup-maintenance-token: %s\n' "$MAINTENANCE_TOKEN" > "$MAINTENANCE_HEADER"

curl --fail --silent --show-error --max-time 10 -X POST "$MAINTENANCE_URL" -H "content-type: application/json" -H "@$MAINTENANCE_HEADER" --data-binary '{"mode":"normal"}' >/dev/null
curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null
curl --fail --silent --show-error --max-time 5 "$READY_URL" >/dev/null

echo "Rolled back to $PREVIOUS_DIR"
