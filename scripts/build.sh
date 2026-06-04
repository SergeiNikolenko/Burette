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

if [[ $# -ne 0 ]]; then
  echo "error: build.sh does not accept positional arguments." >&2
  echo "Run forced preview checks with scripts/force-preview.sh after installing the app." >&2
  exit 2
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export COPYFILE_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE_RECURSIVE=1

APP_ID="com.local.BurreteV10"
PREVIEW_ID="com.local.BurreteV10.Preview"
THUMBNAIL_ID="com.local.BurreteV10.Thumbnail"
PDB_CONTENT_TYPE="com.local.burrete10.pdb"
SAFE_ROOT_BASE="${TMPDIR:-/tmp}"
SAFE_ROOT="$(mktemp -d "${SAFE_ROOT_BASE%/}/BurreteV10BuildSafe.XXXXXX")"
LOCAL_APP="$ROOT/build/Burrete.app"
BUILD_MODE="${BURRETE_BUILD_MODE:-local}"
SIGN_IDENTITY="${BURRETE_CODESIGN_IDENTITY:--}"
DEVELOPMENT_TEAM="${BURRETE_DEVELOPMENT_TEAM:-}"
ALLOW_ADHOC_RELEASE="${BURRETE_RELEASE_ALLOW_ADHOC:-0}"
APP_METADATA_PLIST="$ROOT/apps/desktop/src-tauri/AppMetadata.plist"
VITE_BURRETE_BUILD_IDENTIFIER="$APP_ID"
VITE_BURRETE_BUILD_FLAVOR=""
VITE_BURRETE_BUILD_CHANNEL="release"
case "$BUILD_MODE" in
  local) DEFAULT_XCODE_CONFIGURATION="Debug" ;;
  release) DEFAULT_XCODE_CONFIGURATION="Release" ;;
  *) echo "error: BURRETE_BUILD_MODE must be local or release, got: $BUILD_MODE" >&2; exit 2 ;;
esac
XCODE_CONFIGURATION="${BURRETE_XCODE_CONFIGURATION:-$DEFAULT_XCODE_CONFIGURATION}"

if [[ "$BUILD_MODE" == "release" ]]; then
  [[ -z "${BURRETE_DEV_FLAVOR:-}" ]] || { echo "error: BURRETE_DEV_FLAVOR is only supported for local builds." >&2; exit 2; }
  if [[ "$ALLOW_ADHOC_RELEASE" != "1" ]]; then
    [[ "$SIGN_IDENTITY" == Developer\ ID\ Application:* ]] || { echo "error: release builds require BURRETE_CODESIGN_IDENTITY='Developer ID Application: ...'." >&2; exit 1; }
    [[ -n "$DEVELOPMENT_TEAM" ]] || { echo "error: release builds require BURRETE_DEVELOPMENT_TEAM." >&2; exit 1; }
  fi
  [[ "$XCODE_CONFIGURATION" == "Release" ]] || { echo "error: release builds require BURRETE_XCODE_CONFIGURATION=Release." >&2; exit 1; }
fi

if [[ -n "${BURRETE_DEV_FLAVOR:-}" ]]; then
  command -v bun >/dev/null 2>&1 || { echo "error: BURRETE_DEV_FLAVOR requires bun to compute the dev namespace." >&2; exit 1; }
  eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"
  APP_ID="$BURRETE_APP_ID"
  PREVIEW_ID="$BURRETE_PREVIEW_ID"
  THUMBNAIL_ID="$BURRETE_THUMBNAIL_ID"
  PDB_CONTENT_TYPE="$BURRETE_PDB_CONTENT_TYPE"
  LOCAL_APP="$ROOT/build/$BURRETE_APP_BUNDLE_NAME"
  VITE_BURRETE_BUILD_IDENTIFIER="$BURRETE_APP_ID"
  VITE_BURRETE_BUILD_FLAVOR="$BURRETE_DEV_FLAVOR_SLUG"
  VITE_BURRETE_BUILD_CHANNEL="dev"
fi
export VITE_BURRETE_BUILD_IDENTIFIER
export VITE_BURRETE_BUILD_FLAVOR
export VITE_BURRETE_BUILD_CHANNEL

