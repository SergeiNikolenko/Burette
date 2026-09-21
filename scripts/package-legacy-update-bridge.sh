#!/bin/bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: scripts/package-legacy-update-bridge.sh /path/to/Burette.app /path/to/output" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_APP="$1"
OUTPUT_DIR="$2"
PLIST_BUDDY="/usr/libexec/PlistBuddy"
OLD_APP_ID="com.local.BurreteV10"
OLD_PREVIEW_ID="com.local.BurreteV10.Preview"
OLD_THUMBNAIL_ID="com.local.BurreteV10.Thumbnail"

[[ -d "$SOURCE_APP" ]] || { echo "error: source app is missing: $SOURCE_APP" >&2; exit 1; }
[[ -x "$PLIST_BUDDY" ]] || { echo "error: PlistBuddy is unavailable." >&2; exit 1; }
command -v codesign >/dev/null || { echo "error: codesign is unavailable." >&2; exit 1; }
command -v ditto >/dev/null || { echo "error: ditto is unavailable." >&2; exit 1; }

version="$("$PLIST_BUDDY" -c "Print :CFBundleShortVersionString" "$SOURCE_APP/Contents/Info.plist")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
  echo "error: source app version is not a release version: $version" >&2
  exit 1
}

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/burette-legacy-bridge.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
bridge_app="$work_dir/Burrete.app"
ditto --norsrc --noextattr "$SOURCE_APP" "$bridge_app"

main_plist="$bridge_app/Contents/Info.plist"
"$PLIST_BUDDY" -c "Set :CFBundleIdentifier $OLD_APP_ID" "$main_plist"
"$PLIST_BUDDY" -c "Set :CFBundleExecutable burrete" "$main_plist"
mv "$bridge_app/Contents/MacOS/burette" "$bridge_app/Contents/MacOS/burrete"

preview="$bridge_app/Contents/PlugIns/BurettePreview.appex"
legacy_preview="$bridge_app/Contents/PlugIns/BurretePreview.appex"
thumbnail="$bridge_app/Contents/PlugIns/BuretteThumbnail.appex"
legacy_thumbnail="$bridge_app/Contents/PlugIns/BurreteThumbnail.appex"
[[ -d "$preview" ]] || { echo "error: BurettePreview.appex is missing." >&2; exit 1; }
[[ -d "$thumbnail" ]] || { echo "error: BuretteThumbnail.appex is missing." >&2; exit 1; }
mv "$preview" "$legacy_preview"
mv "$thumbnail" "$legacy_thumbnail"
"$PLIST_BUDDY" -c "Set :CFBundleIdentifier $OLD_PREVIEW_ID" "$legacy_preview/Contents/Info.plist"
"$PLIST_BUDDY" -c "Set :CFBundleIdentifier $OLD_THUMBNAIL_ID" "$legacy_thumbnail/Contents/Info.plist"

codesign --force --sign - \
  --entitlements "$ROOT/PreviewExtension/BurettePreview.entitlements" \
  "$legacy_preview" >/dev/null
codesign --force --sign - \
  --entitlements "$ROOT/PreviewExtension/BurettePreview.entitlements" \
  "$legacy_thumbnail" >/dev/null
codesign --force --sign - "$bridge_app" >/dev/null
codesign --verify --deep --strict "$bridge_app"

[[ "$("$PLIST_BUDDY" -c "Print :CFBundleIdentifier" "$main_plist")" == "$OLD_APP_ID" ]]
[[ "$("$PLIST_BUDDY" -c "Print :CFBundleIdentifier" "$legacy_preview/Contents/Info.plist")" == "$OLD_PREVIEW_ID" ]]
[[ "$("$PLIST_BUDDY" -c "Print :CFBundleIdentifier" "$legacy_thumbnail/Contents/Info.plist")" == "$OLD_THUMBNAIL_ID" ]]
[[ -x "$bridge_app/Contents/MacOS/burrete" ]]
app_signature="$(codesign -dv --verbose=4 "$bridge_app" 2>&1)"
preview_signature="$(codesign -dv --verbose=4 "$legacy_preview" 2>&1)"
[[ "$app_signature" == *"Identifier=$OLD_APP_ID"* ]]
[[ "$preview_signature" == *"Identifier=$OLD_PREVIEW_ID"* ]]

mkdir -p "$OUTPUT_DIR"
archive_name="Burrete-${version}.zip"
(
  cd "$OUTPUT_DIR"
  rm -f "$archive_name" "$archive_name.sha256"
  ditto -c -k --keepParent "$bridge_app" "$archive_name"
  shasum -a 256 "$archive_name" > "$archive_name.sha256"
)

echo "Created legacy updater bridge: $OUTPUT_DIR/$archive_name"
