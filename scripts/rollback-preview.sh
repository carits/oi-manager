#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
CURRENT_DIR="$WEB_DIR/.next-current"
PREVIOUS_DIR="$WEB_DIR/.next-previous"
FAILED_DIR="$WEB_DIR/.next-failed-$(date +%Y%m%d%H%M%S)"
WEB_UNIT="oi-manager-web.service"
USE_SYSTEMD=false

if systemctl cat "$WEB_UNIT" >/dev/null 2>&1; then
  USE_SYSTEMD=true
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "The installed $WEB_UNIT must be rolled back as root (use sudo)." >&2
    exit 1
  fi
fi

stop_published_preview() {
  if [[ "$USE_SYSTEMD" == "true" ]]; then
    systemctl stop "$WEB_UNIT"
  else
    "$ROOT_DIR/scripts/stop-preview.sh"
  fi
}

start_published_preview() {
  if [[ "$USE_SYSTEMD" == "true" ]]; then
    systemctl restart "$WEB_UNIT"
    systemctl is-active --quiet "$WEB_UNIT"
  else
    "$ROOT_DIR/scripts/start-preview.sh"
  fi
}

test -f "$PREVIOUS_DIR/BUILD_ID"
stop_published_preview
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
start_published_preview
PREVIEW_URL=http://127.0.0.1:3000/login node "$ROOT_DIR/scripts/preview-health.mjs"
echo "Previous preview restored; failed build retained at $FAILED_DIR."
