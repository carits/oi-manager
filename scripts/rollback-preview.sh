#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
CURRENT_DIR="$WEB_DIR/.next-current"
PREVIOUS_DIR="$WEB_DIR/.next-previous"
FAILED_DIR="$WEB_DIR/.next-failed-$(date +%Y%m%d%H%M%S)"

test -f "$PREVIOUS_DIR/BUILD_ID"
"$ROOT_DIR/scripts/stop-preview.sh"
if [ -d "$CURRENT_DIR" ]; then
  current_path="$(readlink -f "$CURRENT_DIR")"
  expected_current_path="$(readlink -f "$WEB_DIR")/.next-current"
  if [ "$current_path" != "$expected_current_path" ]; then
    echo "Refusing to move unexpected current path: $current_path" >&2
    exit 1
  fi
  mv "$CURRENT_DIR" "$FAILED_DIR"
fi
mv "$PREVIOUS_DIR" "$CURRENT_DIR"
"$ROOT_DIR/scripts/start-preview.sh"
PREVIEW_URL=http://127.0.0.1:3000/login node "$ROOT_DIR/scripts/preview-health.mjs"
echo "Previous preview restored; failed build retained at $FAILED_DIR."
