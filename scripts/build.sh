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

export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
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
  if [[ "$p" == *.app || "$p" == *.appex ]]; then
    xattr -cr "$p" 2>/dev/null || true
    dot_clean -m "$p" 2>/dev/null || true
  fi
  if [[ -d "$p" ]]; then
    find "$p" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
    while IFS= read -r -d '' bundle; do
      for attr in com.apple.FinderInfo 'com.apple.fileprovider.fpfs#P' com.apple.ResourceFork; do
        xattr -d "$attr" "$bundle" 2>/dev/null || true
      done
    done < <(find "$p" -type d \( -name '*.app' -o -name '*.appex' \) -print0 2>/dev/null)
  fi
  for attr in com.apple.FinderInfo 'com.apple.fileprovider.fpfs#P' com.apple.ResourceFork; do
    xattr -d "$attr" "$p" 2>/dev/null || true
  done
}
prepare_node_native_build_environment() {
  [[ "$(uname -s)" == "Darwin" ]] || return 0

  local node_source
  node_source="$(node -p 'process.execPath')"
  local node_bin_dir="$SAFE_ROOT/.node-bin"
  local entitlements="$SAFE_ROOT/node-build.entitlements"
  mkdir -p "$node_bin_dir"
  cat >"$entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
PLIST
  cp "$node_source" "$node_bin_dir/node"
  codesign --force --sign - --entitlements "$entitlements" "$node_bin_dir/node" >/dev/null
  export PATH="$node_bin_dir:$PATH"
}
sign_node_native_modules() {
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  [[ -d node_modules ]] || return 0

  while IFS= read -r -d '' native_module; do
    codesign --force --sign - "$native_module" >/dev/null 2>&1 || true
  done < <(find node_modules -name '*.node' -type f -print0 2>/dev/null)
}
require_asset() { local p="$1"; [[ -s "$p" ]] || { echo "error: missing vendored web asset: $p" >&2; echo "Run: pnpm install --ignore-scripts && pnpm run vendor:molstar && pnpm run vendor:rdkit" >&2; exit 1; }; }
merge_tauri_info_plist() {
  local app="$1"
  local target="$app/Contents/Info.plist"
  local source="$ROOT/App/Info.plist"

  [[ -f "$target" ]] || { echo "error: app Info.plist missing: $target" >&2; exit 1; }
  [[ -f "$source" ]] || { echo "error: source Info.plist missing: $source" >&2; exit 1; }

  plutil -replace CFBundleDocumentTypes -json "$(plutil -extract CFBundleDocumentTypes json -o - "$source")" "$target"
  plutil -replace UTExportedTypeDeclarations -json "$(plutil -extract UTExportedTypeDeclarations json -o - "$source")" "$target"
  plutil -replace UTImportedTypeDeclarations -json "$(plutil -extract UTImportedTypeDeclarations json -o - "$source")" "$target"
  plutil -replace LSUIElement -bool YES "$target"
  plutil -replace NSSupportsAutomaticGraphicsSwitching -bool YES "$target"
}
sign_burrete_app() {
  local app="$1"
  local appex="$app/Contents/PlugIns/BurretePreview.appex"
  local app_entitlements="$ROOT/App/Burrete.entitlements"
  local preview_entitlements="$ROOT/PreviewExtension/BurretePreview.entitlements"

  [[ -d "$appex" ]] || { echo "error: embedded Quick Look extension missing: $appex" >&2; exit 1; }
  [[ -f "$app_entitlements" ]] || { echo "error: app entitlements missing: $app_entitlements" >&2; exit 1; }
  [[ -f "$preview_entitlements" ]] || { echo "error: preview entitlements missing: $preview_entitlements" >&2; exit 1; }

  while IFS= read -r -d '' binary; do
    if file "$binary" | grep -q 'Mach-O'; then
      codesign --force --sign - "$binary" >/dev/null
    fi
  done < <(find "$appex/Contents/MacOS" -type f -perm +111 -print0 2>/dev/null)

  codesign --force --sign - --entitlements "$preview_entitlements" "$appex" >/dev/null
  codesign --force --sign - --entitlements "$app_entitlements" "$app" >/dev/null
}

