#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${OI_MANAGER_ROOT:-/data/oi-manager-response-refactor}"
SOURCE_FILE="$ROOT_DIR/deploy/sshd/99-oi-manager-hardening.conf"
TARGET_FILE="/etc/ssh/sshd_config.d/99-oi-manager-hardening.conf"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (for example: sudo $0)." >&2
  exit 1
fi
test -f "$SOURCE_FILE" || { echo "Missing SSH hardening source: $SOURCE_FILE" >&2; exit 1; }
login_user="${SSH_HARDENING_LOGIN_USER:-${SUDO_USER:-root}}"
login_home="$(getent passwd "$login_user" | cut -d: -f6)"
test -n "$login_home" || { echo "Cannot resolve login home for $login_user" >&2; exit 1; }
key_dir="$login_home/.ssh"
key_file="$key_dir/authorized_keys"
test -s "$key_file" || { echo "Refusing to disable passwords without $key_file" >&2; exit 1; }
grep -Eqv '^[[:space:]]*(#|$)' "$key_file" || { echo "$key_file has no active public keys" >&2; exit 1; }
[[ "$(stat -c '%a' "$key_dir")" == "700" ]] || { echo "$key_dir must have mode 700" >&2; exit 1; }
[[ "$(stat -c '%a' "$key_file")" == "600" ]] || { echo "$key_file must have mode 600" >&2; exit 1; }
sudo -l -U "$login_user" >/dev/null 2>&1 || { echo "$login_user must retain sudo access" >&2; exit 1; }

backup_file="$(mktemp)"
had_previous=0
if [[ -f "$TARGET_FILE" ]]; then
  cp -- "$TARGET_FILE" "$backup_file"
  had_previous=1
fi

rollback() {
  if [[ "$had_previous" -eq 1 ]]; then
    install -o root -g root -m 0644 "$backup_file" "$TARGET_FILE"
  else
    rm -f -- "$TARGET_FILE"
  fi
  /usr/sbin/sshd -t || true
  systemctl reload ssh.service 2>/dev/null || systemctl reload sshd.service 2>/dev/null || true
  rm -f -- "$backup_file"
}
trap rollback ERR

install -o root -g root -m 0644 "$SOURCE_FILE" "$TARGET_FILE"
/usr/sbin/sshd -t
effective="$(/usr/sbin/sshd -T)"
grep -qx 'pubkeyauthentication yes' <<<"$effective"
grep -qx 'passwordauthentication no' <<<"$effective"
grep -qx 'kbdinteractiveauthentication no' <<<"$effective"
grep -Eq '^permitrootlogin (prohibit-password|without-password)$' <<<"$effective"
grep -qx 'maxauthtries 4' <<<"$effective"

systemctl reload ssh.service 2>/dev/null || systemctl reload sshd.service
trap - ERR
rm -f -- "$backup_file"

echo "SSH hardening installed and daemon reloaded."
/usr/sbin/sshd -T | grep -E '^(pubkeyauthentication|passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries) '
