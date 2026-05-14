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

require_tool() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required. $2" >&2; exit 1; }; }
require_asset() { local p="$1"; [[ -s "$p" ]] || { echo "error: missing vendored web asset: $p" >&2; echo "Run: bun install --frozen-lockfile --ignore-scripts && bun run vendor:molstar && bun run vendor:rdkit" >&2; exit 1; }; }

require_tool ditto "ditto is normally present on macOS."
require_tool shasum "shasum is normally present on macOS."

require_asset PreviewExtension/Web/molstar.js
require_asset PreviewExtension/Web/molstar.css
require_asset PreviewExtension/Web/viewer-runtime.css
require_asset PreviewExtension/Web/viewer-shell.js
require_asset PreviewExtension/Web/burette-agent.js
require_asset PreviewExtension/Web/viewer.js
require_asset PreviewExtension/Web/xyz-fast.js
require_asset PreviewExtension/Web/grid-viewer.js
require_asset PreviewExtension/Web/grid.css
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.js
require_asset PreviewExtension/Web/rdkit/RDKit_minimal.wasm
bun scripts/check-js-syntax.mjs \
  PreviewExtension/Web/viewer.js \
  PreviewExtension/Web/viewer-shell.js \
  PreviewExtension/Web/burette-agent.js \
  PreviewExtension/Web/grid-viewer.js \
  PreviewExtension/Web/xyz-fast.js >/dev/null

"$ROOT/scripts/build.sh"
mkdir -p "$(dirname "$ZIP")"
[[ -d "$APP" ]] || { echo "error: exported app is missing: $APP" >&2; exit 1; }
"$ROOT/scripts/check-release-signature.sh" "$APP"

rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --keepParent "$APP" "$ZIP"
(
  cd "$(dirname "$ZIP")"
  shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256"
)
bun "$ROOT/scripts/sign-update-manifest.mjs" "$ZIP" "$(dirname "$ZIP")"

echo "Release app: $APP"
echo "Release zip: $ZIP"
echo "Release digest: $ZIP.sha256"
echo "Release manifest: $ZIP.manifest.json"
echo "Release manifest signature: $ZIP.manifest.json.sig"
