#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export npm_config_cache="$ROOT/build/npm-cache"

npm ci --ignore-scripts
npm run check:release
npm run check:js
npm run test:agent
plutil -lint App/Info.plist PreviewExtension/Info.plist App/Burrete.entitlements PreviewExtension/BurretePreview.entitlements
./scripts/build.sh samples/mini.sdf
