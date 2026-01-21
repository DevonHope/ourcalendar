#!/usr/bin/env bash
# start ourcalendar server from project directory
# Usage: PORT=6002 ./start.sh
set -euo pipefail
cd "$(dirname "$0")"

# load optional .env if present (simple support)
if [ -f ".env" ]; then
  # shellcheck disable=SC1091
  export $(grep -v '^#' .env | xargs || true)
fi

# Default PORT if not set
: "${PORT:=6002}"

echo "Starting ourcalendar server in $(pwd) on port ${PORT}"
exec env PORT="${PORT}" npm start
