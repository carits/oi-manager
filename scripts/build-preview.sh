#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
CANDIDATE_DIR="$WEB_DIR/.next-candidate"

# Next includes generated type directories from tsconfig. Remove non-production build output so
# deleted routes cannot survive in stale type files and break a candidate build.
for stale_name in .next .next-dev .next-e2e; do
  stale_dir="$WEB_DIR/$stale_name"
  if [ -d "$stale_dir" ]; then
    stale_path="$(readlink -f "$stale_dir")"
    expected_stale_path="$(readlink -f "$WEB_DIR")/$stale_name"
    if [ "$stale_path" != "$expected_stale_path" ]; then
      echo "Refusing to remove unexpected generated path: $stale_path" >&2
      exit 1
    fi
    rm -rf -- "$stale_path"
  fi
done

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