cleanup_safe_root() {
  rm -rf "$SAFE_ROOT" 2>/dev/null || true
}
trap cleanup_safe_root EXIT

cat <<HDR
Burrete v10 build
  source: $ROOT
  app id: $APP_ID
  preview id: $PREVIEW_ID
  thumbnail id: $THUMBNAIL_ID
  build mode: $BUILD_MODE
  xcode configuration: $XCODE_CONFIGURATION
  signing identity: $SIGN_IDENTITY
HDR

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required. $2" >&2; exit 1; }; }
enable_release_hardened_runtime() {
  local config="$SAFE_ROOT/apps/desktop/src-tauri/tauri.conf.json"
  /usr/bin/python3 - "$config" <<'PY'
import json
import sys

config_path = sys.argv[1]
with open(config_path, "r", encoding="utf-8") as config_file:
    config = json.load(config_file)
config.setdefault("bundle", {}).setdefault("macOS", {})["hardenedRuntime"] = True
with open(config_path, "w", encoding="utf-8") as config_file:
    json.dump(config, config_file, indent=2)
    config_file.write("\n")
PY
}
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
mark_regular_desktop_app() {
  local app="$1"
  local plist="$app/Contents/Info.plist"
  [[ -f "$plist" ]] || { echo "error: app Info.plist missing: $plist" >&2; exit 1; }
  printf 'APPL????' > "$app/Contents/PkgInfo"
  /usr/libexec/PlistBuddy -c 'Delete :LSUIElement' "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c 'Add :LSUIElement bool false' "$plist"
  /usr/libexec/PlistBuddy -c 'Delete :LSBackgroundOnly' "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c 'Delete :LSRequiresCarbon' "$plist" 2>/dev/null || true
}
copy_app_plist_metadata() {
  local app="$1"
  local plist="$app/Contents/Info.plist"
  /usr/bin/python3 - "$APP_METADATA_PLIST" "$plist" <<'PY'
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
require_asset() { local p="$1"; [[ -s "$p" ]] || { echo "error: missing vendored web asset: $p" >&2; echo "Run: bun install --frozen-lockfile --ignore-scripts && bun run vendor:molstar && bun run vendor:rdkit" >&2; exit 1; }; }

require_tool bun "Install it with: brew install oven-sh/bun/bun"
require_tool cargo "Install Rust from: https://www.rust-lang.org/tools/install"
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
grep -Eq '"version": "0\.10\.[0-9]+(-[0-9A-Za-z.-]+)?"' package.json || { echo "error: this is not a v10 release package; package.json version is:" >&2; grep '"version"' package.json >&2 || true; exit 1; }
grep -q 'com.local.BurreteV10.Preview' Burrete.xcodeproj/project.pbxproj || { echo "error: this Xcode project is not v10." >&2; exit 1; }
grep -q 'preview-content-type.mjs' scripts/force-preview.sh || { echo "error: force-preview.sh is not using the preview format registry helper." >&2; exit 1; }
grep -q 'config.*preview-formats.json' scripts/preview-content-type.mjs || { echo "error: preview content type helper is not using the preview format registry." >&2; exit 1; }
bun --eval "import { readFileSync } from 'node:fs'; const registry = JSON.parse(readFileSync('config/preview-formats.json', 'utf8')); if (!registry.formats?.some((format) => format.contentType === 'com.local.burrete10.pdb')) process.exit(1);" || { echo "error: preview format registry is not v10." >&2; exit 1; }

require_asset PreviewExtension/Web/molstar.js
require_asset PreviewExtension/Web/molstar.css
require_asset PreviewExtension/Web/viewer-runtime.css
require_asset PreviewExtension/Web/viewer-shell.js
require_asset PreviewExtension/Web/burette-agent.js
require_asset PreviewExtension/Web/viewer.js
require_asset PreviewExtension/Web/grid-ui.js
require_asset PreviewExtension/Web/grid-viewer.js
require_asset PreviewExtension/Web/grid.css
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.js
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.wasm
bun scripts/check-js-syntax.mjs \
  PreviewExtension/Web/viewer.js \
  PreviewExtension/Web/viewer-shell.js \
  PreviewExtension/Web/burette-agent.js \
  PreviewExtension/Web/grid-ui.js \
  PreviewExtension/Web/grid-viewer.js >/dev/null
clean_detritus "$ROOT"
rm -f /tmp/Burrete.log "${TMPDIR:-/tmp}/Burrete.log" 2>/dev/null || true

rsync -a --delete --exclude build --exclude node_modules --exclude .git --exclude target --exclude apps/desktop/src-tauri/target "$ROOT/" "$SAFE_ROOT/"
clean_detritus "$SAFE_ROOT"
APP_METADATA_PLIST="$SAFE_ROOT/apps/desktop/src-tauri/AppMetadata.plist"
if [[ -n "${BURRETE_DEV_FLAVOR:-}" ]]; then
  bun "$ROOT/scripts/dev-namespace.mjs" patch-tree "$SAFE_ROOT" >/dev/null
fi
if [[ "$BUILD_MODE" == "release" ]]; then
  enable_release_hardened_runtime
fi

pushd "$SAFE_ROOT" >/dev/null
rm -rf build
bun install --frozen-lockfile --ignore-scripts
bun run build:tauri
cargo build --release --bin burrete-core-bridge
XCODE_SIGN_ARGS=(CODE_SIGN_IDENTITY="$SIGN_IDENTITY" CODE_SIGNING_ALLOWED=YES)
if [[ -n "$DEVELOPMENT_TEAM" ]]; then
  XCODE_SIGN_ARGS+=(CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM")
fi
xcodebuild -project Burrete.xcodeproj -scheme BurretePreview -configuration "$XCODE_CONFIGURATION" -derivedDataPath build COMPILER_INDEX_STORE_ENABLE=NO "${XCODE_SIGN_ARGS[@]}" build
xcodebuild -project Burrete.xcodeproj -scheme BurreteThumbnail -configuration "$XCODE_CONFIGURATION" -derivedDataPath build COMPILER_INDEX_STORE_ENABLE=NO "${XCODE_SIGN_ARGS[@]}" build
TAURI_BUILT_APP_CANDIDATES=(
  "apps/desktop/src-tauri/target/release/bundle/macos/Burrete.app"
  "target/release/bundle/macos/Burrete.app"
)
TAURI_BUILT_APP=""
for candidate in "${TAURI_BUILT_APP_CANDIDATES[@]}"; do
  if [[ -d "$candidate" ]]; then
    TAURI_BUILT_APP="$candidate"
    break
  fi
done
QUICKLOOK_APPEX="build/Build/Products/$XCODE_CONFIGURATION/BurretePreview.appex"
THUMBNAIL_APPEX="build/Build/Products/$XCODE_CONFIGURATION/BurreteThumbnail.appex"
CORE_BRIDGE="target/release/burrete-core-bridge"
[[ -n "$TAURI_BUILT_APP" ]] || { echo "error: Tauri app bundle missing. Checked: ${TAURI_BUILT_APP_CANDIDATES[*]}" >&2; exit 1; }
[[ -d "$QUICKLOOK_APPEX" ]] || { echo "error: Quick Look extension missing: $QUICKLOOK_APPEX" >&2; exit 1; }
[[ -d "$THUMBNAIL_APPEX" ]] || { echo "error: Quick Look thumbnail extension missing: $THUMBNAIL_APPEX" >&2; exit 1; }
[[ -x "$CORE_BRIDGE" ]] || { echo "error: burrete-core bridge helper missing: $CORE_BRIDGE" >&2; exit 1; }
ditto --norsrc --noextattr "$CORE_BRIDGE" "$QUICKLOOK_APPEX/Contents/Resources/burrete-core-bridge"
chmod 755 "$QUICKLOOK_APPEX/Contents/Resources/burrete-core-bridge"
mkdir -p "$TAURI_BUILT_APP/Contents/PlugIns"
rm -rf "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex"
rm -rf "$TAURI_BUILT_APP/Contents/PlugIns/BurreteThumbnail.appex"
ditto --norsrc --noextattr "$QUICKLOOK_APPEX" "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex"
ditto --norsrc --noextattr "$THUMBNAIL_APPEX" "$TAURI_BUILT_APP/Contents/PlugIns/BurreteThumbnail.appex"
mark_regular_desktop_app "$TAURI_BUILT_APP"
copy_app_plist_metadata "$TAURI_BUILT_APP"
clean_detritus "$TAURI_BUILT_APP"
CODESIGN_ARGS=(--force --sign "$SIGN_IDENTITY")
if [[ "$SIGN_IDENTITY" != "-" ]]; then
  CODESIGN_ARGS+=(--options runtime --timestamp)
fi
codesign "${CODESIGN_ARGS[@]}" "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex/Contents/Resources/burrete-core-bridge" >/dev/null
codesign "${CODESIGN_ARGS[@]}" --entitlements "$ROOT/PreviewExtension/BurretePreview.entitlements" "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex" >/dev/null
codesign "${CODESIGN_ARGS[@]}" --entitlements "$ROOT/PreviewExtension/BurretePreview.entitlements" "$TAURI_BUILT_APP/Contents/PlugIns/BurreteThumbnail.appex" >/dev/null
codesign "${CODESIGN_ARGS[@]}" "$TAURI_BUILT_APP" >/dev/null
clean_detritus "$TAURI_BUILT_APP"
popd >/dev/null

rm -rf "$LOCAL_APP"
mkdir -p "$(dirname "$LOCAL_APP")"
ditto --norsrc --noextattr "$SAFE_ROOT/$TAURI_BUILT_APP" "$LOCAL_APP"

actual_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_id" == "$APP_ID" ]] || { echo "error: built app id mismatch: got '${actual_id:-unknown}', expected '$APP_ID'" >&2; exit 1; }
actual_lsui="$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_lsui" == "false" ]] || { echo "error: built app is not marked as a regular Dock app (LSUIElement=false)." >&2; exit 1; }
actual_carbon="$(/usr/libexec/PlistBuddy -c 'Print :LSRequiresCarbon' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ -z "$actual_carbon" ]] || { echo "error: built app must not set LSRequiresCarbon." >&2; exit 1; }
actual_pkg_info="$(cat "$LOCAL_APP/Contents/PkgInfo" 2>/dev/null || true)"
[[ "$actual_pkg_info" == "APPL????" ]] || { echo "error: built app PkgInfo missing or invalid." >&2; exit 1; }
actual_pdb_type="$(/usr/libexec/PlistBuddy -c 'Print :UTExportedTypeDeclarations:0:UTTypeIdentifier' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_pdb_type" == "$PDB_CONTENT_TYPE" ]] || { echo "error: built app is missing Burrete exported content types." >&2; exit 1; }
[[ -x "$LOCAL_APP/Contents/MacOS/burrete" ]] || { echo "error: built Tauri app executable missing: $LOCAL_APP/Contents/MacOS/burrete" >&2; exit 1; }
[[ -d "$LOCAL_APP/Contents/PlugIns/BurretePreview.appex" ]] || { echo "error: embedded Quick Look extension missing in Tauri app." >&2; exit 1; }
[[ -x "$LOCAL_APP/Contents/PlugIns/BurretePreview.appex/Contents/Resources/burrete-core-bridge" ]] || { echo "error: embedded Quick Look extension is missing burrete-core bridge helper." >&2; exit 1; }
[[ -d "$LOCAL_APP/Contents/PlugIns/BurreteThumbnail.appex" ]] || { echo "error: embedded Quick Look thumbnail extension missing in Tauri app." >&2; exit 1; }
thumbnail_point="$(/usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionPointIdentifier' "$LOCAL_APP/Contents/PlugIns/BurreteThumbnail.appex/Contents/Info.plist" 2>/dev/null || true)"
[[ "$thumbnail_point" == "com.apple.quicklook.thumbnail" ]] || { echo "error: embedded thumbnail extension has wrong extension point: ${thumbnail_point:-unknown}" >&2; exit 1; }
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
ditto --norsrc --noextattr "$SAFE_ROOT/$TAURI_BUILT_APP" "$VERIFY_APP"
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
