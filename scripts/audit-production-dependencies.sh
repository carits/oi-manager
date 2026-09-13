#!/usr/bin/env bash
set -Eeuo pipefail

attempts="${SECURITY_DEPENDENCY_AUDIT_ATTEMPTS:-3}"
attempt_timeout_seconds="${SECURITY_DEPENDENCY_AUDIT_ATTEMPT_TIMEOUT_SECONDS:-180}"

[[ "$attempts" =~ ^[1-9][0-9]*$ ]] || {
  echo 'SECURITY_DEPENDENCY_AUDIT_ATTEMPTS must be a positive integer' >&2
  exit 2
}
[[ "$attempt_timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo 'SECURITY_DEPENDENCY_AUDIT_ATTEMPT_TIMEOUT_SECONDS must be a positive integer' >&2
  exit 2
}

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT INT TERM
last_status=1

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  log_file="$work_dir/attempt-$attempt.log"
  if timeout --signal=TERM --kill-after=15s "${attempt_timeout_seconds}s" \
    pnpm audit --prod --audit-level low >"$log_file" 2>&1; then
    cat "$log_file"
    if (( attempt > 1 )); then
      printf 'Production dependency audit recovered on attempt %s of %s.\n' "$attempt" "$attempts"
    fi
    exit 0
  else
    last_status=$?
  fi

  printf 'Production dependency audit attempt %s/%s failed (exit %s).\n' \
    "$attempt" "$attempts" "$last_status" >&2
  cat "$log_file" >&2
  if (( attempt < attempts )); then sleep 5; fi
done

exit "$last_status"
