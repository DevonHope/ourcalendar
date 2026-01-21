#!/usr/bin/env bash
set -euo pipefail
# Starts server and client from project root. By default starts detached and writes
# pidfiles and logs to .pids/. Supports --dry-run and --foreground.

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDS_DIR="$BASE_DIR/.pids"
mkdir -p "$PIDS_DIR"

DRY_RUN=0
FOREGROUND=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=1; shift;;
    --foreground) FOREGROUND=1; shift;;
    *) echo "Usage: $0 [--dry-run] [--foreground]"; exit 1;;
  esac
done

start_one() {
  name="$1"; dir="$2"; cmd="$3"
  pidfile="$PIDS_DIR/$name.pid"
  logfile="$PIDS_DIR/$name.log"

  if [[ -f "$pidfile" ]]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "$name already running (pid $pid)";
      return
    else
      echo "Removing stale pidfile for $name"
      rm -f "$pidfile"
    fi
  fi

  echo "Starting $name in $dir -> log: $logfile"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] (cd $dir && $cmd) > $logfile 2>&1 & echo \$! > $pidfile"
    return
  fi

  if [[ $FOREGROUND -eq 1 ]]; then
    (cd "$dir" && eval $cmd)
  else
    nohup bash -lc "cd '$dir' && $cmd" > "$logfile" 2>&1 &
    pid=$!
    echo "$pid" > "$pidfile"
    # try to detach from the shell
    disown "$pid" 2>/dev/null || true
    echo "$name started (pid $pid)"
  fi
}

# Start server and client. Adjust commands if your package scripts differ.
start_one "server" "$BASE_DIR/server" "source ~/.nvm/nvm.sh && nvm use 18 && npm start"
start_one "client" "$BASE_DIR/client" "npm run dev"

echo "Done. PID files and logs in $PIDS_DIR"
