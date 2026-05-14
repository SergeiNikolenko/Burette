#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

bun install --frozen-lockfile --ignore-scripts
bun run check:js
bun run check:vendor-assets
bun run check:formats
bun run test:agent
bun run test:ui
bun run test:tauri-structure
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
plutil -lint apps/desktop/src-tauri/AppMetadata.plist PreviewExtension/Info.plist PreviewExtension/BurretePreview.entitlements
