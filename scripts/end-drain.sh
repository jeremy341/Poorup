#!/usr/bin/env bash
set -euo pipefail

# Return the app to normal service without deploying. Used by the
# maintenance-undrain workflow when CI fails or is cancelled after a drain
# was started, so new rounds are not paused indefinitely.
if [ -z "${MAINTENANCE_URL:-}" ] || [ -z "${MAINTENANCE_TOKEN:-}" ]; then
  echo "MAINTENANCE_URL and MAINTENANCE_TOKEN are required"
  exit 2
fi

# The token goes to curl through a 0600 header file, not argv (see deploy-nest.sh).
MAINTENANCE_HEADER="$(mktemp)"
chmod 600 "$MAINTENANCE_HEADER"
trap 'rm -f "$MAINTENANCE_HEADER"' EXIT
printf 'x-poorup-maintenance-token: %s\n' "$MAINTENANCE_TOKEN" > "$MAINTENANCE_HEADER"

curl --fail --silent --show-error --max-time 10 -X POST "$MAINTENANCE_URL" \
  -H "content-type: application/json" \
  -H "@$MAINTENANCE_HEADER" \
  --data-binary '{"mode":"normal"}' >/dev/null

echo "Returned to normal service"
