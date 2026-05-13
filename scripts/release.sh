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
require_asset() { local p="$1"; [[ -s "$p" ]] || { echo "error: missing vendored web asset: $p" >&2; echo "Run: npm ci --ignore-scripts && npm run vendor:molstar && npm run vendor:rdkit" >&2; exit 1; }; }

require_tool ditto "ditto is normally present on macOS."

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
node --check PreviewExtension/Web/viewer.js >/dev/null
node --check PreviewExtension/Web/viewer-shell.js >/dev/null
node --check PreviewExtension/Web/burette-agent.js >/dev/null
node --check PreviewExtension/Web/grid-viewer.js >/dev/null
node --check PreviewExtension/Web/xyz-fast.js >/dev/null

"$ROOT/scripts/build.sh"
mkdir -p "$(dirname "$ZIP")"
[[ -d "$APP" ]] || { echo "error: exported app is missing: $APP" >&2; exit 1; }

rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "Release app: $APP"
echo "Release zip: $ZIP"
