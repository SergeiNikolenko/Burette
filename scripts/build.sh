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
SAFE_ROOT_BASE="${TMPDIR:-/tmp}"
SAFE_ROOT="$(mktemp -d "${SAFE_ROOT_BASE%/}/BurreteV10BuildSafe.XXXXXX")"
LOCAL_APP="$ROOT/build/Burrete.app"

cleanup_safe_root() {
  rm -rf "$SAFE_ROOT" 2>/dev/null || true
}
trap cleanup_safe_root EXIT

cat <<HDR
Burrete v10 build
  source: $ROOT
  app id: $APP_ID
  preview id: $PREVIEW_ID
HDR

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required. $2" >&2; exit 1; }; }
clean_detritus() {
  local p="$1"
  [[ -e "$p" ]] || return 0
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
    xattr -d "$attr" "$p" 2>/dev/null || true
  done
  if [[ "$p" == *.app || "$p" == *.appex ]]; then
    clean_bundle "$p"
  elif [[ -d "$p" ]]; then
    find "$p" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
    while IFS= read -r -d '' bundle; do
      clean_bundle "$bundle"
    done < <(find "$p" -type d \( -name '*.app' -o -name '*.appex' \) -prune -print0 2>/dev/null)
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
require_asset() { local p="$1"; [[ -s "$p" ]] || { echo "error: missing vendored web asset: $p" >&2; echo "Run: npm ci --ignore-scripts && npm run vendor:molstar && npm run vendor:rdkit" >&2; exit 1; }; }

require_tool node "Install it with: brew install node"
require_tool npm "Install it with: brew install node"
require_tool xcodebuild "Install full Xcode from the App Store."
require_tool rsync "rsync is normally present on macOS."
require_tool ditto "ditto is normally present on macOS."

if ! xcodebuild -version >/dev/null 2>&1; then
  active_dir="$(xcode-select -p 2>/dev/null || true)"
  echo "error: xcodebuild is not usable. Active developer directory is: ${active_dir:-unknown}" >&2
  echo "Use: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi

case "$ROOT" in *"/.Trash/"*|*"/Library/Mobile Documents/.Trash/"*)
  echo "error: this project is physically inside macOS Trash/iCloud Trash: $ROOT" >&2
  echo "Delete it and unzip v10 to ~/Desktop/BurreteV10" >&2
  exit 1;;
esac

# Prevent accidentally running old v5/v6/v7/v8 folders.
grep -Eq '"version": "0\.10\.[0-9]+"' package.json || { echo "error: this is not a v10 release package; package.json version is:" >&2; grep '"version"' package.json >&2 || true; exit 1; }
grep -q 'com.local.BurreteV10.Preview' Burrete.xcodeproj/project.pbxproj || { echo "error: this Xcode project is not v10." >&2; exit 1; }
grep -q 'com.local.burrete10.pdb' scripts/force-preview.sh || { echo "error: force-preview.sh is not v10." >&2; exit 1; }

require_asset PreviewExtension/Web/molstar.js
require_asset PreviewExtension/Web/molstar.css
require_asset PreviewExtension/Web/viewer-runtime.css
require_asset PreviewExtension/Web/viewer-shell.js
require_asset PreviewExtension/Web/burette-agent.js
require_asset PreviewExtension/Web/viewer.js
require_asset PreviewExtension/Web/grid-viewer.js
require_asset PreviewExtension/Web/grid.css
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.js
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.wasm
require_asset PreviewExtension/Web/xyz-fast.js
node --check PreviewExtension/Web/viewer.js >/dev/null
node --check PreviewExtension/Web/viewer-shell.js >/dev/null
node --check PreviewExtension/Web/burette-agent.js >/dev/null
node --check PreviewExtension/Web/grid-viewer.js >/dev/null
node --check PreviewExtension/Web/xyz-fast.js >/dev/null
clean_detritus "$ROOT"
rm -f /tmp/Burrete.log "${TMPDIR:-/tmp}/Burrete.log" 2>/dev/null || true

rsync -a --delete --exclude build --exclude node_modules --exclude .git --exclude apps/desktop/src-tauri/target "$ROOT/" "$SAFE_ROOT/"
clean_detritus "$SAFE_ROOT"

