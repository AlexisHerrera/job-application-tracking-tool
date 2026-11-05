#!/usr/bin/env bash
# Build the SPA and upload it to the private web bucket, then invalidate CloudFront.
# ⚠ Touches AWS (S3 + CloudFront). Needs `terraform apply` in infra/prod first.
#   AWS_PROFILE=jobtracker infra/scripts/deploy-frontend.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
profile="${AWS_PROFILE:-jobtracker}"
cd "$root/infra/prod"
bucket="$(terraform output -raw web_bucket)"
dist_id="$(terraform output -raw cloudfront_distribution_id)"

cd "$root/frontend"
npm ci --no-audit --no-fund
npm run build

# Hashed assets never change: cache them for a year. index.html must always be revalidated so
# a deploy shows up immediately.
aws s3 sync dist/ "s3://$bucket/" --profile "$profile" --delete \
  --exclude index.html --cache-control "public, max-age=31536000, immutable"
aws s3 cp dist/index.html "s3://$bucket/index.html" --profile "$profile" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"
aws cloudfront create-invalidation --profile "$profile" --distribution-id "$dist_id" \
  --paths "/index.html" "/" >/dev/null
echo "deployed to $(cd "$root/infra/prod" && terraform output -raw app_url)"
