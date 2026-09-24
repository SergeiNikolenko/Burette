#!/usr/bin/env bash
# Unregister Burette bundles that Launch Services still remembers after the
# bundle was deleted or moved to the Trash. Stale records keep claiming shared
# UTIs such as com.schrodinger.mol, and Quick Look then fails with
# "Extension com.local.BuretteV10...Preview not found".
set -euo pipefail

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
DRY_RUN=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac
[[ -x "$LSREGISTER" ]] || { echo "lsregister not found; nothing to prune."; exit 0; }

TRASH="$HOME/.Trash"
count=0
while IFS= read -r bundle_path; do
  [[ -n "$bundle_path" ]] || continue
  if [[ -e "$bundle_path" && "$bundle_path" != "$TRASH/"* ]]; then
    continue
  fi
  count=$((count + 1))
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "stale: $bundle_path"
  else
    echo "Unregistering stale bundle: $bundle_path"
    "$LSREGISTER" -u "$bundle_path" 2>/dev/null || true
  fi
done < <(
  "$LSREGISTER" -dump 2>/dev/null |
    awk '
      /^----/ { path = ""; next }
      $1 == "path:" {
        path = substr($0, index($0, $2))
        sub(/ \(0x[0-9a-fA-F]+\)$/, "", path)
        next
      }
      $1 == "identifier:" && path != "" && $2 ~ /^com\.local\.(BuretteV10|BurreteV10)/ {
        app = path
        cut = index(app, ".app/")
        if (cut > 0) app = substr(app, 1, cut + 3)
        if (app ~ /\.app$/) print app
      }
    ' |
    sort -u
)
if [[ "$DRY_RUN" == "1" ]]; then
  echo "Found $count stale Burette Launch Services registrations."
else
  echo "Unregistered $count stale Burette Launch Services registrations."
fi
