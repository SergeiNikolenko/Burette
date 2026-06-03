#!/usr/bin/env bash
set -euo pipefail

APP="${1:-build/Burrete.app}"
EXTENSION_ID="com.local.BurreteV10.Preview"
THUMBNAIL_EXTENSION_ID="com.local.BurreteV10.Thumbnail"
ALLOW_ADHOC="${BURRETE_RELEASE_ALLOW_ADHOC:-0}"

if [[ ! -d "$APP" ]]; then
  echo "error: release app is missing: $APP" >&2
  exit 1
fi

APPEX="$APP/Contents/PlugIns/BurretePreview.appex"
if [[ ! -d "$APPEX" ]]; then
  echo "error: release app is missing BurretePreview.appex" >&2
  exit 1
fi
THUMBNAIL_APPEX="$APP/Contents/PlugIns/BurreteThumbnail.appex"
if [[ ! -d "$THUMBNAIL_APPEX" ]]; then
  echo "error: release app is missing BurreteThumbnail.appex" >&2
  exit 1
fi
require_hardened_runtime() {
  local signature="$1"
  local label="$2"
  if ! grep -Eq 'Runtime Version=|flags=.*runtime' <<<"$signature"; then
    echo "error: $label is not signed with hardened runtime." >&2
    exit 1
  fi
}
assert_extension_id() {
  local appex="$1"
  local expected="$2"
  local label="$3"
  local actual
  actual="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$appex/Contents/Info.plist")"
  if [[ "$actual" != "$expected" ]]; then
    echo "error: $label extension id mismatch: $actual" >&2
    exit 1
  fi
}

codesign --verify --deep --strict "$APP"
codesign --verify --deep --strict "$APPEX"
codesign --verify --deep --strict "$THUMBNAIL_APPEX"

signature="$(codesign -dv --verbose=4 "$APP" 2>&1)"
if [[ "$ALLOW_ADHOC" == "1" ]]; then
  assert_extension_id "$APPEX" "$EXTENSION_ID" "Quick Look preview"
  assert_extension_id "$THUMBNAIL_APPEX" "$THUMBNAIL_EXTENSION_ID" "Quick Look thumbnail"
  echo "Release codesign and extension checks passed in ad-hoc mode."
  exit 0
fi

if ! grep -q '^Authority=Developer ID Application:' <<<"$signature"; then
  echo "error: release app is not signed with Developer ID Application." >&2
  exit 1
fi
if ! grep -Eq '^TeamIdentifier=[A-Z0-9]+' <<<"$signature"; then
  echo "error: release app does not have a TeamIdentifier." >&2
  exit 1
fi
if grep -q '^Signature=adhoc' <<<"$signature"; then
  echo "error: release app is ad-hoc signed." >&2
  exit 1
fi
require_hardened_runtime "$signature" "release app"

assert_extension_id "$APPEX" "$EXTENSION_ID" "Quick Look preview"
assert_extension_id "$THUMBNAIL_APPEX" "$THUMBNAIL_EXTENSION_ID" "Quick Look thumbnail"

spctl --assess --type execute "$APP"
xcrun stapler validate "$APP"

echo "Release signature, Gatekeeper, notarization, and extension checks passed."
