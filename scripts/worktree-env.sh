#!/usr/bin/env bash
# Gives a git worktree its own docker compose stack: project name, ports and database.
# Run it once in a new worktree (it's idempotent), then use plain `docker compose` as usual.
# It appends COMPOSE_PROJECT_NAME, API_PORT, WEB_PORT and DB_PORT to the worktree's .env;
# compose reads them from there. The main checkout keeps the defaults (jobtracker, 8000/5173/5433).
set -euo pipefail

cd "$(dirname "$0")"  # the checkout this copy of the script lives in, wherever it's called from
root=$(git rev-parse --show-toplevel)
git_dir=$(cd "$(git rev-parse --git-dir)" && pwd -P)
common_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
env_file="$root/.env"

# Last value of KEY in an env file, or nothing.
value() { grep -E "^$1=" "$2" 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }
in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if [ "$git_dir" = "$common_dir" ]; then
  echo "Main checkout: it keeps the default stack (jobtracker, ports 8000/5173/5433). Nothing to do."
  exit 0
fi

if [ -z "$(value COMPOSE_PROJECT_NAME "$env_file")" ]; then
  # Ports other worktrees already own: their stacks may be stopped, so the ports would look free.
  claimed=" "
  while read -r path; do
    [ "$path" = "$root" ] || claimed="$claimed$(value API_PORT "$path/.env") "
  done < <(git worktree list --porcelain | sed -n 's/^worktree //p')

  slot=""
  for n in $(seq 1 99); do
    case "$claimed" in *" $((8000 + n)) "*) continue ;; esac
    in_use $((8000 + n)) || in_use $((5173 + n)) || in_use $((5433 + n)) || { slot=$n; break; }
  done
  [ -n "$slot" ] || { echo "No free port slot between 1 and 99" >&2; exit 1; }

  name=$(basename "$root" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//')
  {
    if [ -s "$env_file" ] && [ -n "$(tail -c 1 "$env_file")" ]; then echo; fi
    echo "# --- This worktree's own docker compose stack (scripts/worktree-env.sh) ---"
    echo "COMPOSE_PROJECT_NAME=jobtracker-$name"
    echo "API_PORT=$((8000 + slot))"
    echo "WEB_PORT=$((5173 + slot))"
    echo "DB_PORT=$((5433 + slot))"
  } >>"$env_file"
fi

echo "Stack $(value COMPOSE_PROJECT_NAME "$env_file") (settings in $env_file):"
echo "  web       http://localhost:$(value WEB_PORT "$env_file")"
echo "  api       http://localhost:$(value API_PORT "$env_file")/api/health"
echo "  postgres  localhost:$(value DB_PORT "$env_file")  (its own empty database; tests use it too)"
echo "Start it with: docker compose up -d --build   Remove it before deleting the worktree: docker compose down -v"
