#!/usr/bin/env bash
set -euo pipefail

# Begin a maintenance drain without deploying. Used by the push-triggered
# maintenance-drain workflow so the maintenance screen appears while CI runs.
# No deadline is set here: a failed CI run is followed by end-drain.sh via
# the maintenance-undrain workflow, and a successful one proceeds to the
# drain-gated deploy (which sets its own deadline and ends in normal mode).
if [ -z "${MAINTENANCE_URL:-}" ] || [ -z "${MAINTENANCE_TOKEN:-}" ] || [ -z "${RELEASE_SHA:-}" ]; then
  echo "MAINTENANCE_URL, MAINTENANCE_TOKEN, and RELEASE_SHA are required"
  exit 2
fi

case "$RELEASE_SHA" in
  *[!a-fA-F0-9]*|'') echo "RELEASE_SHA must be a hexadecimal commit"; exit 2 ;;
esac

# The token goes to curl through a 0600 header file, not argv (see deploy-nest.sh).
MAINTENANCE_HEADER="$(mktemp)"
chmod 600 "$MAINTENANCE_HEADER"
trap 'rm -f "$MAINTENANCE_HEADER"' EXIT
printf 'x-poorup-maintenance-token: %s\n' "$MAINTENANCE_TOKEN" > "$MAINTENANCE_HEADER"

curl --fail --silent --show-error --max-time 10 -X POST "$MAINTENANCE_URL" \
  -H "content-type: application/json" \
  -H "@$MAINTENANCE_HEADER" \
  --data-binary "{\"mode\":\"draining\",\"releaseId\":\"$RELEASE_SHA\",\"message\":\"MAINTENANCE WINDOW · INCOMING RELEASE\"}" >/dev/null

echo "Drain started for $RELEASE_SHA"
