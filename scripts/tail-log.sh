#!/usr/bin/env bash
set -euo pipefail

LOGS=(
  "$HOME/Library/Containers/com.local.MolstarQuickLookV10.Preview/Data/Library/Caches/MolstarQuickLook/MolstarQuickLookV10.log"
  "$HOME/Library/Containers/com.local.MolstarQuickLookV10.Preview/Data/Library/Caches/MolstarQuickLook/MolstarQuickLook.log"
  "$HOME/Library/Containers/com.local.MolstarQuickLookV10.Preview/Data/Library/Application Support/MolstarQuickLook/MolstarQuickLookV10.log"
  "$HOME/Library/Containers/com.local.MolstarQuickLookV10.Preview/Data/Library/Application Support/MolstarQuickLook/MolstarQuickLook.log"
  "$HOME/Library/Caches/MolstarQuickLook/MolstarQuickLookV10.log"
  "$HOME/Library/Caches/MolstarQuickLook/MolstarQuickLook.log"
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

echo "== pluginkit Molstar entries =="
pluginkit -m -p com.apple.quicklook.preview | grep -i MolstarQuickLook || true
echo

if [[ "$FOUND" = "0" ]]; then
  echo "No MolstarQuickLook log file found in the standard locations. Checked:"
  printf '  %s\n' "${LOGS[@]}"
  echo
  echo "Searching sandbox containers and /private/var/folders for logs..."
  find "$HOME/Library/Containers" /private/var/folders \( -name MolstarQuickLookV10.log -o -name MolstarQuickLook.log \) -user "$(id -un)" -print -exec tail -500 {} \; 2>/dev/null || true
  echo
fi

echo "== Unified log, last 10 minutes =="
log show --last 10m --style compact --predicate 'eventMessage CONTAINS "MolstarQuickLookV10" OR eventMessage CONTAINS "MolstarQuickLook"' 2>/dev/null | tail -300 || true
echo
echo "Run a forced preview first:"
echo "  ./scripts/force-preview.sh samples/mini.pdb"
