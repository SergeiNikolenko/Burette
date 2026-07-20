#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

bun install --frozen-lockfile --ignore-scripts
bun run check:js
bun run check:vendor-assets
bun run check:formats
bun run check:rust
bun run test:agent
bun run test:update
bun run test:ui
bun run test:tauri-structure
cargo check -j "${CARGO_BUILD_JOBS:-1}" --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test -j "${CARGO_BUILD_JOBS:-1}" --manifest-path apps/desktop/src-tauri/Cargo.toml --lib -- --test-threads=1
plutil -lint apps/desktop/src-tauri/AppMetadata.plist apps/desktop/src-tauri/Info.plist PreviewExtension/Info.plist PreviewExtension/BurretePreview.entitlements
