#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/ci-fast.sh [all|js|rust]
# CI runs the js and rust scopes as parallel jobs; locally the default runs both.
SCOPE="${1:-all}"
case "$SCOPE" in
  all|js|rust) ;;
  *)
    echo "error: unknown ci-fast scope: $SCOPE (expected all, js, or rust)" >&2
    exit 2
    ;;
esac

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

bun install --frozen-lockfile --ignore-scripts

if [[ "$SCOPE" == "all" || "$SCOPE" == "js" ]]; then
  bun run check:js
  # The native bundle build is skipped for version-only native diffs, so the
  # release version gate also runs here.
  bun run check:release
  bun run check:vendor-assets
  bun run check:formats
  bun run typecheck
  bun run test:mesoscale
  bun run test:agent
  bun run test:update
  python3 tests/test-model-assets.py
  bun tests/test-model-runtime-install.mjs
  bun tests/test-svg-artwork-safety.mjs
  bun run test:ui
  bun run test:responsiveness
  bun run test:tauri-structure
  bun run test:compute-metal
  plutil -lint apps/desktop/src-tauri/AppMetadata.plist apps/desktop/src-tauri/Info.plist PreviewExtension/Info.plist PreviewExtension/BurettePreview.entitlements
fi

if [[ "$SCOPE" == "all" || "$SCOPE" == "rust" ]]; then
  # clippy --all-targets type-checks every target, so a separate cargo check is redundant.
  bun run check:rust
  cargo test -j "${CARGO_BUILD_JOBS:-1}" --manifest-path apps/desktop/src-tauri/Cargo.toml --lib -- --test-threads=1
fi