require_tool node "Install it with: brew install node"
require_tool npm "Install it with: brew install node"
require_tool pnpm "Install it with: npm install -g pnpm"
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
require_asset PreviewExtension/Web/burette-agent.js
require_asset PreviewExtension/Web/viewer.js
require_asset PreviewExtension/Web/grid-viewer.js
require_asset PreviewExtension/Web/grid.css
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.js
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.wasm
require_asset PreviewExtension/Web/xyz-fast.js
node --check PreviewExtension/Web/viewer.js >/dev/null
node --check PreviewExtension/Web/burette-agent.js >/dev/null
node --check PreviewExtension/Web/grid-viewer.js >/dev/null
node --check PreviewExtension/Web/xyz-fast.js >/dev/null
clean_detritus "$ROOT"
rm -f /tmp/Burrete.log "${TMPDIR:-/tmp}/Burrete.log" 2>/dev/null || true

rsync -a --delete --exclude build --exclude node_modules --exclude .git --exclude apps/desktop/src-tauri/target "$ROOT/" "$SAFE_ROOT/"
clean_detritus "$SAFE_ROOT"

pushd "$SAFE_ROOT" >/dev/null
rm -rf build
prepare_node_native_build_environment
pnpm install --frozen-lockfile --ignore-scripts
sign_node_native_modules
pnpm --filter @burrete/desktop run build:tauri
xcodebuild -project Burrete.xcodeproj -scheme Burrete -configuration Debug -derivedDataPath build COMPILER_INDEX_STORE_ENABLE=NO CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
TAURI_BUILT_APP="apps/desktop/src-tauri/target/release/bundle/macos/Burrete.app"
QUICKLOOK_APPEX="build/Build/Products/Debug/Burrete.app/Contents/PlugIns/BurretePreview.appex"
[[ -d "$TAURI_BUILT_APP" ]] || { echo "error: Tauri app bundle missing: $TAURI_BUILT_APP" >&2; exit 1; }
[[ -d "$QUICKLOOK_APPEX" ]] || { echo "error: Quick Look extension missing: $QUICKLOOK_APPEX" >&2; exit 1; }
mkdir -p "$TAURI_BUILT_APP/Contents/PlugIns"
rm -rf "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex"
ditto --norsrc --noextattr "$QUICKLOOK_APPEX" "$TAURI_BUILT_APP/Contents/PlugIns/BurretePreview.appex"
merge_tauri_info_plist "$TAURI_BUILT_APP"
clean_detritus "$TAURI_BUILT_APP"
sign_burrete_app "$TAURI_BUILT_APP"
clean_detritus "$TAURI_BUILT_APP"
popd >/dev/null

rm -rf "$LOCAL_APP"
mkdir -p "$(dirname "$LOCAL_APP")"
ditto --norsrc --noextattr "$SAFE_ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Burrete.app" "$LOCAL_APP"
merge_tauri_info_plist "$LOCAL_APP"
clean_detritus "$LOCAL_APP"
sign_burrete_app "$LOCAL_APP"
clean_detritus "$LOCAL_APP"

actual_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_id" == "$APP_ID" ]] || { echo "error: built app id mismatch: got '${actual_id:-unknown}', expected '$APP_ID'" >&2; exit 1; }
[[ -x "$LOCAL_APP/Contents/MacOS/burrete" ]] || { echo "error: built Tauri app executable missing: $LOCAL_APP/Contents/MacOS/burrete" >&2; exit 1; }
[[ -d "$LOCAL_APP/Contents/PlugIns/BurretePreview.appex" ]] || { echo "error: embedded Quick Look extension missing in Tauri app." >&2; exit 1; }
VERIFY_APP="$SAFE_ROOT/verify/Burrete.app"
rm -rf "$SAFE_ROOT/verify"
mkdir -p "$SAFE_ROOT/verify"
ditto --norsrc --noextattr "$LOCAL_APP" "$VERIFY_APP"
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
