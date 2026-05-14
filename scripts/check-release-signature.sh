#!/usr/bin/env bash
set -euo pipefail

APP="${1:-build/Burrete.app}"
EXTENSION_ID="com.local.BurreteV10.Preview"
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

codesign --verify --deep --strict "$APP"
codesign --verify --deep --strict "$APPEX"

signature="$(codesign -dv --verbose=4 "$APP" 2>&1)"
if [[ "$ALLOW_ADHOC" == "1" ]]; then
  actual_extension_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APPEX/Contents/Info.plist")"
  if [[ "$actual_extension_id" != "$EXTENSION_ID" ]]; then
    echo "error: Quick Look extension id mismatch: $actual_extension_id" >&2
    exit 1
  fi
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

actual_extension_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APPEX/Contents/Info.plist")"
if [[ "$actual_extension_id" != "$EXTENSION_ID" ]]; then
  echo "error: Quick Look extension id mismatch: $actual_extension_id" >&2
  exit 1
fi

spctl --assess --type execute "$APP"
xcrun stapler validate "$APP"

echo "Release signature, Gatekeeper, notarization, and extension checks passed."
