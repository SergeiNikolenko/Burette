#!/usr/bin/env bash
# Builds the Windows x64 installer (NSIS) into build/windows.
# Runs in Git Bash on Windows. Prerequisites: bun, Rust (MSVC toolchain),
# Python 3.12+ and the Visual Studio C++ build tools (see docs/windows.md).
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd -P)"
cd "$ROOT"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) echo "error: build-windows.sh runs in Git Bash on Windows." >&2; exit 2 ;;
esac
for tool in bun cargo node python; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool is required." >&2; exit 1; }
done

# Native tools get mixed-style paths (C:/...), which both they and Git Bash read.
ROOT_NATIVE="$(cygpath -m "$ROOT")"
OUTPUT="$ROOT/build/windows"
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

bun scripts/check-release-version.mjs
node scripts/desktop-metadata.mjs --check
bun install --frozen-lockfile --ignore-scripts
bun run build:agent-shell
# Stages <resource dir>\xyzrender-runtime and <resource dir>\xyzrender-python
# and prints the Tauri config overlay that bundles them.
XYZRENDER_TAURI_CONFIG="$(python scripts/stage-xyzrender-windows.py --out "$ROOT_NATIVE/build/xyzrender-windows")"
rm -rf "$TARGET_DIR/release/bundle"
(cd apps/desktop && bun run build:tauri -- --bundles nsis \
  --config "$ROOT_NATIVE/packaging/windows/file-associations.json" \
  --config "$XYZRENDER_TAURI_CONFIG")

rm -rf "$OUTPUT"
mkdir -p "$OUTPUT"
found=0
for artifact in "$TARGET_DIR/release/bundle/nsis"/*-setup.exe; do
  [[ -f "$artifact" ]] || continue
  cp "$artifact" "$OUTPUT/"
  found=1
done
[[ "$found" == 1 ]] || { echo "error: no NSIS installer in $TARGET_DIR/release/bundle/nsis" >&2; exit 1; }
(cd "$OUTPUT" && sha256sum -- * > SHA256SUMS)

cat <<MSG

BUILD SUCCEEDED: Burette for Windows
$(ls -1 "$OUTPUT" | sed 's/^/  /')
MSG
