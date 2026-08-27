#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
TIMEOUT_SECONDS="${OI_DEPENDENCY_WAIT_SECONDS:-120}"

if [[ "$MODE" != "database" && "$MODE" != "judge" ]]; then
  echo "Usage: $0 database|judge" >&2
  exit 2
fi
if [[ ! "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || (( TIMEOUT_SECONDS > 600 )); then
  echo "Invalid OI_DEPENDENCY_WAIT_SECONDS: $TIMEOUT_SECONDS" >&2
  exit 2
fi

deadline=$((SECONDS + TIMEOUT_SECONDS))
wait_until() {
  local description="$1"
  shift
  while (( SECONDS < deadline )); do
    if "$@" >/dev/null 2>&1; then
      echo "Runtime dependency ready: $description"
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for runtime dependency: $description" >&2
  return 1
}

database_healthy() {
  [[ "$(docker inspect oi-postgres --format '{{.State.Health.Status}}' 2>/dev/null)" == "healthy" ]]
}

wait_until "PostgreSQL container health" database_healthy

if [[ "$MODE" == "judge" ]]; then
  wait_until "go-judge sandbox" curl --fail --silent --max-time 2 http://127.0.0.1:5050/version
  wait_until "stable API readiness" curl --fail --silent --max-time 2 http://127.0.0.1:3002/api/readiness
fi
