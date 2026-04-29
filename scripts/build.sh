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
export npm_config_cache="$ROOT/build/npm-cache"

APP_ID="com.local.MolstarQuickLookV10"
PREVIEW_ID="com.local.MolstarQuickLookV10.Preview"
QL_PLIST="PreviewExtension/Info.plist"
QL_TYPES_PATH=":NSExtension:NSExtensionAttributes:QLSupportedContentTypes"
SAFE_ROOT_BASE="${TMPDIR:-/tmp}"
SAFE_ROOT="$(mktemp -d "${SAFE_ROOT_BASE%/}/MolstarQuickLookV10BuildSafe.XXXXXX")"
LOCAL_APP="$ROOT/build/Build/Products/Debug/MolstarQuickLook.app"

cleanup_safe_root() {
  rm -rf "$SAFE_ROOT" 2>/dev/null || true
}
trap cleanup_safe_root EXIT

cat <<HDR
MolstarQuickLook v10 build
  source: $ROOT
  app id: $APP_ID
  preview id: $PREVIEW_ID
HDR

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required. $2" >&2; exit 1; }; }
clean_detritus() { local p="$1"; [[ -e "$p" ]] || return 0; xattr -cr "$p" 2>/dev/null || true; dot_clean -m "$p" 2>/dev/null || true; find "$p" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true; }
plist_has_ql_type() { /usr/libexec/PlistBuddy -c "Print ${QL_TYPES_PATH}" "$1" 2>/dev/null | grep -Fxq "    ${2}"; }
plist_add_ql_type() { local plist="$1" uti="$2"; [[ -n "$uti" ]] || return 0; plist_has_ql_type "$plist" "$uti" && return 0; /usr/libexec/PlistBuddy -c "Add ${QL_TYPES_PATH}: string ${uti}" "$plist" >/dev/null; echo "Added current macOS UTI to Quick Look extension: ${uti}"; }
is_generic_uti() { case "$1" in public.item|public.content|public.data|public.text|public.plain-text|public.filename-extension|public.source-code) return 0;; *) return 1;; esac; }
is_valid_uti() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*(\.[A-Za-z0-9][A-Za-z0-9._-]*)+$ ]]; }
detect_and_add_current_uti() { local plist="$1" file="$2"; [[ -f "$file" ]] || return 0; command -v mdls >/dev/null 2>&1 || return 0; [[ -x /usr/libexec/PlistBuddy ]] || return 0; local uti; uti="$(mdls -raw -name kMDItemContentType "$file" 2>/dev/null | head -n 1 | tr -d '"' || true)"; [[ -z "$uti" || "$uti" == "(null)" ]] && return 0; if ! is_valid_uti "$uti"; then echo "Ignoring invalid UTI reported for $file: $uti"; return 0; fi; if is_generic_uti "$uti" && [[ "${MOLSTARQL_ALLOW_GENERIC_UTI:-0}" != "1" ]]; then echo "Detected generic UTI for $file: $uti — not adding it automatically."; return 0; fi; plist_add_ql_type "$plist" "$uti"; }

require_tool node "Install it with: brew install node"
require_tool npm "Install Node.js/npm first."
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
  echo "Delete it and unzip v10 to ~/Desktop/MolstarQuickLookV10" >&2
  exit 1;;
esac

# Prevent accidentally running old v5/v6/v7/v8 folders.
grep -q '"version": "0.10.1"' package.json || { echo "error: this is not v10; package.json version is:" >&2; grep '"version"' package.json >&2 || true; exit 1; }
grep -q 'com.local.MolstarQuickLookV10.Preview' MolstarQuickLook.xcodeproj/project.pbxproj || { echo "error: this Xcode project is not v10." >&2; exit 1; }
grep -q 'com.local.molstarquicklook10.pdb' scripts/force-preview.sh || { echo "error: force-preview.sh is not v10." >&2; exit 1; }

mkdir -p "$npm_config_cache"
[[ -d node_modules/molstar ]] || npm install
npm run vendor:molstar
node --check PreviewExtension/Web/viewer.js >/dev/null
clean_detritus "$ROOT"
rm -f /tmp/MolstarQuickLook.log "${TMPDIR:-/tmp}/MolstarQuickLook.log" 2>/dev/null || true

detect_and_add_current_uti "$QL_PLIST" "$ROOT/samples/mini.pdb"
detect_and_add_current_uti "$QL_PLIST" "$ROOT/samples/mini.cif"
detect_and_add_current_uti "$QL_PLIST" "$ROOT/samples/mini.sdf"
for file in "$@"; do detect_and_add_current_uti "$QL_PLIST" "$file"; done

rsync -a --delete --exclude build --exclude node_modules --exclude .git "$ROOT/" "$SAFE_ROOT/"
clean_detritus "$SAFE_ROOT"

pushd "$SAFE_ROOT" >/dev/null
rm -rf build
xcodebuild -project MolstarQuickLook.xcodeproj -scheme MolstarQuickLook -configuration Debug -derivedDataPath build COMPILER_INDEX_STORE_ENABLE=NO CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
clean_detritus "build/Build/Products/Debug/MolstarQuickLook.app"
popd >/dev/null

rm -rf "$LOCAL_APP"
mkdir -p "$(dirname "$LOCAL_APP")"
COPYFILE_DISABLE=1 COPY_EXTENDED_ATTRIBUTES_DISABLE=1 cp -R "$SAFE_ROOT/build/Build/Products/Debug/MolstarQuickLook.app" "$LOCAL_APP"
clean_detritus "$LOCAL_APP"

actual_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$LOCAL_APP/Contents/Info.plist" 2>/dev/null || true)"
[[ "$actual_id" == "$APP_ID" ]] || { echo "error: built app id mismatch: got '${actual_id:-unknown}', expected '$APP_ID'" >&2; exit 1; }
[[ -x "$LOCAL_APP/Contents/MacOS/MolstarQuickLook" ]] || { echo "error: built app executable missing: $LOCAL_APP/Contents/MacOS/MolstarQuickLook" >&2; exit 1; }

cat <<MSG

BUILD SUCCEEDED: MolstarQuickLook v10
Built:
  $LOCAL_APP

Next step:
  ./scripts/install.sh

Quick smoke test after install:
  ./scripts/force-preview.sh samples/mini.pdb
MSG
