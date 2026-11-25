#!/usr/bin/env bash
# Gives a git worktree its own compose stack: writes a project name and free ports to its .env.
set -euo pipefail

cd "$(dirname "$0")"
root=$(git rev-parse --show-toplevel)
git_dir=$(cd "$(git rev-parse --git-dir)" && pwd -P)
common_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
env_file="$root/.env"

value() { grep -E "^$1=" "$2" 2>/dev/null | tail -n 1 | cut -d= -f2- || true; }
in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if [ "$git_dir" = "$common_dir" ]; then
  echo "Main checkout: keeps the default stack. Nothing to do."
  exit 0
fi

if [ -z "$(value COMPOSE_PROJECT_NAME "$env_file")" ]; then
  # Orca can create several worktrees at once: pick and write the ports one worktree at a time,
  # or they all see the same free slot. mkdir is atomic; a lock older than a minute is stale.
  lock="$common_dir/worktree-env.lock"
  locked=""
  for _ in $(seq 1 100); do
    if mkdir "$lock" 2>/dev/null; then locked=1; break; fi
    if [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then rmdir "$lock" 2>/dev/null || true; fi
    sleep 0.2
  done
  [ -n "$locked" ] || { echo "Couldn't take $lock" >&2; exit 1; }
  trap 'rmdir "$lock" 2>/dev/null || true' EXIT

  # Ports of other worktrees count even if their stacks are stopped.
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
    echo "# --- this worktree's stack (scripts/worktree-env.sh) ---"
    echo "COMPOSE_PROJECT_NAME=jobtracker-$name"
    echo "API_PORT=$((8000 + slot))"
    echo "WEB_PORT=$((5173 + slot))"
    echo "DB_PORT=$((5433 + slot))"
  } >>"$env_file"
fi

echo "Stack $(value COMPOSE_PROJECT_NAME "$env_file"):"
echo "  web       http://localhost:$(value WEB_PORT "$env_file")"
echo "  api       http://localhost:$(value API_PORT "$env_file")/api/health"
echo "  postgres  localhost:$(value DB_PORT "$env_file")"
