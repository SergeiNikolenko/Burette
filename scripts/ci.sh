#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
export PNPM_HOME="${PNPM_HOME:-$HOME/Library/pnpm}"
export PATH="$PNPM_HOME:$PATH"
export PNPM_STORE_DIR="$ROOT/build/pnpm-store"

pnpm install --frozen-lockfile --ignore-scripts
pnpm run check:release
pnpm run check:js
pnpm run test:agent
plutil -lint App/Info.plist PreviewExtension/Info.plist App/Burrete.entitlements PreviewExtension/BurretePreview.entitlements
./scripts/build.sh samples/mini.sdf
