#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_URL="${LOAD_URL:-http://127.0.0.1:3002/api/platform-bindings/platforms}"
REQUESTS="${LOAD_REQUESTS:-500}"
CONCURRENCY="${LOAD_CONCURRENCY:-20}"

case "$TARGET_URL" in
  http://127.0.0.1:3002/api/health|http://127.0.0.1:3002/api/platform-bindings/platforms|http://127.0.0.1:3000/api/health|http://127.0.0.1:3000/api/platform-bindings/platforms|http://127.0.0.1:3000/login)
    ;;
  *)
    echo "Refusing non-loopback or non-read-only target: $TARGET_URL" >&2
    exit 2
    ;;
esac

if ! [[ "$REQUESTS" =~ ^[1-9][0-9]*$ ]] || [ "$REQUESTS" -gt 5000 ]; then
  echo "LOAD_REQUESTS must be an integer from 1 to 5000" >&2
  exit 2
fi
if ! [[ "$CONCURRENCY" =~ ^[1-9][0-9]*$ ]] || [ "$CONCURRENCY" -gt 100 ]; then
  echo "LOAD_CONCURRENCY must be an integer from 1 to 100" >&2
  exit 2
fi

result_file="$(mktemp)"
time_file="$(mktemp)"
cleanup() {
  rm -f -- "$result_file" "$time_file"
}
trap cleanup EXIT

started_at="$(date +%s%N)"
export TARGET_URL
seq "$REQUESTS" | xargs -P "$CONCURRENCY" -n 1 sh -c '
  curl --silent --show-error --output /dev/null --max-time 10 \
    --write-out "%{http_code} %{time_total} %{size_download}\n" "$TARGET_URL"
' _ > "$result_file"
finished_at="$(date +%s%N)"

awk '{ print $2 }' "$result_file" | sort -n > "$time_file"
summary="$(awk -v expected="$REQUESTS" '
  BEGIN { count=0; ok=0; total=0; max=0; bytes=0 }
  {
    count++
    if ($1 >= 200 && $1 < 400) ok++
    total += $2
    if ($2 > max) max=$2
    bytes += $3
  }
  END {
    printf "requests=%d expected=%d successful=%d failed=%d avg_ms=%.2f max_ms=%.2f bytes=%d", count, expected, ok, count-ok, count ? total*1000/count : 0, max*1000, bytes
  }
' "$result_file")"

p50_index="$(( (REQUESTS * 50 + 99) / 100 ))"
p95_index="$(( (REQUESTS * 95 + 99) / 100 ))"
p50="$(sed -n "${p50_index}p" "$time_file")"
p95="$(sed -n "${p95_index}p" "$time_file")"
elapsed_ms="$(( (finished_at - started_at) / 1000000 ))"
throughput="$(awk -v requests="$REQUESTS" -v elapsed="$elapsed_ms" 'BEGIN { printf "%.2f", elapsed ? requests * 1000 / elapsed : 0 }')"

printf 'target=%s concurrency=%s elapsed_ms=%s throughput_rps=%s %s p50_ms=%.2f p95_ms=%.2f\n' \
  "$TARGET_URL" "$CONCURRENCY" "$elapsed_ms" "$throughput" "$summary" \
  "$(awk -v value="$p50" 'BEGIN { print value * 1000 }')" \
  "$(awk -v value="$p95" 'BEGIN { print value * 1000 }')"

failed_count="$(awk '$1 < 200 || $1 >= 400 { count++ } END { print count+0 }' "$result_file")"
if [ "$failed_count" -ne 0 ]; then
  exit 1
fi
