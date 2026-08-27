#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX_NAME="oi-manager-e2e-blue-green-go-judge"
export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://oi:oi_password@127.0.0.1:5432/oi_manager?schema=e2e}"
[[ "$DATABASE_URL" == *"schema=e2e"* ]] || { echo "Refusing blue/green run without schema=e2e" >&2; exit 2; }
cleanup() {
  local owned
  owned="$(docker inspect --format '{{ index .Config.Labels "oi-manager.e2e-blue-green" }}' "$SANDBOX_NAME" 2>/dev/null || true)"
  [[ "$owned" == true ]] && docker stop --time 10 "$SANDBOX_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup
cd "$ROOT_DIR"
pnpm test:ui:prepare
pnpm exec playwright test --config=playwright.blue-green.config.ts "$@"
