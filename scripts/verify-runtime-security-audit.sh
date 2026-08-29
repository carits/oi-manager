#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT INT TERM

server_env="$TEST_ROOT/server.env"
judge_env="$TEST_ROOT/judge.env"
report="$TEST_ROOT/report.json"

write_environment() {
  local csrf_required="$1"
  local csrf_origins="$2"
  cat > "$server_env" <<ENV
APP_ENV=production
JWT_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
JUDGE_TOKEN=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
ACCOUNT_ENCRYPT_KEY=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
CORS_ORIGINS=https://oj.example.edu.cn
COOKIE_SECURE=true
CSRF_REQUIRE_ORIGIN=$csrf_required
CSRF_TRUSTED_ORIGINS=$csrf_origins
ENV
  cat > "$judge_env" <<'ENV'
JUDGE_TOKEN=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
ENV
  chmod 600 "$server_env" "$judge_env"
}

run_audit() {
  RUNTIME_SERVER_ENV="$server_env" RUNTIME_JUDGE_ENV="$judge_env" \
    node "$ROOT_DIR/scripts/audit-runtime-security.mjs" > "$report"
}

write_environment true https://oj.example.edu.cn
run_audit
node - "$report" <<'NODE'
const fs = require('node:fs')
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (report.violations.length || !report.cookieSecure || !report.csrf.requireOrigin) {
  throw new Error(`Valid production security configuration was rejected: ${JSON.stringify(report)}`)
}
NODE

assert_rejected() {
  local expected="$1"
  if run_audit; then
    echo "Expected runtime security audit rejection: $expected" >&2
    exit 1
  fi
  grep -Fq "$expected" "$report" || {
    echo "Runtime security audit did not report expected violation: $expected" >&2
    exit 1
  }
}

write_environment false https://oj.example.edu.cn
assert_rejected 'COOKIE_SECURE=true requires strict CSRF Origin validation'

write_environment true '*'
assert_rejected 'CSRF_TRUSTED_ORIGINS must not contain wildcards'

write_environment true http://oj.example.edu.cn
assert_rejected 'Secure-cookie CSRF trusted origins must use HTTPS'

echo 'Runtime security verification passed: valid production config and three fail-closed cases'
