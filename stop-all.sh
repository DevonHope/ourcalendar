#!/usr/bin/env bash
set -euo pipefail
# Stops processes started by start-all.sh using pidfiles in .pids/

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDS_DIR="$BASE_DIR/.pids"

DRY_RUN=0
FORCE=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=1; shift;;
    --force) FORCE=1; shift;;
    *) echo "Usage: $0 [--dry-run] [--force]"; exit 1;;
  esac
done

stop_one() {
  name="$1"
  pidfile="$PIDS_DIR/$name.pid"
  logfile="$PIDS_DIR/$name.log"

  if [[ ! -f "$pidfile" ]]; then
    echo "No pidfile for $name; nothing to do"
    return
  fi

  pid=$(cat "$pidfile" 2>/dev/null || true)
  if [[ -z "$pid" ]]; then
    echo "Empty pidfile for $name; removing"
    rm -f "$pidfile"
    return
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name pid $pid not running; removing pidfile"
    rm -f "$pidfile"
    return
  fi

  echo "Stopping $name (pid $pid)"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] kill $pid"
    return
  fi

  kill "$pid" || true
  # wait for process to exit
  for i in {1..10}; do
    if kill -0 "$pid" 2>/dev/null; then
      sleep 0.5
    else
      break
    fi
  done

  if kill -0 "$pid" 2>/dev/null; then
    if [[ $FORCE -eq 1 ]]; then
      echo "Force killing $pid"
      kill -9 "$pid" || true
    else
      echo "$name did not exit; use --force to SIGKILL"
      return 1
    fi
  fi

  echo "$name stopped"
  rm -f "$pidfile"
}

# Find PIDs listening on a given TCP port. Returns space-separated PIDs or empty.
pids_on_port() {
  port="$1"
  pids=""
  # try fuser
  if command -v fuser >/dev/null 2>&1; then
    # fuser prints PIDs with spaces
    pids=$(fuser -n tcp "$port" 2>/dev/null || true)
  fi
  # try lsof
  if [[ -z "$pids" ]] && command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -t -i TCP:"$port" 2>/dev/null || true)
  fi
  # fallback to ss parsing
  if [[ -z "$pids" ]] && command -v ss >/dev/null 2>&1; then
    # ss output contains pid=PID, parse those
    pids=$(ss -ltnp 2>/dev/null | grep -E ":${port}( |$)" | sed -n 's/.*pid=\([0-9]*\),.*/\1/p' | tr '\n' ' ' | xargs || true)
  fi
  echo "$pids" | xargs
}

# Gracefully stop a pid (SIGTERM then optional SIGKILL if --force)
stop_pid() {
  pid="$1"
  if [[ -z "$pid" ]]; then return; fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "pid $pid not running"
    return
  fi
  echo "Stopping pid $pid"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] kill $pid"
    return
  fi
  kill "$pid" 2>/dev/null || true
  for i in {1..10}; do
    if kill -0 "$pid" 2>/dev/null; then
      sleep 0.5
    else
      break
    fi
  done
  if kill -0 "$pid" 2>/dev/null; then
    if [[ $FORCE -eq 1 ]]; then
      echo "Force killing $pid"
      kill -9 "$pid" 2>/dev/null || true
    else
      echo "pid $pid did not exit; use --force to SIGKILL"
      return 1
    fi
  fi
  echo "pid $pid stopped"
}

# Stop processes listening on the specific ports we care about
stop_ports() {
  ports=(6001 5913)
  for p in "${ports[@]}"; do
    echo "Checking port $p for listeners..."
    pids=$(pids_on_port "$p")
    if [[ -z "$pids" ]]; then
      echo "No processes found listening on port $p"
      continue
    fi
    for pid in $pids; do
      # avoid killing ourselves
      if [[ "$pid" == "$$" ]]; then
        echo "Skipping current shell pid $pid"
        continue
      fi
      stop_pid "$pid"
    done
  done
}

if [[ ! -d "$PIDS_DIR" ]]; then
  echo "No .pids directory found; nothing to stop"
  exit 0
fi

stop_one "client"
stop_one "server"

# Also ensure any stray processes listening on our typical ports are stopped
stop_ports

echo "Done. Logs (if any) are in $PIDS_DIR"
