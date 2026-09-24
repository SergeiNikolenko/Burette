#!/usr/bin/env bash
# Remove a dev-flavor install and its Launch Services / PlugInKit records.
# Deleting the bundle alone leaves the registration behind; see
# docs/quicklook-debugging.md#stale-launch-services-registrations.
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[[ -n "${BURETTE_DEV_FLAVOR:-}" ]] || {
  echo "error: set BURETTE_DEV_FLAVOR to the flavor to uninstall; release installs are not removed by this script." >&2
  exit 2
}
command -v bun >/dev/null 2>&1 || { echo "error: BURETTE_DEV_FLAVOR requires bun to compute the dev namespace." >&2; exit 1; }
eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"

for bundle in "$HOME/Applications/$BURETTE_APP_BUNDLE_NAME" "$ROOT/build/$BURETTE_APP_BUNDLE_NAME"; do
  [[ -d "$bundle" ]] || continue
  pkill -f "$bundle/Contents/MacOS/" 2>/dev/null || true
  for appex in "$bundle"/Contents/PlugIns/*.appex; do
    [[ -d "$appex" ]] && pluginkit -r "$appex" 2>/dev/null || true
  done
  [[ -x "$LSREGISTER" ]] && "$LSREGISTER" -u "$bundle" 2>/dev/null || true
  rm -rf "$bundle"
  echo "Removed $bundle"
done
pluginkit -r "$BURETTE_PREVIEW_ID" 2>/dev/null || true
pluginkit -r "$BURETTE_THUMBNAIL_ID" 2>/dev/null || true

"$ROOT/scripts/prune-launch-services.sh"
qlmanage -r >/dev/null 2>&1 || true
qlmanage -r cache >/dev/null 2>&1 || true
killall quicklookd 2>/dev/null || true
