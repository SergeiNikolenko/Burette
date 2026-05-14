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

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export COPYFILE_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE_RECURSIVE=1

APP_ID="com.local.BurreteV10"
PREVIEW_ID="com.local.BurreteV10.Preview"
LOCAL_APP="$ROOT/build/Burrete.app"
TAURI_BUILT_APP="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Burrete.app"
XCODE_DERIVED="${BURRETE_DEV_DERIVED_DATA:-/private/tmp/BurreteV10XcodeDev}"
XCODE_LOG="$ROOT/build/xcode-dev.log"
QUICKLOOK_APPEX="$XCODE_DERIVED/Build/Products/Debug/BurretePreview.appex"

cat <<HDR
Burrete v10 dev build
  source: $ROOT
  app id: $APP_ID
  preview id: $PREVIEW_ID
HDR

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required. $2" >&2; exit 1; }; }
require_asset() {
  local path="$1"
  [[ -s "$path" ]] || {
    echo "error: missing vendored web asset: $path" >&2
    echo "Run: bun install --frozen-lockfile --ignore-scripts && bun run vendor:molstar && bun run vendor:rdkit" >&2
    exit 1
  }
}
clean_detritus() {
  local path="$1"
  [[ -e "$path" ]] || return 0
  local attrs=(
    com.apple.FinderInfo
    'com.apple.fileprovider.fpfs#P'
    com.apple.provenance
    com.apple.ResourceFork
  )
  clean_bundle() {
    local bundle="$1"
    xattr -cr "$bundle" 2>/dev/null || true
    dot_clean -m "$bundle" 2>/dev/null || true
    while IFS= read -r -d '' entry; do
      for attr in "${attrs[@]}"; do
        xattr -d "$attr" "$entry" 2>/dev/null || true
      done
    done < <(find "$bundle" -print0 2>/dev/null)
  }
  for attr in "${attrs[@]}"; do
    xattr -d "$attr" "$path" 2>/dev/null || true
  done
  if [[ "$path" == *.app || "$path" == *.appex ]]; then
    clean_bundle "$path"
  elif [[ -d "$path" ]]; then
    find "$path" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
    while IFS= read -r -d '' bundle; do
      clean_bundle "$bundle"
    done < <(find "$path" -type d \( -name '*.app' -o -name '*.appex' \) -prune -print0 2>/dev/null)
  fi
}
mark_menu_bar_app() {
  local app="$1"
  local plist="$app/Contents/Info.plist"
  [[ -f "$plist" ]] || { echo "error: app Info.plist missing: $plist" >&2; exit 1; }
  /usr/libexec/PlistBuddy -c 'Delete :LSUIElement' "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c 'Add :LSUIElement bool true' "$plist"
  /usr/libexec/PlistBuddy -c 'Delete :LSBackgroundOnly' "$plist" 2>/dev/null || true
}
copy_app_plist_metadata() {
  local app="$1"
  local plist="$app/Contents/Info.plist"
  /usr/bin/python3 - "$ROOT/apps/desktop/src-tauri/AppMetadata.plist" "$plist" <<'PY'
import plistlib
import sys

source_path, target_path = sys.argv[1:3]
with open(source_path, "rb") as source_file:
    source = plistlib.load(source_file)
with open(target_path, "rb") as target_file:
    target = plistlib.load(target_file)
for key in ("CFBundleDocumentTypes", "UTExportedTypeDeclarations"):
    target[key] = source[key]
with open(target_path, "wb") as target_file:
    plistlib.dump(target, target_file, sort_keys=False)
PY
}

require_tool bun "Install it with: brew install oven-sh/bun/bun"
require_tool xcodebuild "Install full Xcode from the App Store."
require_tool ditto "ditto is normally present on macOS."

require_asset PreviewExtension/Web/molstar.js
require_asset PreviewExtension/Web/molstar.css
require_asset PreviewExtension/Web/burette-agent.js
require_asset PreviewExtension/Web/viewer.js
require_asset PreviewExtension/Web/grid-viewer.js
require_asset PreviewExtension/Web/grid.css
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.js
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.wasm
require_asset PreviewExtension/Web/xyz-fast.js

bun scripts/check-js-syntax.mjs \
  PreviewExtension/Web/viewer.js \
  PreviewExtension/Web/burette-agent.js \
  PreviewExtension/Web/grid-viewer.js \
  PreviewExtension/Web/xyz-fast.js >/dev/null

if [[ ! -d node_modules || ! -d node_modules/@hugeicons/core-free-icons || ! -d node_modules/@tauri-apps/cli ]]; then
  bun install --frozen-lockfile --ignore-scripts
fi

bun run build:tauri
mkdir -p "$XCODE_DERIVED" "$(dirname "$XCODE_LOG")"
if ! xcodebuild -project Burrete.xcodeproj -scheme BurretePreview -configuration Debug -derivedDataPath "$XCODE_DERIVED" COMPILER_INDEX_STORE_ENABLE=NO CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build >"$XCODE_LOG" 2>&1; then
  echo "error: Xcode build failed. Last log lines:" >&2
  tail -80 "$XCODE_LOG" >&2
  exit 1
fi
echo "Xcode build log: $XCODE_LOG"

[[ -d "$TAURI_BUILT_APP" ]] || { echo "error: Tauri app bundle missing: $TAURI_BUILT_APP" >&2; exit 1; }
[[ -d "$QUICKLOOK_APPEX" ]] || { echo "error: Quick Look extension missing: $QUICKLOOK_APPEX" >&2; exit 1; }

mkdir -p "$TAURI_BUILT_APP/Contents/PlugIns"
rm -rf "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex"
ditto --norsrc --noextattr "$QUICKLOOK_APPEX" "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex"
mark_menu_bar_app "$TAURI_BUILT_APP"
copy_app_plist_metadata "$TAURI_BUILT_APP"
clean_detritus "$TAURI_BUILT_APP"

rm -rf "$LOCAL_APP"
mkdir -p "$(dirname "$LOCAL_APP")"
ditto --norsrc --noextattr "$TAURI_BUILT_APP" "$LOCAL_APP"

actual_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_id" == "$APP_ID" ]] || { echo "error: built app id mismatch: got '${actual_id:-unknown}', expected '$APP_ID'" >&2; exit 1; }
actual_lsui="$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_lsui" == "true" ]] || { echo "error: built app is not marked as menu bar accessory (LSUIElement=true)." >&2; exit 1; }
[[ -x "$LOCAL_APP/Contents/MacOS/burrete" ]] || { echo "error: built Tauri app executable missing: $LOCAL_APP/Contents/MacOS/burrete" >&2; exit 1; }
[[ -d "$LOCAL_APP/Contents/PlugIns/BurretePreview.appex" ]] || { echo "error: embedded Quick Look extension missing in Tauri app." >&2; exit 1; }
grep -q 'aria-label="Collapse controls"' "$LOCAL_APP/Contents/Resources/Web/index.html" || { echo "error: built web preview shell is missing toolbar grip affordance." >&2; exit 1; }

cat <<MSG

DEV BUILD SUCCEEDED: Burrete v10
Built staging app:
  $LOCAL_APP

Install current staging app:
  ./scripts/install.sh

Full clean release verification:
  ./scripts/build.sh
MSG
