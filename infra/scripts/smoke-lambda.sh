#!/usr/bin/env bash
# Pre-deploy smoke test of infra/build/package (from build-lambda.sh) inside AWS's Lambda image for
# Python 3.12 on arm64. Needs Docker; on an x86 machine also QEMU (CI: docker/setup-qemu-action).
# No AWS access.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
pkg="$root/infra/build/package"
[[ -d "$pkg/jobtracker" ]] || { echo "no $pkg: run infra/scripts/build-lambda.sh first" >&2; exit 1; }

# The base image's entrypoint is the Lambda runtime; run plain Python in it instead.
docker run --rm --platform linux/arm64 --network none -e PYTHONPATH=/var/task \
  -v "$pkg:/var/task:ro" -v "$root/infra/scripts/smoke_lambda.py:/smoke.py:ro" \
  --entrypoint python3 public.ecr.aws/lambda/python:3.12 /smoke.py
