#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
CANDIDATE_DIR="$WEB_DIR/.next-candidate"

if [ -d "$CANDIDATE_DIR" ]; then
  candidate_path="$(readlink -f "$CANDIDATE_DIR")"
  expected_path="$(readlink -f "$WEB_DIR")/.next-candidate"
  if [ "$candidate_path" != "$expected_path" ]; then
    echo "Refusing to remove unexpected candidate path: $candidate_path" >&2
    exit 1
  fi
  rm -rf -- "$candidate_path"
fi

cd "$ROOT_DIR"
pnpm --filter @oi-manager/shared build
APP_ENV=development CSP_MODE="${CSP_MODE:-off}" NODE_ENV=production NEXT_DIST_DIR=.next-candidate pnpm --filter web build

test -f "$CANDIDATE_DIR/BUILD_ID"
echo "Preview candidate built: $(cat "$CANDIDATE_DIR/BUILD_ID")"
