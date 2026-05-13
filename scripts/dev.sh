#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${BASH_SOURCE[0]}"
while [[ -L "$SCRIPT" ]]; do
  DIR="$(cd -P "$(dirname "$SCRIPT")" >/dev/null 2>&1 && pwd -P)"
  SCRIPT="$(readlink "$SCRIPT")"
  [[ "$SCRIPT" != /* ]] && SCRIPT="$DIR/$SCRIPT"
done
ROOT="$(cd -P "$(dirname "$SCRIPT")/.." >/dev/null 2>&1 && pwd -P)"
cd "$ROOT"

export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

PORT="${1:-5177}"
WORKTREE_LABEL="$(basename "$(dirname "$ROOT")")"
INSTANCE_NAME="${2:-Burrete Dev ${WORKTREE_LABEL}:${PORT}}"

export VITE_BURRETE_INSTANCE_NAME="$INSTANCE_NAME"

INSTANCE_QUERY="$(
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$INSTANCE_NAME"
)"

echo "Starting Burrete dev instance '${INSTANCE_NAME}' at http://127.0.0.1:${PORT}/?instance=${INSTANCE_QUERY}"
exec "$ROOT/scripts/signed-node-run.sh" pnpm --filter @burrete/desktop run dev --port "$PORT"
