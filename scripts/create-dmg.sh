#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd -P)"
BACKGROUND="$ROOT/packaging/dmg/background.png"
VOLUME_NAME="Burrete"

require_tool() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: $1 is required to create the DMG." >&2
    exit 1
  }
}

[[ -s "$BACKGROUND" ]] || {
  echo "error: missing DMG background: $BACKGROUND" >&2
  exit 1
}

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "DMG packaging dry run passed."
  exit 0
fi

if [[ $# -ne 2 ]]; then
  echo "Usage: scripts/create-dmg.sh <Burrete.app> <output.dmg>" >&2
  exit 2
fi

APP="$1"
OUTPUT="$2"
[[ -d "$APP" ]] || {
  echo "error: app bundle is missing: $APP" >&2
  exit 1
}

require_tool hdiutil
require_tool osascript
require_tool ditto

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/burrete-dmg.XXXXXX")"
STAGING_DIR="$WORK_DIR/staging"
MOUNT_DIR=""
RW_IMAGE="$WORK_DIR/Burrete-rw.dmg"
DEVICE=""

cleanup() {
  if [[ -n "$DEVICE" ]]; then
    hdiutil detach "$DEVICE" -quiet >/dev/null 2>&1 || true
  elif [[ -n "$MOUNT_DIR" ]] && mount | grep -Fq " on $MOUNT_DIR "; then
    hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$STAGING_DIR/.background" "$(dirname "$OUTPUT")"
ditto "$APP" "$STAGING_DIR/Burrete.app"
ln -s /Applications "$STAGING_DIR/Applications"
cp "$BACKGROUND" "$STAGING_DIR/.background/background.png"

hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$STAGING_DIR" \
  -fs HFS+ \
  -format UDRW \
  -ov \
  "$RW_IMAGE" >/dev/null

[[ ! -e "/Volumes/$VOLUME_NAME" ]] || {
  echo "error: /Volumes/$VOLUME_NAME is already mounted." >&2
  exit 1
}
ATTACH_OUTPUT="$(hdiutil attach -readwrite -noverify -noautoopen "$RW_IMAGE")"
DEVICE="$(awk 'NF >= 3 { device = $1 } END { print device }' <<<"$ATTACH_OUTPUT")"
MOUNT_DIR="$(awk 'NF >= 3 { mount = $NF } END { print mount }' <<<"$ATTACH_OUTPUT")"
[[ -n "$DEVICE" ]] || {
  echo "error: could not determine the mounted DMG device." >&2
  exit 1
}

osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$VOLUME_NAME"
    open
    delay 1
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set pathbar visible of container window to false
    set bounds of container window to {100, 100, 760, 500}
    set viewOptions to icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 104
    set text size of viewOptions to 13
    set background picture of viewOptions to file ".background:background.png"
    set position of item "Burrete.app" of container window to {145, 205}
    set position of item "Applications" of container window to {515, 205}
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT

sync
hdiutil detach "$DEVICE" -quiet
DEVICE=""
rm -f "$OUTPUT"
hdiutil convert "$RW_IMAGE" -format UDZO -imagekey zlib-level=9 -o "$OUTPUT" >/dev/null

echo "Created DMG: $OUTPUT"
