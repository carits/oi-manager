#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 或 sudo 运行此脚本。" >&2
  exit 1
fi
command -v certbot >/dev/null 2>&1 || {
  echo "未检测到 certbot。请先安装发行版 certbot，再运行本脚本。" >&2
  exit 1
}
ACME_ROOT="${ACME_ROOT:-/var/www/letsencrypt}"
HOOK="/etc/letsencrypt/renewal-hooks/deploy/oi-manager-nginx-reload.sh"
install -d -o root -g root -m 0755 "${ACME_ROOT}/.well-known/acme-challenge"
install -d -o root -g root -m 0755 "$(dirname "${HOOK}")"
cat > "${HOOK}" <<'HOOK'
#!/bin/sh
set -eu
/usr/sbin/nginx -t
/bin/systemctl reload nginx
HOOK
chown root:root "${HOOK}"
chmod 0755 "${HOOK}"
systemctl enable --now certbot.timer
systemctl is-enabled --quiet certbot.timer
systemctl is-active --quiet certbot.timer
echo "证书续期定时器已启用，部署钩子已安装：${HOOK}"
certbot certificates
