#!/usr/bin/env bash
# Smoke-check a deployed URL, retrying through the Cloudflare custom-domain
# DNS + edge-cert propagation window that follows a first-ever `wrangler deploy`.
#
# With `custom_domain = true` in wrangler.toml, `wrangler deploy` creates the
# DNS record and provisions the TLS cert automatically. On the first deploy
# of a new custom domain, that provisioning can take a minute or two, so an
# immediate request may not resolve yet. Retrying with backoff lets the gate
# reflect the deploy outcome instead of propagation timing.
#
# Usage: smoke-url.sh <url> <expected-status> [max-attempts] [sleep-seconds]
set -euo pipefail

URL="${1:?usage: smoke-url.sh <url> <expected-status> [max-attempts] [sleep-seconds]}"
EXPECTED="${2:?expected HTTP status code required}"
MAX_ATTEMPTS="${3:-10}"
SLEEP_SECONDS="${4:-15}"

attempt=1
last_status="000"
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  # No -f: a 404 gate must read the real status code, not treat it as an error.
  # `|| true` keeps connection failures (e.g. unresolved host) retryable.
  last_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$URL" || true)
  last_status="${last_status:-000}"
  if [ "$last_status" = "$EXPECTED" ]; then
    echo "OK: $URL returned HTTP $EXPECTED (attempt $attempt/$MAX_ATTEMPTS)"
    exit 0
  fi
  echo "attempt $attempt/$MAX_ATTEMPTS: $URL returned HTTP $last_status, want $EXPECTED — retrying in ${SLEEP_SECONDS}s"
  attempt=$((attempt + 1))
  [ "$attempt" -le "$MAX_ATTEMPTS" ] && sleep "$SLEEP_SECONDS"
done

echo "::error::$URL returned HTTP $last_status after $MAX_ATTEMPTS attempts, expected $EXPECTED"
exit 1
