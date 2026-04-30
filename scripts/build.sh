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
LOCAL_APP="$ROOT/build/Build/Products/Debug/Burrete.app"

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
clean_detritus() { local p="$1"; [[ -e "$p" ]] || return 0; xattr -cr "$p" 2>/dev/null || true; find "$p" -exec xattr -d com.apple.FinderInfo {} + 2>/dev/null || true; find "$p" -exec xattr -d 'com.apple.fileprovider.fpfs#P' {} + 2>/dev/null || true; find "$p" -exec xattr -d com.apple.ResourceFork {} + 2>/dev/null || true; dot_clean -m "$p" 2>/dev/null || true; find "$p" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true; }
require_asset() { local p="$1"; [[ -s "$p" ]] || { echo "error: missing vendored web asset: $p" >&2; echo "Run: npm ci --ignore-scripts && npm run vendor:molstar && npm run vendor:rdkit" >&2; exit 1; }; }

require_tool node "Install it with: brew install node"
require_tool xcodebuild "Install full Xcode from the App Store."
require_tool rsync "rsync is normally present on macOS."

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
rm -f /tmp/Burrete.log "${TMPDIR:-/tmp}/Burrete.log" 2>/dev/null || true

rsync -a --delete --exclude build --exclude node_modules --exclude .git "$ROOT/" "$SAFE_ROOT/"
clean_detritus "$SAFE_ROOT"

pushd "$SAFE_ROOT" >/dev/null
rm -rf build
xcodebuild -project Burrete.xcodeproj -scheme Burrete -configuration Debug -derivedDataPath build COMPILER_INDEX_STORE_ENABLE=NO CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
clean_detritus "build/Build/Products/Debug/Burrete.app"
popd >/dev/null

rm -rf "$LOCAL_APP"
mkdir -p "$(dirname "$LOCAL_APP")"
COPYFILE_DISABLE=1 COPY_EXTENDED_ATTRIBUTES_DISABLE=1 cp -R "$SAFE_ROOT/build/Build/Products/Debug/Burrete.app" "$LOCAL_APP"
clean_detritus "$LOCAL_APP"

actual_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_id" == "$APP_ID" ]] || { echo "error: built app id mismatch: got '${actual_id:-unknown}', expected '$APP_ID'" >&2; exit 1; }
[[ -x "$LOCAL_APP/Contents/MacOS/Burrete" ]] || { echo "error: built app executable missing: $LOCAL_APP/Contents/MacOS/Burrete" >&2; exit 1; }

cat <<MSG

BUILD SUCCEEDED: Burrete v10
Built:
  $LOCAL_APP

Next step:
  ./scripts/install.sh

Quick smoke test after install:
  ./scripts/force-preview.sh samples/mini.pdb
MSG
