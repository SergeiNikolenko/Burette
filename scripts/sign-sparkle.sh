#!/usr/bin/env bash
set -euo pipefail
FRAMEWORK="${1:?app bundle}/Contents/Frameworks/Sparkle.framework"
IDENTITY="${2:?signing identity}"
[[ -d "$FRAMEWORK" ]] || exit 0
ARGS=(--force --sign "$IDENTITY" --preserve-metadata=entitlements)
[[ "$IDENTITY" == "-" ]] || ARGS+=(--options runtime --timestamp)
# Sign nested code from the inside out, preserving the versioned framework links.
while IFS= read -r -d '' binary; do
  if file -b "$binary" | grep -q 'Mach-O'; then
    codesign "${ARGS[@]}" "$binary"
  fi
done < <(find "$FRAMEWORK/Versions" -type f -perm -111 -print0)
while IFS= read -r -d '' bundle; do
  codesign "${ARGS[@]}" "$bundle"
done < <(find "$FRAMEWORK/Versions" -depth -type d \( -name '*.xpc' -o -name '*.app' \) -print0)
codesign "${ARGS[@]}" "$FRAMEWORK"
codesign --verify --deep --strict "$FRAMEWORK"
