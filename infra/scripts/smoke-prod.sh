#!/usr/bin/env bash
# Post-deploy smoke test against the live site, through CloudFront like a browser. Read-only: it
# never signs in, and never invokes ingest or discover (they read the inbox and pay for LLM calls).
#
#   infra/scripts/smoke-prod.sh backend               # API answers, auth is enforced
#   infra/scripts/smoke-prod.sh frontend frontend/dist  # the live page is this build, its JS loads
#
# APP_URL defaults to the prod stack's output.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
app_url="${APP_URL:-$(terraform -chdir="$root/infra/prod" output -raw app_url)}"
app_url="${app_url%/}"
failed=0

# check NAME URL STATUS [BODY_SUBSTRING]: retries for a minute (cold start, CloudFront).
check() {
  local name="$1" url="$2" want="$3" needle="${4:-}" body status
  for attempt in 1 2 3 4 5 6; do
    body="$(mktemp)"
    status="$(curl -sS -o "$body" -w '%{http_code}' --max-time 30 "$url" || echo 000)"
    if [[ "$status" == "$want" ]] && { [[ -z "$needle" ]] || grep -qF -- "$needle" "$body"; }; then
      echo "ok   $name ($status)"
      rm -f "$body"
      return 0
    fi
    rm -f "$body"
    sleep 10
  done
  echo "FAIL $name: got $status, want $want${needle:+ with \"$needle\"}" >&2
  failed=1
}

case "${1:-}" in
  backend)
    check "GET /api/health" "$app_url/api/health" 200 '"ok":true'
    check "GET /api/auth/config" "$app_url/api/auth/config" 200 '"mode":"cognito"'
    # Auth must still be enforced: no token, no data.
    check "GET /api/applications without a token" "$app_url/api/applications" 401
    ;;
  frontend)
    dist="${2:?usage: smoke-prod.sh frontend <dist dir>}"
    # The entry script's hashed name is unique to this build, so finding it in the live page
    # proves the new index.html is what CloudFront serves.
    entry="$(grep -oE '/assets/index-[^"]+\.js' "$dist/index.html" | head -1)"
    [[ -n "$entry" ]] || { echo "no /assets/index-*.js in $dist/index.html" >&2; exit 1; }
    check "GET / is this build" "$app_url/" 200 "$entry"
    check "GET a client route (SPA fallback)" "$app_url/applications" 200 "$entry"
    check "GET $entry" "$app_url$entry" 200
    ;;
  *)
    echo "usage: smoke-prod.sh backend | frontend <dist dir>" >&2
    exit 2
    ;;
esac
exit "$failed"
