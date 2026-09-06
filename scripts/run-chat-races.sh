#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
PATTERN='serializes a read update|serializes concurrent sends|keeps block authoritative|serializes bidirectional sends'
for round in $(seq 1 10); do
  echo "Chat race verification round $round/10"
  pnpm --filter server exec vitest run tests/chat.test.ts -t "$PATTERN"
done
