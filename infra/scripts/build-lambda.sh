#!/usr/bin/env bash
# Build infra/build/lambda.zip: the jobtracker package plus its dependencies as Linux arm64
# wheels for Python 3.12 (the Lambda runtime). Both functions use this zip. No AWS access.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/infra/build"
pkg="$out/package"
rm -rf "$pkg" "$out/lambda.zip"
mkdir -p "$pkg"

cd "$root/backend"
# Runtime dependencies only, pinned by uv.lock. Dev tools and the local-only server stack stay out.
uv export --frozen --no-dev --no-emit-project --no-hashes --format requirements-txt \
  | grep -v -E '^(uvicorn|uvloop|watchfiles|httptools|websockets|typer|click|rich|shellingham|markdown-it-py|mdurl|pygments)==' \
  > "$out/requirements.txt"
uv pip install --quiet --target "$pkg" --python-version 3.12 \
  --python-platform aarch64-manylinux_2_28 --only-binary=:all: --no-deps \
  -r "$out/requirements.txt"
cp -R src/jobtracker "$pkg/jobtracker"

# Bytecode, caches and test data aren't needed at runtime.
find "$pkg" -type d \( -name __pycache__ -o -name tests \) -prune -exec rm -rf {} +
find "$pkg" -name '*.pyc' -delete

# Fixed timestamps and order, so an unchanged build gives the same zip (and Terraform sees no
# change in source_code_hash).
find "$pkg" -exec touch -t 202601010000 {} +
(cd "$pkg" && find . -type f | LC_ALL=C sort | zip -q -X -9 -@ "$out/lambda.zip")
echo "$(du -h "$out/lambda.zip" | cut -f1) $out/lambda.zip ($(du -sh "$pkg" | cut -f1) unzipped)"
