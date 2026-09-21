#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PREVIEW_ID="com.local.BuretteV10.Preview"
if [[ -n "${BURETTE_DEV_FLAVOR:-}" ]]; then
  command -v bun >/dev/null 2>&1 || { echo "error: BURETTE_DEV_FLAVOR requires bun to compute the dev namespace." >&2; exit 1; }
  eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"
  PREVIEW_ID="$BURETTE_PREVIEW_ID"
fi

LOGS=(
  "$HOME/Library/Containers/$PREVIEW_ID/Data/Library/Caches/Burette/BuretteV10.log"
  "$HOME/Library/Containers/$PREVIEW_ID/Data/Library/Caches/Burette/Burette.log"
  "$HOME/Library/Containers/$PREVIEW_ID/Data/Library/Application Support/Burette/BuretteV10.log"
  "$HOME/Library/Containers/$PREVIEW_ID/Data/Library/Application Support/Burette/Burette.log"
  "$HOME/Library/Caches/Burette/BuretteV10.log"
  "$HOME/Library/Caches/Burette/Burette.log"
)

FOUND=0
for LOG in "${LOGS[@]}"; do
  if [[ -f "$LOG" ]]; then
    FOUND=1
    echo "== $LOG =="
    tail -500 "$LOG"
    echo
  fi
done

echo "== pluginkit Burette entries =="
pluginkit -m -p com.apple.quicklook.preview | grep -i Burette || true
echo

if [[ "$FOUND" = "0" ]]; then
  echo "No Burette log file found in the standard locations. Checked:"
  printf '  %s\n' "${LOGS[@]}"
  echo
  echo "Searching sandbox containers and /private/var/folders for logs..."
  find "$HOME/Library/Containers" /private/var/folders \( -name BuretteV10.log -o -name Burette.log \) -user "$(id -un)" -print -exec tail -500 {} \; 2>/dev/null || true
  echo
fi

echo "== Unified log, last 10 minutes =="
log show --last 10m --style compact --predicate 'eventMessage CONTAINS "BuretteV10" OR eventMessage CONTAINS "Burette"' 2>/dev/null | tail -300 || true
echo
echo "Run a forced preview first:"
echo "  ./scripts/force-preview.sh samples/mini.pdb"
