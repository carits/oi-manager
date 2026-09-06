#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.run/chat-probe.env"
mkdir -p "$ROOT_DIR/.run"
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  {
    printf 'CHAT_PROBE_ENABLED=true\n'
    printf 'CHAT_PROBE_SENDER_USERNAME=__chat_probe_sender__\n'
    printf 'CHAT_PROBE_RECEIVER_USERNAME=__chat_probe_receiver__\n'
    printf 'CHAT_PROBE_SENDER_PASSWORD=%s\n' "$(openssl rand -base64 36 | tr -d '\n')"
    printf 'CHAT_PROBE_RECEIVER_PASSWORD=%s\n' "$(openssl rand -base64 36 | tr -d '\n')"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
cd "$ROOT_DIR/apps/server"
pnpm exec tsx scripts/provision-chat-probes.ts --apply
echo "Chat probe accounts are provisioned; credentials remain in $ENV_FILE."
