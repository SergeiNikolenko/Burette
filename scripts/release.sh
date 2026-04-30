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

SCHEME="Burrete"
PROJECT="Burrete.xcodeproj"
ARCHIVE_PATH="$ROOT/build/release/Burrete.xcarchive"
EXPORT_PATH="$ROOT/build/release/export"
EXPORT_OPTIONS="${EXPORT_OPTIONS:-$ROOT/ExportOptions.plist}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required. $2" >&2; exit 1; }; }
require_asset() { local p="$1"; [[ -s "$p" ]] || { echo "error: missing vendored web asset: $p" >&2; echo "Run: npm ci --ignore-scripts && npm run vendor:molstar" >&2; exit 1; }; }

require_tool xcodebuild "Install full Xcode from the App Store."
require_tool xcrun "Install full Xcode from the App Store."
require_tool ditto "ditto is normally present on macOS."

require_asset PreviewExtension/Web/molstar.js
require_asset PreviewExtension/Web/molstar.css
require_asset PreviewExtension/Web/burette-agent.js
require_asset PreviewExtension/Web/viewer.js
node --check PreviewExtension/Web/viewer.js >/dev/null
node --check PreviewExtension/Web/burette-agent.js >/dev/null

if [[ ! -f "$EXPORT_OPTIONS" ]]; then
  cat >&2 <<MSG
error: missing export options plist: $EXPORT_OPTIONS

Create an ExportOptions.plist for Developer ID distribution, or pass:
  EXPORT_OPTIONS=/path/to/ExportOptions.plist $0
MSG
  exit 1
fi

if [[ -z "$NOTARY_PROFILE" ]]; then
  cat >&2 <<MSG
error: NOTARY_PROFILE is required.

Create it once with:
  xcrun notarytool store-credentials <profile-name>

Then run:
  NOTARY_PROFILE=<profile-name> $0
MSG
  exit 1
fi

rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"
mkdir -p "$(dirname "$ARCHIVE_PATH")" "$EXPORT_PATH"

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  archive

xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

APP="$EXPORT_PATH/Burrete.app"
ZIP="$ROOT/build/release/Burrete.zip"
[[ -d "$APP" ]] || { echo "error: exported app is missing: $APP" >&2; exit 1; }

ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl -a -vv "$APP"

echo "Release app: $APP"
echo "Release zip: $ZIP"
