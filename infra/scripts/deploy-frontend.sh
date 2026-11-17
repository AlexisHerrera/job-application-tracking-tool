#!/usr/bin/env bash
# Upload the SPA to the private web bucket and invalidate CloudFront, the way CI does on a merge
# to main. ⚠ Touches AWS (S3 + CloudFront).
#
#   AWS_PROFILE=jobtracker infra/scripts/deploy-frontend.sh          # builds frontend/ first
#   infra/scripts/deploy-frontend.sh frontend/dist                   # an existing build (CI)
#
# New assets go up first (hashed names, next to the old ones), then index.html, which switches
# the site over. If the smoke test (smoke-prod.sh frontend) fails, the previous index.html goes
# back, and the old assets it points to are still there. Only after a passing smoke test are
# the assets this build doesn't use deleted.
#
# WEB_BUCKET, CLOUDFRONT_DISTRIBUTION_ID and APP_URL default to the prod stack's outputs.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
[[ -n "${CI:-}" ]] || export AWS_PROFILE="${AWS_PROFILE:-jobtracker}"
export AWS_REGION="${AWS_REGION:-us-east-1}" AWS_PAGER=""
tf_out() { terraform -chdir="$root/infra/prod" output -raw "$1"; }
bucket="${WEB_BUCKET:-$(tf_out web_bucket)}"
dist_id="${CLOUDFRONT_DISTRIBUTION_ID:-$(tf_out cloudfront_distribution_id)}"
export APP_URL="${APP_URL:-$(tf_out app_url)}"

if [[ -n "${1:-}" ]]; then
  dist="$(cd "$1" && pwd)"
else
  (cd "$root/frontend" && npm ci --no-audit --no-fund && npm run build)
  dist="$root/frontend/dist"
fi
[[ -f "$dist/index.html" ]] || { echo "no index.html in $dist" >&2; exit 1; }

# Hashed assets never change: cache them for a year. index.html must always be revalidated so
# a deploy shows up immediately.
upload_assets() { # upload_assets [--delete]
  aws s3 sync "$dist/" "s3://$bucket/" "$@" --only-show-errors \
    --exclude index.html --cache-control "public, max-age=31536000, immutable"
}
put_index() { # put_index FILE
  aws s3 cp "$1" "s3://$bucket/index.html" --only-show-errors \
    --cache-control "no-cache" --content-type "text/html; charset=utf-8"
}
invalidate() {
  local id
  id="$(aws cloudfront create-invalidation --distribution-id "$dist_id" \
    --paths "/index.html" "/" --query Invalidation.Id --output text)"
  aws cloudfront wait invalidation-completed --distribution-id "$dist_id" --id "$id"
}

previous="$(mktemp)"
aws s3 cp "s3://$bucket/index.html" "$previous" --only-show-errors

upload_assets
put_index "$dist/index.html"
invalidate

if "$root/infra/scripts/smoke-prod.sh" frontend "$dist"; then
  upload_assets --delete # drop the assets no build in use needs any more
  echo "deployed to $APP_URL"
  exit 0
fi

echo "smoke test failed: putting the previous index.html back" >&2
put_index "$previous"
invalidate
exit 1
