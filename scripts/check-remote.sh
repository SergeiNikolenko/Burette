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

REMOTE_HOST="${BURRETE_REMOTE_HOST:-${1:-gauss}}"
REMOTE_ROOT="${BURRETE_REMOTE_ROOT:-/tmp/burrete-remote-check-${USER:-user}}"

case "$REMOTE_HOST" in
  ""|*[^A-Za-z0-9._-]*)
    echo "error: remote host must be an SSH config alias." >&2
    exit 2
    ;;
esac

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required." >&2; exit 1; }; }
require_tool ssh
require_tool rsync

cat <<MSG
Burrete remote check
  source: $ROOT
  host: $REMOTE_HOST
  remote root: $REMOTE_ROOT
MSG

ssh "$REMOTE_HOST" -- "mkdir -p '$REMOTE_ROOT'"
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.codegraph/' \
  --exclude 'build/' \
  --exclude 'node_modules/' \
  --exclude 'target/' \
  --exclude 'apps/desktop/src-tauri/target/' \
  "$ROOT/" "$REMOTE_HOST:$REMOTE_ROOT/"

ssh "$REMOTE_HOST" 'bash -seuo pipefail' <<EOF
cd "$REMOTE_ROOT"
command -v node >/dev/null 2>&1 || { echo "error: node is required on remote host." >&2; exit 1; }
node tests/test-ui-shell-contract.mjs
node tests/test-tauri-structure.mjs
EOF

echo "REMOTE CHECK SUCCEEDED: $REMOTE_HOST:$REMOTE_ROOT"
