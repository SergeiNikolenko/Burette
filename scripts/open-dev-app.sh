#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
WORKTREE_LABEL="$(basename "$(dirname "$ROOT")")"
APP_PATH="${1:-$ROOT/build/Burrete.app}"
if [[ $# -gt 0 ]]; then
  shift
fi
INSTANCE_NAME="${1:-Burrete Native Dev ${WORKTREE_LABEL}}"
if [[ $# -gt 0 ]]; then
  shift
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "error: app bundle not found: $APP_PATH" >&2
  echo "build it first with ./scripts/build.sh" >&2
  exit 1
fi

EXECUTABLE="$APP_PATH/Contents/MacOS/Burrete"
if [[ ! -x "$EXECUTABLE" ]]; then
  echo "error: app executable not found: $EXECUTABLE" >&2
  exit 1
fi

echo "Starting development app instance: $INSTANCE_NAME"
echo "Bundle: $APP_PATH"
BURRETE_DEV_INSTANCE_NAME="$INSTANCE_NAME" "$EXECUTABLE" "$@" &
