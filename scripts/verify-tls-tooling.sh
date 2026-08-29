#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DOMAIN="tls-test.example.com"
CERT="$TMP_DIR/cert.pem"
KEY="$TMP_DIR/key.pem"
OTHER_KEY="$TMP_DIR/other-key.pem"
SITE="$TMP_DIR/site.conf"
MAIN="$TMP_DIR/nginx.conf"

openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN" \
  -keyout "$KEY" -out "$CERT" >/dev/null 2>&1
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$OTHER_KEY" >/dev/null 2>&1

"$ROOT_DIR/scripts/render-tls-config.sh" \
  --domain "$DOMAIN" --certificate "$CERT" --private-key "$KEY" \
  --output "$SITE" --acme-root "$TMP_DIR/acme"

# The production template uses privileged ports. The isolated syntax check runs
# as the repository user and therefore substitutes unprivileged loopback ports.
sed -i \
  -e 's/listen 80;/listen 127.0.0.1:18080;/' \
  -e 's/listen \[::\]:80;/# IPv6 port 80 omitted by isolated verification;/' \
  -e 's/listen 443 ssl http2;/listen 127.0.0.1:18443 ssl http2;/' \
  -e 's/listen \[::\]:443 ssl http2;/# IPv6 port 443 omitted by isolated verification;/' \
  "$SITE"

cat >"$MAIN" <<EOF
pid $TMP_DIR/nginx.pid;
error_log stderr;
events {}
http {
  access_log off;
  include $SITE;
}
EOF
nginx -t -c "$MAIN" -p "$TMP_DIR" >/dev/null
grep -q 'Strict-Transport-Security' "$SITE"
grep -q 'return 308 https://' "$SITE"

if "$ROOT_DIR/scripts/render-tls-config.sh" \
  --domain "$DOMAIN" --certificate "$CERT" --private-key "$OTHER_KEY" \
  --output "$TMP_DIR/invalid.conf" >/dev/null 2>&1; then
  echo "Mismatched certificate and key were accepted" >&2
  exit 1
fi

echo "TLS tooling verification passed"
