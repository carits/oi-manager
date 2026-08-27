#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX_NAME="oi-manager-e2e-stress-go-judge"

cleanup_owned_sandbox() {
  local owned
  owned="$(docker inspect --format '{{ index .Config.Labels "oi-manager.e2e-stress" }}' "$SANDBOX_NAME" 2>/dev/null || true)"
  if [[ "$owned" == "true" ]]; then
    docker stop --time 10 "$SANDBOX_NAME" >/dev/null 2>&1 || true
  fi
}

trap cleanup_owned_sandbox EXIT INT TERM
cleanup_owned_sandbox
cd "$ROOT_DIR"
pnpm exec playwright test \
  --config=playwright.stress.config.ts \
  e2e/stress/judge-load.spec.ts \
  "$@"
