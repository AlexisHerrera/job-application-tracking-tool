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

# Every package the Lambda code imports must be in the zip (the tests can't tell: they run with
# the dev dependencies installed). The CLI and the evals don't run in Lambda.
python3 - "$pkg" <<'PY'
import ast, pathlib, sys
pkg = pathlib.Path(sys.argv[1])
have = {p.name.split(".")[0] for p in pkg.iterdir()}
mods = set()
for f in (pkg / "jobtracker").rglob("*.py"):
    if f.parent.name in ("cli", "evals"):
        continue
    for node in ast.walk(ast.parse(f.read_text())):
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            mods.add(node.module.split(".")[0])
missing = sorted(m for m in mods - have - set(sys.stdlib_module_names) if m != "jobtracker")
if missing:
    sys.exit(f"imported by the Lambda code but not in the zip: {missing} (a runtime dependency?)")
PY

# Caches and test data aren't needed at runtime, nor bytecode from the install: it's compiled anew.
find "$pkg" -type d \( -name __pycache__ -o -name tests \) -prune -exec rm -rf {} +
find "$pkg" -name '*.pyc' -delete

# Bytecode. /var/task is read-only, so without .pyc files every cold start compiles every module
# from source (the API's imports take ~3x as long). It has to be CPython 3.12, the runtime's
# version (a .pyc of another version is ignored), whatever `python3` this machine has.
# unchecked-hash: Python loads the .pyc without comparing it to the source's mtime. -s/-p record
# the Lambda's paths, so the bytes don't depend on where this build ran.
# Not anthropic: its bytecode is 2.5 MB zipped, and deploy-backend.sh's 50 MB direct upload limit
# leaves too little room for it. The API's cold start doesn't import it (only a paste and the
# ingest and discover runs do, which then spend seconds on the LLM anyway).
py312=(uv run --no-project --python 3.12 python)
"${py312[@]}" -c 'import sys
if sys.implementation.name != "cpython" or sys.version_info[:2] != (3, 12):
    sys.exit(f"need CPython 3.12 to compile the bytecode, got {sys.version}")'
"${py312[@]}" -m compileall -q -j0 --invalidation-mode unchecked-hash -x "/package/anthropic/" -s "$pkg" -p /var/task "$pkg"

# Fixed timestamps and order, so an unchanged build gives the same zip (and Terraform sees no
# change in source_code_hash).
find "$pkg" -exec touch -t 202601010000 {} +
(cd "$pkg" && find . -type f | LC_ALL=C sort | zip -q -X -9 -@ "$out/lambda.zip")
echo "$(du -h "$out/lambda.zip" | cut -f1) $out/lambda.zip ($(du -sh "$pkg" | cut -f1) unzipped)"
