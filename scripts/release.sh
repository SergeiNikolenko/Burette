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

APP="$ROOT/build/Burrete.app"
ZIP="$ROOT/build/release/Burrete.zip"
DMG="$ROOT/build/release/Burrete.dmg"
NOTARIZATION_ZIP="$ROOT/build/release/Burrete-notarization.zip"
DRY_RUN=0
ALLOW_ADHOC="${BURRETE_RELEASE_ALLOW_ADHOC:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      echo "Usage: scripts/release.sh [--dry-run]"
      exit 0
      ;;
    *) echo "error: unknown release.sh argument: $1" >&2; exit 2 ;;
  esac
done

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required. $2" >&2; exit 1; }; }
require_asset() { local p="$1"; [[ -s "$p" ]] || { echo "error: missing vendored web asset: $p" >&2; echo "Run: bun install --frozen-lockfile --ignore-scripts && bun run vendor:molstar && bun run vendor:rdkit" >&2; exit 1; }; }
require_release_env() {
  if [[ "$ALLOW_ADHOC" == "1" ]]; then
    return 0
  fi
  local missing=0
  [[ "${BURRETE_CODESIGN_IDENTITY:-}" == Developer\ ID\ Application:* ]] || { echo "error: BURRETE_CODESIGN_IDENTITY must be a Developer ID Application identity." >&2; missing=1; }
  [[ -n "${BURRETE_DEVELOPMENT_TEAM:-}" ]] || { echo "error: BURRETE_DEVELOPMENT_TEAM is required." >&2; missing=1; }
  if [[ -z "${BURRETE_NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
    [[ -n "${APPLE_ID:-}" ]] || { echo "error: APPLE_ID is required unless BURRETE_NOTARY_KEYCHAIN_PROFILE is set." >&2; missing=1; }
    [[ -n "${APPLE_TEAM_ID:-}" ]] || { echo "error: APPLE_TEAM_ID is required unless BURRETE_NOTARY_KEYCHAIN_PROFILE is set." >&2; missing=1; }
    [[ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]] || { echo "error: APPLE_APP_SPECIFIC_PASSWORD is required unless BURRETE_NOTARY_KEYCHAIN_PROFILE is set." >&2; missing=1; }
  fi
  [[ "$missing" == "0" ]] || exit 1
}
notarize_and_staple() {
  rm -f "$NOTARIZATION_ZIP"
  ditto -c -k --keepParent "$APP" "$NOTARIZATION_ZIP"
  if [[ -n "${BURRETE_NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
    xcrun notarytool submit "$NOTARIZATION_ZIP" \
      --keychain-profile "$BURRETE_NOTARY_KEYCHAIN_PROFILE" \
      --wait
  else
    xcrun notarytool submit "$NOTARIZATION_ZIP" \
      --apple-id "$APPLE_ID" \
      --team-id "$APPLE_TEAM_ID" \
      --password "$APPLE_APP_SPECIFIC_PASSWORD" \
      --wait
  fi
  xcrun stapler staple "$APP"
}
write_digest() {
  local artifact="$1"
  (
    cd "$(dirname "$artifact")"
    shasum -a 256 "$(basename "$artifact")" > "$(basename "$artifact").sha256"
  )
}

require_tool bun "Install it with: brew install oven-sh/bun/bun"

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

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Release dry run passed."
  echo "No build, notarization, stapling, packaging, or publishing was performed."
  echo "Developer ID release requires:"
  echo "  BURRETE_CODESIGN_IDENTITY='Developer ID Application: ...'"
  echo "  BURRETE_DEVELOPMENT_TEAM=<Apple team id>"
  echo "  BURRETE_NOTARY_KEYCHAIN_PROFILE or APPLE_ID + APPLE_TEAM_ID + APPLE_APP_SPECIFIC_PASSWORD"
  echo "Ad-hoc release without notarization can be built with:"
  echo "  BURRETE_RELEASE_ALLOW_ADHOC=1"
  exit 0
fi

require_tool ditto "ditto is normally present on macOS."
require_tool hdiutil "hdiutil is normally present on macOS."
require_tool shasum "shasum is normally present on macOS."
require_tool xcrun "Install full Xcode from the App Store."
require_release_env
export BURRETE_BUILD_MODE=release
export BURRETE_XCODE_CONFIGURATION="${BURRETE_XCODE_CONFIGURATION:-Release}"
"$ROOT/scripts/build.sh"
mkdir -p "$(dirname "$ZIP")"
[[ -d "$APP" ]] || { echo "error: exported app is missing: $APP" >&2; exit 1; }
if [[ "$ALLOW_ADHOC" == "1" ]]; then
  BURRETE_RELEASE_ALLOW_ADHOC=1 "$ROOT/scripts/check-release-signature.sh" "$APP"
else
  notarize_and_staple
  "$ROOT/scripts/check-release-signature.sh" "$APP"
fi

rm -f "$ZIP" "$ZIP.sha256" "$DMG" "$DMG.sha256"
ditto -c -k --keepParent "$APP" "$ZIP"
hdiutil create -volname Burrete -srcfolder "$APP" -ov -format UDZO "$DMG" >/dev/null
write_digest "$ZIP"
write_digest "$DMG"
if [[ -n "${BURRETE_UPDATE_MANIFEST_PRIVATE_KEY_PEM:-}" ]]; then
  bun "$ROOT/scripts/sign-update-manifest.mjs" "$ZIP" "$(dirname "$ZIP")"
fi

echo "Release app: $APP"
echo "Release zip: $ZIP"
echo "Release digest: $ZIP.sha256"
echo "Release dmg: $DMG"
echo "Release dmg digest: $DMG.sha256"
if [[ -n "${BURRETE_UPDATE_MANIFEST_PRIVATE_KEY_PEM:-}" ]]; then
  echo "Release manifest: $ZIP.manifest.json"
  echo "Release manifest signature: $ZIP.manifest.json.sig"
else
  echo "Release manifest: skipped (no BURRETE_UPDATE_MANIFEST_PRIVATE_KEY_PEM)"
fi
