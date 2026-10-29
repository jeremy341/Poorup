#!/usr/bin/env bash
# Pull-based auto updater for the Nest host. Runs as the poorup user from a
# systemd timer (see nest-live-runbook.md). Polls origin/main; when a new SHA
# appears it downloads the exact release tarball and hands off to the drain-
# gated scripts/deploy-nest.sh from the NEW release (drain -> wait for empty
# lobbies -> swap -> health -> normal, with rollback). No SSH or GitHub
# secrets are required: the repo is public and the maintenance token comes
# from the host env file.
set -euo pipefail

export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"

APP_ROOT="${APP_ROOT:-/srv/poorup}"
SHARED_ENV="${SHARED_ENV_FILE:-$APP_ROOT/shared/poorup.env}"
REPO="${UPDATE_REPO:-jeremy341/Poorup}"
BRANCH="${UPDATE_BRANCH:-main}"
MAINTENANCE_URL="${MAINTENANCE_URL:-http://127.0.0.1:8080/internal/maintenance}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/healthz}"
READY_URL="${READY_URL:-http://127.0.0.1:8080/readyz}"

if [ -f "$SHARED_ENV" ]; then
  # shellcheck disable=SC1090
  set -a; . "$SHARED_ENV"; set +a
fi

if [ -z "${POORUP_MAINTENANCE_TOKEN:-}" ]; then
  echo "POORUP_MAINTENANCE_TOKEN is required (from $SHARED_ENV)"
  exit 2
fi

CURRENT_LINK="$APP_ROOT/current"
current_sha=""
if [ -L "$CURRENT_LINK" ]; then
  current_sha="$(basename "$(readlink "$CURRENT_LINK")")"
fi

latest_sha="$(git ls-remote "https://github.com/$REPO.git" "refs/heads/$BRANCH" | cut -f1)"
if [ -z "$latest_sha" ]; then
  echo "Could not resolve origin/$BRANCH"
  exit 1
fi
case "$latest_sha" in
  *[!a-fA-F0-9]*|'') echo "Invalid SHA from origin: $latest_sha"; exit 1 ;;
esac

# Self-hygiene every tick (under the timer's flock, so no concurrent run can
# be mid-download): drop stale download artifacts and orphaned release dirs
# left by past failed attempts. Current, previous, and latest targets are
# always spared, so the live app and its rollback can never be pruned.
rm -f /tmp/poorup-*.tgz
PREVIOUS_LINK="$APP_ROOT/previous"
current_target=""
if [ -L "$CURRENT_LINK" ]; then current_target="$(readlink "$CURRENT_LINK")"; fi
previous_target=""
if [ -L "$PREVIOUS_LINK" ]; then previous_target="$(readlink "$PREVIOUS_LINK")"; fi
for candidate in "$APP_ROOT/releases"/*; do
  if [ ! -d "$candidate" ]; then continue; fi
  case "$candidate" in
    "$current_target"|"$previous_target"|"$APP_ROOT/releases/$latest_sha") ;;
    *) rm -rf "$candidate" || echo "Warning: could not prune $candidate" ;;
  esac
done

if [ "$latest_sha" = "$current_sha" ]; then
  echo "Up to date at $current_sha"
  exit 0
fi

echo "Update available: $current_sha -> $latest_sha"
RELEASE_DIR="$APP_ROOT/releases/$latest_sha"
ARCHIVE="/tmp/poorup-$latest_sha.tgz"

if [ ! -f "$RELEASE_DIR/package.json" ]; then
  curl --fail --silent --show-error --max-time 120 -L \
    -o "$ARCHIVE" "https://codeload.github.com/$REPO/tar.gz/$latest_sha"
  tar -tzf "$ARCHIVE" >/dev/null
  mkdir -p "$RELEASE_DIR"
  # Codeload tarballs nest everything under a top-level Poorup-<sha>/ dir;
  # strip it so the release layout matches the deploy contract.
  tar -xzf "$ARCHIVE" -C "$RELEASE_DIR" --strip-components=1
fi

if [ ! -f "$RELEASE_DIR/package.json" ] || [ ! -f "$RELEASE_DIR/server/server.js" ]; then
  echo "Release archive is missing the server contract"
  exit 2
fi

npm ci --omit=dev --prefix "$RELEASE_DIR" --no-audit --no-fund >/dev/null 2>&1

# Hand off to the drain-gated deploy from the NEW release so deploy logic
# itself is versioned with the code it ships.
echo "Handing off to new-release deploy for $latest_sha"
RELEASE_SHA="$latest_sha" \
RELEASE_ARCHIVE="$ARCHIVE" \
APP_ROOT="$APP_ROOT" \
MAINTENANCE_URL="$MAINTENANCE_URL" \
HEALTH_URL="$HEALTH_URL" \
READY_URL="$READY_URL" \
MAINTENANCE_TOKEN="$POORUP_MAINTENANCE_TOKEN" \
bash "$RELEASE_DIR/scripts/deploy-nest.sh"

# Keep /tmp tidy; older stragglers are trimmed too. The trailing `|| true`
# matters: with `set -o pipefail`, an empty glob makes `ls` fail and would
# otherwise fail the whole (already successful) update.
rm -f "$ARCHIVE"
ls -t /tmp/poorup-*.tgz 2>/dev/null | tail -n +3 | xargs -r rm -f || true
echo "Auto-update to $latest_sha complete"