pushd "$SAFE_ROOT" >/dev/null
rm -rf build
npm ci --ignore-scripts
npm run build:tauri
xcodebuild -project Burrete.xcodeproj -scheme BurretePreview -configuration Debug -derivedDataPath build COMPILER_INDEX_STORE_ENABLE=NO CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
TAURI_BUILT_APP="apps/desktop/src-tauri/target/release/bundle/macos/Burrete.app"
QUICKLOOK_APPEX="build/Build/Products/Debug/BurretePreview.appex"
[[ -d "$TAURI_BUILT_APP" ]] || { echo "error: Tauri app bundle missing: $TAURI_BUILT_APP" >&2; exit 1; }
[[ -d "$QUICKLOOK_APPEX" ]] || { echo "error: Quick Look extension missing: $QUICKLOOK_APPEX" >&2; exit 1; }
mkdir -p "$TAURI_BUILT_APP/Contents/PlugIns"
rm -rf "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex"
ditto --norsrc --noextattr "$QUICKLOOK_APPEX" "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex"
mark_menu_bar_app "$TAURI_BUILT_APP"
copy_app_plist_metadata "$TAURI_BUILT_APP"
clean_detritus "$TAURI_BUILT_APP"
codesign --force --sign - --entitlements "$ROOT/PreviewExtension/BurretePreview.entitlements" "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex" >/dev/null
codesign --force --sign - "$TAURI_BUILT_APP" >/dev/null
clean_detritus "$TAURI_BUILT_APP"
popd >/dev/null

rm -rf "$LOCAL_APP"
mkdir -p "$(dirname "$LOCAL_APP")"
ditto --norsrc --noextattr "$SAFE_ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Burrete.app" "$LOCAL_APP"

actual_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_id" == "$APP_ID" ]] || { echo "error: built app id mismatch: got '${actual_id:-unknown}', expected '$APP_ID'" >&2; exit 1; }
actual_lsui="$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_lsui" == "true" ]] || { echo "error: built app is not marked as menu bar accessory (LSUIElement=true)." >&2; exit 1; }
actual_pdb_type="$(/usr/libexec/PlistBuddy -c 'Print :UTExportedTypeDeclarations:0:UTTypeIdentifier' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_pdb_type" == "com.local.burrete10.pdb" ]] || { echo "error: built app is missing Burrete exported content types." >&2; exit 1; }
[[ -x "$LOCAL_APP/Contents/MacOS/burrete" ]] || { echo "error: built Tauri app executable missing: $LOCAL_APP/Contents/MacOS/burrete" >&2; exit 1; }
[[ -d "$LOCAL_APP/Contents/PlugIns/BurretePreview.appex" ]] || { echo "error: embedded Quick Look extension missing in Tauri app." >&2; exit 1; }
BUILT_WEB_INDEX="$LOCAL_APP/Contents/Resources/Web/index.html"
BUILT_VIEWER_SHELL="$LOCAL_APP/Contents/Resources/Web/viewer-shell.js"
[[ -s "$BUILT_WEB_INDEX" ]] || { echo "error: built web preview shell missing: $BUILT_WEB_INDEX" >&2; exit 1; }
[[ -s "$BUILT_VIEWER_SHELL" ]] || { echo "error: built shared viewer shell missing: $BUILT_VIEWER_SHELL" >&2; exit 1; }
grep -q 'buret-renderer-choice' "$BUILT_VIEWER_SHELL" || { echo "error: built shared viewer shell is missing compact renderer controls." >&2; exit 1; }
grep -q 'aria-label="Collapse controls"' "$BUILT_VIEWER_SHELL" || { echo "error: built shared viewer shell is missing toolbar grip affordance." >&2; exit 1; }
grep -q '>Seq<' "$BUILT_VIEWER_SHELL" || { echo "error: built shared viewer shell is missing text toolbar controls." >&2; exit 1; }
if grep -q 'VESTA' "$BUILT_VIEWER_SHELL"; then
  echo "error: built shared viewer shell still contains removed VESTA toolbar control." >&2
  exit 1
fi
VERIFY_APP="$SAFE_ROOT/verify/Burrete.app"
rm -rf "$SAFE_ROOT/verify"
mkdir -p "$SAFE_ROOT/verify"
ditto --norsrc --noextattr "$SAFE_ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Burrete.app" "$VERIFY_APP"
clean_detritus "$VERIFY_APP"
codesign --verify --deep --strict "$VERIFY_APP"

cat <<MSG

BUILD SUCCEEDED: Burrete v10
Built:
  $LOCAL_APP

Next step:
  ./scripts/install.sh

Quick smoke test after install:
  ./scripts/force-preview.sh samples/mini.pdb
MSG
