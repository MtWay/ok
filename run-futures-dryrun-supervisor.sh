#!/usr/bin/env bash
# Keep the isolated dry-run bot running after an unexpected process exit.
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTART_DELAY_SECONDS="${FREQTRADE_RESTART_DELAY_SECONDS:-10}"
MAX_RESTART_DELAY_SECONDS="${FREQTRADE_MAX_RESTART_DELAY_SECONDS:-300}"

stopping=0
child_pid=""

stop_child() {
  stopping=1
  if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
    kill "$child_pid" 2>/dev/null || true
  fi
}

trap stop_child INT TERM

while (( stopping == 0 )); do
  started_at="$(date +%s)"
  echo "[$(date -Is)] Starting Freqtrade supervisor child"

  "$ROOT_DIR/start-futures-dryrun.sh" &
  child_pid=$!
  wait "$child_pid"
  exit_code=$?
  child_pid=""

  if (( stopping != 0 )); then
    exit 0
  fi

  runtime=$(( $(date +%s) - started_at ))
  echo "[$(date -Is)] Freqtrade exited with code=$exit_code after ${runtime}s; restarting in ${RESTART_DELAY_SECONDS}s"
  if (( runtime >= 60 )); then
    RESTART_DELAY_SECONDS="${FREQTRADE_RESTART_DELAY_SECONDS:-10}"
  else
    next_delay=$(( RESTART_DELAY_SECONDS * 2 ))
    if (( next_delay > MAX_RESTART_DELAY_SECONDS )); then
      next_delay=$MAX_RESTART_DELAY_SECONDS
    fi
    RESTART_DELAY_SECONDS=$next_delay
  fi

  sleep "$RESTART_DELAY_SECONDS" &
  sleep_pid=$!
  wait "$sleep_pid" 2>/dev/null || true
done
