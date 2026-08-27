#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

# The deployed containers and volumes predate the response-refactor checkout
# name. Pinning the project prevents Compose from creating a second empty
# network/pgdata volume when the checkout directory changes.
exec docker-compose -p oi-manager -f "$ROOT_DIR/docker-compose.yml" "$@"
