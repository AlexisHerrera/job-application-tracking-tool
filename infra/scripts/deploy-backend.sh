#!/usr/bin/env bash
# Ship infra/build/lambda.zip (from build-lambda.sh) to the three Lambdas, the way CI does on a
# merge to main. ⚠ Touches AWS: migrates the prod database and replaces the functions' code.
#
#   AWS_PROFILE=jobtracker infra/scripts/deploy-backend.sh   # from the laptop
#
# 1. Skips everything if the live code already is this zip (same SHA-256).
# 2. Saves the live zip, so a failed deploy can put it back.
# 3. Applies pending migrations to DSQL (as admin; they're idempotent and only add things).
# 4. Updates the code of api, ingest and discover, and waits until each is active.
# 5. Smoke test through CloudFront (smoke-prod.sh backend). If it fails, every function gets its
#    previous zip back and the script fails. Migrations stay: old code ignores what they added.
#
# Terraform ignores the functions' code (modules/lambda_function), so a later apply doesn't undo
# this. DSQL_ENDPOINT and APP_URL default to the prod stack's outputs (CI sets both).
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
zip="$root/infra/build/lambda.zip"
functions=(jobtracker-api jobtracker-ingest jobtracker-discover)
[[ -n "${CI:-}" ]] || export AWS_PROFILE="${AWS_PROFILE:-jobtracker}"
export AWS_REGION="${AWS_REGION:-us-east-1}" AWS_PAGER=""
tf_out() { terraform -chdir="$root/infra/prod" output -raw "$1"; }
dsql="${DSQL_ENDPOINT:-$(tf_out dsql_endpoint)}"
export APP_URL="${APP_URL:-$(tf_out app_url)}"

[[ -f "$zip" ]] || { echo "no $zip: run infra/scripts/build-lambda.sh first" >&2; exit 1; }
# A direct upload takes at most 50 MB zipped; past that it has to go through S3.
size="$(wc -c <"$zip" | tr -d ' ')"
((size < 50000000)) || { echo "lambda.zip is $size bytes, over the 50 MB direct upload" >&2; exit 1; }

new_sha="$(openssl dgst -sha256 -binary "$zip" | openssl base64 -A)"
live_sha() { aws lambda get-function-configuration --function-name "$1" --query CodeSha256 --output text; }

stale=()
for fn in "${functions[@]}"; do
  [[ "$(live_sha "$fn")" == "$new_sha" ]] || stale+=("$fn")
done
if ((${#stale[@]} == 0)); then
  echo "live code already is this zip ($new_sha): nothing to deploy"
  exit 0
fi

backup="$(mktemp -d)"
for fn in "${stale[@]}"; do
  url="$(aws lambda get-function --function-name "$fn" --query Code.Location --output text)"
  curl -sSf --max-time 120 -o "$backup/$fn.zip" "$url"
done
echo "saved the live code of ${stale[*]}"

update() { # update FUNCTION ZIP
  aws lambda update-function-code --function-name "$1" --zip-file "fileb://$2" \
    --query '[FunctionName, CodeSha256]' --output text
  aws lambda wait function-updated-v2 --function-name "$1"
}

(cd "$root/backend" && uv run --frozen jobtracker db migrate --dsql "$dsql" --profile "${AWS_PROFILE:-}")

for fn in "${stale[@]}"; do update "$fn" "$zip"; done

if "$root/infra/scripts/smoke-prod.sh" backend; then
  echo "deployed $new_sha to ${stale[*]}"
  exit 0
fi

echo "smoke test failed: rolling ${stale[*]} back to their previous code" >&2
for fn in "${stale[@]}"; do update "$fn" "$backup/$fn.zip"; done
"$root/infra/scripts/smoke-prod.sh" backend || echo "the rolled-back code fails the smoke test too" >&2
exit 1
