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

# The maintenance token reaches curl through a 0600 header file rather than argv,
# so it never appears in `ps` output or the process table of the SSH session.
MAINTENANCE_HEADER="$(mktemp)"
chmod 600 "$MAINTENANCE_HEADER"
trap 'rm -f "$MAINTENANCE_HEADER"' EXIT
printf 'x-poorup-maintenance-token: %s\n' "$MAINTENANCE_TOKEN" > "$MAINTENANCE_HEADER"

post_maintenance() {
  curl --fail --silent --show-error --max-time 10 -X POST "$MAINTENANCE_URL" -H "content-type: application/json" -H "@$MAINTENANCE_HEADER" --data-binary "$1" >/dev/null
}

# A fresh backup is required only where backups are configured. /readyz reports
# backupFresh:null (and backupConfigured:false) on a host with no backup
# directory, and that host must still pass the gate.
backups_ready() {
  printf '%s' "$1" | grep -q '"backupFresh":true' || printf '%s' "$1" | grep -q '"backupConfigured":false'
}

post_maintenance "{\"mode\":\"draining\",\"releaseId\":\"$RELEASE_SHA\"}"

DRAIN_TIMEOUT_SECONDS="${DRAIN_TIMEOUT_SECONDS:-1800}"
drain_complete=false
for attempt in $(seq 1 "$DRAIN_TIMEOUT_SECONDS"); do
  # NOTE: /readyz answers HTTP 503 while draining; the activeRounds count is
  # in the body either way, so this poll must not use curl --fail (it would
  # abort on the very first draining response and never observe the drain).
  ready_body="$(curl --silent --show-error --max-time 5 "$READY_URL" || true)"
  if printf '%s' "$ready_body" | grep -q '"activeRounds":0'; then
    drain_complete=true
    break
  fi
  sleep 1
done
if [ "$drain_complete" != true ]; then
  # Return to normal before failing: a deploy that gives up must not leave the
  # parlor paused until someone notices. The next updater tick retries.
  echo "Active rounds did not drain before the deployment deadline; returning to normal service without deploying"
  post_maintenance '{"mode":"normal"}' || echo "Warning: could not return to normal service; check /readyz and the maintenance state"
  exit 1
fi

# Waiting lobbies cannot start while draining (start-game is refused), so they
# cannot be waited out. The reload drops them; players receive the maintenance
# state at drain start and the restart notice at shutdown.
waiting_lobbies="$(printf '%s' "$ready_body" | sed -n 's/.*"waitingRooms":\([0-9][0-9]*\).*/\1/p')"
if [ -n "$waiting_lobbies" ] && [ "$waiting_lobbies" != 0 ]; then
  echo "Notice: $waiting_lobbies waiting lobby(ies) will be dropped by this reload"
fi

if [ -L "$CURRENT_LINK" ]; then
  ln -sfn "$(readlink "$CURRENT_LINK")" "$PREVIOUS_LINK"
fi
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

# Stamp the release id so /healthz and /readyz report this SHA after reload
# (the fresh process boots into the persisted draining snapshot, whose own
# releaseId field is empty by construction). rollback-nest.sh restores the
# previous id if this release fails its health gate.
SHARED_ENV_FILE="${SHARED_ENV_FILE:-$APP_ROOT/shared/poorup.env}"
if [ -f "$SHARED_ENV_FILE" ]; then
  if grep -q '^POORUP_RELEASE_ID=' "$SHARED_ENV_FILE"; then
    sed -i "s|^POORUP_RELEASE_ID=.*|POORUP_RELEASE_ID=$RELEASE_SHA|" "$SHARED_ENV_FILE"
  else
    printf 'POORUP_RELEASE_ID=%s\n' "$RELEASE_SHA" >> "$SHARED_ENV_FILE"
  fi
fi

pm2 startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --update-env
pm2 save

# The fresh process boots into the persisted draining mode, so /readyz answers
# 503 here. Gate on the body instead: stores loaded, backups fresh (or
# not configured), still draining, and reporting this release. Only then return
# to normal.
healthy=false
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null; then
    ready_body="$(curl --silent --show-error --max-time 5 "$READY_URL" || true)"
    if printf '%s' "$ready_body" | grep -q '"storeLoaded":true' \
      && backups_ready "$ready_body" \
      && printf '%s' "$ready_body" | grep -q '"acceptingNewRounds":false' \
      && printf '%s' "$ready_body" | grep -q "\"releaseId\":\"$RELEASE_SHA\""; then
      healthy=true
      break
    fi
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "New release failed health checks; recording $RELEASE_SHA as failed and rolling back"
    # Recorded so nest-auto-update.sh does not drain and redeploy the same SHA
    # every tick. Push a new commit, or remove the marker, to retry.
    mkdir -p "$APP_ROOT/shared/failed-releases"
    : > "$APP_ROOT/shared/failed-releases/$RELEASE_SHA"
    "$CURRENT_LINK/scripts/rollback-nest.sh"
    exit 1
  fi
  sleep 1
done

post_maintenance "{\"mode\":\"normal\",\"releaseId\":\"$RELEASE_SHA\"}"

# Keep the pull-timer entrypoint in sync with the deployed release so updater
# improvements ship automatically with the code. Do not use plain `cp` here:
# the running updater is this very file family, and truncating it in place
# tears the interpreter's reads mid-run (observed live as a syntax error
# after an otherwise successful deploy). Skip when identical; otherwise write
# temp + atomic rename so open readers keep the old inode undisturbed.
if [ -f "$RELEASE_DIR/scripts/nest-auto-update.sh" ]; then
  if ! cmp -s "$RELEASE_DIR/scripts/nest-auto-update.sh" "$APP_ROOT/shared/nest-auto-update.sh" 2>/dev/null; then
    tmp_update="$(mktemp "$APP_ROOT/shared/.nest-auto-update.XXXXXX" 2>/dev/null)" || tmp_update=""
    if [ -n "$tmp_update" ] \
      && cp "$RELEASE_DIR/scripts/nest-auto-update.sh" "$tmp_update" \
      && mv "$tmp_update" "$APP_ROOT/shared/nest-auto-update.sh"; then
      chmod 755 "$APP_ROOT/shared/nest-auto-update.sh" || true
    else
      echo "Warning: could not refresh the update entrypoint"
      rm -f "$tmp_update"
    fi
  fi
fi

echo "Deployed $RELEASE_SHA"
