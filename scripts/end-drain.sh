#!/usr/bin/env bash
set -euo pipefail

# Return the app to normal service without deploying. Used by the
# maintenance-undrain workflow when CI fails or is cancelled after a drain
# was started, so new rounds are not paused indefinitely.
if [ -z "${MAINTENANCE_URL:-}" ] || [ -z "${MAINTENANCE_TOKEN:-}" ]; then
  echo "MAINTENANCE_URL and MAINTENANCE_TOKEN are required"
  exit 2
fi

curl --fail --silent --show-error --max-time 10 -X POST "$MAINTENANCE_URL" \
  -H "content-type: application/json" \
  -H "x-poorup-maintenance-token: $MAINTENANCE_TOKEN" \
  --data-binary '{"mode":"normal"}' >/dev/null

echo "Returned to normal service"
