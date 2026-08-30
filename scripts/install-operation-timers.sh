#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${OI_MANAGER_ROOT:-/data/oi-manager-response-refactor}"
UNIT_DIR="$ROOT_DIR/deploy/systemd"
SERVICE_USER="${OPERATIONS_SERVICE_USER:-ecs-user}"
SERVICE_GROUP="${OPERATIONS_SERVICE_GROUP:-ecs-user}"
REMOVE_CRON="${OPERATIONS_REMOVE_CRON:-1}"
ENABLE_LOG_ARCHIVE="${OPERATIONS_ENABLE_LOG_ARCHIVE_TIMER:-0}"
ENV_FILE="${OPERATIONS_ENV_FILE:-/home/$SERVICE_USER/.config/oi-manager/operations.env}"

[[ "$(id -u)" -eq 0 ]] || { echo "Run as root (for example: sudo $0)." >&2; exit 1; }
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "Unknown operation service user: $SERVICE_USER" >&2; exit 2; }

required_units=(
  oi-manager-operations@.service
  oi-manager-monitor.timer
  oi-manager-backup-db.timer
  oi-manager-backup-assets.timer
  oi-manager-verify-db.timer
  oi-manager-verify-assets.timer
  oi-manager-security-baseline.timer
  oi-manager-log-archive.timer
)
enabled_timers=(
  oi-manager-monitor.timer
  oi-manager-backup-db.timer
  oi-manager-backup-assets.timer
  oi-manager-verify-db.timer
  oi-manager-verify-assets.timer
  oi-manager-security-baseline.timer
)

for unit in "${required_units[@]}"; do
  [[ -f "$UNIT_DIR/$unit" ]] || { echo "Missing operation unit: $UNIT_DIR/$unit" >&2; exit 2; }
done
[[ -x "$ROOT_DIR/scripts/run-operation-task.sh" ]] || { echo 'Operation task dispatcher is missing or not executable' >&2; exit 2; }

install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0700 \
  /data/backups/oi-manager \
  /data/backups/oi-manager/automatic \
  /data/backups/oi-manager/assets \
  /data/backups/oi-manager/security-baseline \
  /data/backups/oi-manager/log-archive-spool
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0700 "$ROOT_DIR/.run"

if [[ -e "$ENV_FILE" ]]; then
  [[ -f "$ENV_FILE" && -r "$ENV_FILE" ]] || { echo "Operations environment is not a readable regular file: $ENV_FILE" >&2; exit 2; }
  permissions="$(stat -c '%a' "$ENV_FILE")"
  owner="$(stat -c '%U' "$ENV_FILE")"
  [[ "$permissions" == 600 || "$permissions" == 400 ]] || { echo "Operations environment must have mode 600 or 400, got $permissions" >&2; exit 2; }
  [[ "$owner" == "$SERVICE_USER" ]] || { echo "Operations environment must be owned by $SERVICE_USER, got $owner" >&2; exit 2; }
fi

if [[ "$ENABLE_LOG_ARCHIVE" == 1 ]]; then
  [[ -f "$ENV_FILE" ]] || { echo 'Cannot enable log archive timer without the operations environment file' >&2; exit 2; }
  (
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    for key in LOG_ARCHIVE_COMMAND LOG_ARCHIVE_VERIFY_COMMAND; do
      value="${!key:-}"
      [[ "$value" == /* && -f "$value" && -x "$value" ]] || { echo "$key must reference an absolute executable file" >&2; exit 2; }
    done
  )
  enabled_timers+=(oi-manager-log-archive.timer)
fi

installed_units=()
for unit in "${required_units[@]}"; do
  target="/etc/systemd/system/$unit"
  install -o root -g root -m 0644 "$UNIT_DIR/$unit" "$target"
  installed_units+=("$target")
done
systemd-analyze verify "${installed_units[@]}"
systemctl daemon-reload
systemctl enable --now "${enabled_timers[@]}"

for timer in "${enabled_timers[@]}"; do
  systemctl is-enabled --quiet "$timer"
  systemctl is-active --quiet "$timer"
done

# Prove the installed dispatcher and monitor sandbox before removing the old
# schedules. If this fails, Cron remains available as the rollback path.
systemctl start oi-manager-operations@monitor.service
[[ "$(systemctl show oi-manager-operations@monitor.service --property=Result --value)" == success ]]

if [[ "$REMOVE_CRON" == 1 ]]; then
  current="$(crontab -u "$SERVICE_USER" -l 2>/dev/null || true)"
  filtered="$(printf '%s\n' "$current" | grep -vE '/scripts/(monitor-services|backup-db|backup-assets|verify-backup-restore|verify-assets-restore|run-security-baseline)\.sh' || true)"
  printf '%s\n' "$filtered" | sed '/^[[:space:]]*$/d' | crontab -u "$SERVICE_USER" -
fi

echo 'Installed persistent OI Manager operation timers:'
systemctl list-timers --all --no-pager "${enabled_timers[@]}"
