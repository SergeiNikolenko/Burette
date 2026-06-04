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

APP="${BURRETE_APP_PATH:-${1:-$ROOT/build/Burrete.app}}"
APPEX="$APP/Contents/PlugIns/BurretePreview.appex"
WEB_SOURCE="$ROOT/PreviewExtension/Web"
APP_WEB="$APP/Contents/Resources/Web"
APPEX_WEB="$APPEX/Contents/Resources/Web"
ENTITLEMENTS="$ROOT/PreviewExtension/BurretePreview.entitlements"

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required." >&2; exit 1; }; }
require_asset() {
  local path="$1"
  [[ -s "$path" ]] || { echo "error: missing web asset: $path" >&2; exit 1; }
}
clean_detritus() {
  local path="$1"
  xattr -cr "$path" 2>/dev/null || true
  dot_clean -m "$path" 2>/dev/null || true
  find "$path" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
}

require_tool bun
require_tool codesign
require_tool ditto

[[ -d "$APP/Contents" ]] || {
  echo "error: app bundle missing: $APP" >&2
  echo "Run ./scripts/build-dev.sh once before patching web assets." >&2
  exit 1
}
[[ -d "$APPEX/Contents" ]] || {
  echo "error: embedded Quick Look preview extension missing: $APPEX" >&2
  echo "Run ./scripts/build-dev.sh once before patching web assets." >&2
  exit 1
}
[[ -f "$ENTITLEMENTS" ]] || { echo "error: preview entitlements missing: $ENTITLEMENTS" >&2; exit 1; }

require_asset "$WEB_SOURCE/molstar.js"
require_asset "$WEB_SOURCE/molstar.css"
require_asset "$WEB_SOURCE/viewer-runtime.css"
require_asset "$WEB_SOURCE/viewer-shell.js"
require_asset "$WEB_SOURCE/burette-agent.js"
require_asset "$WEB_SOURCE/viewer.js"
require_asset "$WEB_SOURCE/grid-ui.js"
require_asset "$WEB_SOURCE/grid-viewer.js"
require_asset "$WEB_SOURCE/grid.css"
require_asset "$WEB_SOURCE/rdkit/RDKit_minimal.js"
require_asset "$WEB_SOURCE/rdkit/RDKit_minimal.wasm"

bun scripts/check-js-syntax.mjs \
  PreviewExtension/Web/viewer.js \
  PreviewExtension/Web/viewer-shell.js \
  PreviewExtension/Web/burette-agent.js \
  PreviewExtension/Web/grid-ui.js \
  PreviewExtension/Web/grid-viewer.js >/dev/null

cat <<MSG
Burrete web asset patch
  app: $APP
  source: $WEB_SOURCE
MSG

rm -rf "$APP_WEB" "$APPEX_WEB"
ditto --norsrc --noextattr "$WEB_SOURCE" "$APP_WEB"
ditto --norsrc --noextattr "$WEB_SOURCE" "$APPEX_WEB"
clean_detritus "$APP_WEB"
clean_detritus "$APPEX_WEB"

codesign --force --sign - --entitlements "$ENTITLEMENTS" "$APPEX" >/dev/null
codesign --force --sign - "$APP" >/dev/null
codesign --verify --deep --strict "$APP"

cmp -s "$WEB_SOURCE/viewer.js" "$APP_WEB/viewer.js" || { echo "error: app viewer.js does not match source." >&2; exit 1; }
cmp -s "$WEB_SOURCE/viewer.js" "$APPEX_WEB/viewer.js" || { echo "error: appex viewer.js does not match source." >&2; exit 1; }
cmp -s "$WEB_SOURCE/grid-ui.js" "$APP_WEB/grid-ui.js" || { echo "error: app grid-ui.js does not match source." >&2; exit 1; }
cmp -s "$WEB_SOURCE/grid-ui.js" "$APPEX_WEB/grid-ui.js" || { echo "error: appex grid-ui.js does not match source." >&2; exit 1; }
cmp -s "$WEB_SOURCE/grid-viewer.js" "$APP_WEB/grid-viewer.js" || { echo "error: app grid-viewer.js does not match source." >&2; exit 1; }
cmp -s "$WEB_SOURCE/grid-viewer.js" "$APPEX_WEB/grid-viewer.js" || { echo "error: appex grid-viewer.js does not match source." >&2; exit 1; }
cmp -s "$WEB_SOURCE/grid.css" "$APP_WEB/grid.css" || { echo "error: app grid.css does not match source." >&2; exit 1; }
cmp -s "$WEB_SOURCE/grid.css" "$APPEX_WEB/grid.css" || { echo "error: appex grid.css does not match source." >&2; exit 1; }

cat <<MSG
WEB ASSET PATCH SUCCEEDED
Restart Burrete or reopen the preview to load the patched assets.
MSG
