#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export npm_config_cache="$ROOT/build/npm-cache"

npm ci --ignore-scripts
npm run check:js
npm run check:formats
npm run test:agent
npm run test:ui
npm run test:tauri-structure
plutil -lint apps/desktop/src-tauri/AppMetadata.plist PreviewExtension/Info.plist PreviewExtension/BurretePreview.entitlements
