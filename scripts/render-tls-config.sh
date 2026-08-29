#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT_DIR/deploy/nginx/oi-manager-https.conf.template"
DOMAIN=""
CERTIFICATE=""
PRIVATE_KEY=""
OUTPUT=""
ACME_ROOT="/var/www/letsencrypt"

usage() {
  cat <<'EOF'
Usage: render-tls-config.sh --domain DOMAIN --certificate PATH --private-key PATH --output PATH [options]

Options:
  --acme-root PATH             ACME HTTP-01 webroot (default: /var/www/letsencrypt)

The command validates the hostname, certificate SAN, expiry and matching key,
then writes one Nginx site configuration atomically. It never installs or reloads Nginx.
EOF
}

while (($#)); do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --certificate) CERTIFICATE="${2:-}"; shift 2 ;;
    --private-key) PRIVATE_KEY="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    --acme-root) ACME_ROOT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$DOMAIN" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] || {
  echo "Invalid DNS hostname: $DOMAIN" >&2
  exit 2
}
[[ "$CERTIFICATE" = /* && -r "$CERTIFICATE" ]] || { echo "Certificate must be a readable absolute path" >&2; exit 2; }
[[ "$PRIVATE_KEY" = /* && -r "$PRIVATE_KEY" ]] || { echo "Private key must be a readable absolute path" >&2; exit 2; }
[[ "$OUTPUT" = /* ]] || { echo "Output must be an absolute path" >&2; exit 2; }
[[ "$ACME_ROOT" = /* ]] || { echo "ACME root must be an absolute path" >&2; exit 2; }

openssl x509 -in "$CERTIFICATE" -noout >/dev/null
openssl pkey -in "$PRIVATE_KEY" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 >"${OUTPUT}.key.digest.tmp"
openssl x509 -in "$CERTIFICATE" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 >"${OUTPUT}.cert.digest.tmp"
trap 'rm -f "${OUTPUT}.tmp" "${OUTPUT}.key.digest.tmp" "${OUTPUT}.cert.digest.tmp"' EXIT
cmp -s "${OUTPUT}.key.digest.tmp" "${OUTPUT}.cert.digest.tmp" || { echo "Certificate and private key do not match" >&2; exit 2; }
openssl x509 -in "$CERTIFICATE" -checkend 2592000 -noout >/dev/null || { echo "Certificate expires within 30 days" >&2; exit 2; }

san_text="$(openssl x509 -in "$CERTIFICATE" -noout -ext subjectAltName 2>/dev/null || true)"
grep -Eiq "DNS:${DOMAIN//./\.}([,[:space:]]|$)|DNS:\*\.${DOMAIN#*.}([,[:space:]]|$)" <<<"$san_text" || {
  echo "Certificate SAN does not cover $DOMAIN" >&2
  exit 2
}

escape_sed() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
mkdir -p "$(dirname "$OUTPUT")"
sed \
  -e "s|__DOMAIN__|$(escape_sed "$DOMAIN")|g" \
  -e "s|__CERTIFICATE__|$(escape_sed "$CERTIFICATE")|g" \
  -e "s|__PRIVATE_KEY__|$(escape_sed "$PRIVATE_KEY")|g" \
  -e "s|__ACME_ROOT__|$(escape_sed "$ACME_ROOT")|g" \
  "$TEMPLATE" >"${OUTPUT}.tmp"
chmod 0644 "${OUTPUT}.tmp"
mv -f "${OUTPUT}.tmp" "$OUTPUT"
echo "Rendered TLS configuration: $OUTPUT"
