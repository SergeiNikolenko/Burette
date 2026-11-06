#!/usr/bin/env bash
# Builds the Linux desktop bundles (deb, rpm, AppImage) into build/linux.
# Prerequisites: bun, Rust, and the Tauri Linux libraries (see
# docs/installing-building.md). BURETTE_LINUX_BUNDLES narrows the bundle list.
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd -P)"
cd "$ROOT"

[[ "$(uname -s)" == "Linux" ]] || { echo "error: build-linux.sh runs on Linux; use scripts/build.sh on macOS." >&2; exit 2; }
for tool in bun cargo node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool is required." >&2; exit 1; }
done
pkg-config --exists webkit2gtk-4.1 || { echo "error: webkit2gtk-4.1 development files are missing (libwebkit2gtk-4.1-dev)." >&2; exit 1; }

BUNDLES="${BURETTE_LINUX_BUNDLES:-deb,rpm,appimage}"
OUTPUT="$ROOT/build/linux"
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

# --- Bundled xyzrender runtime ------------------------------------------------
# Linux counterpart of bundle_xyzrender_runtime in scripts/build.sh. The locked
# environment from prepare-xyzrender-runtime.py (or BURETTE_XYZRENDER_ENV) is
# staged as two resources, <resource dir>/xyzrender-runtime (site-packages and
# the bin/xyzrender wrapper) and <resource dir>/xyzrender-python (relocatable
# CPython), then passed to Tauri through a generated config overlay.
XYZRENDER_STAGE="$ROOT/build/xyzrender-linux"
XYZRENDER_TAURI_CONFIG="$XYZRENDER_STAGE/tauri.xyzrender.conf.json"
OWNED_XYZRENDER_SOURCE=""
cleanup_xyzrender_source() {
  [[ -z "$OWNED_XYZRENDER_SOURCE" ]] || rm -rf "$OWNED_XYZRENDER_SOURCE"
}
trap cleanup_xyzrender_source EXIT
stage_xyzrender_runtime() {
  local source_env="${BURETTE_XYZRENDER_ENV:-}"
  if [[ -z "$source_env" ]]; then
    source_env="$(python3 "$ROOT/scripts/prepare-xyzrender-runtime.py")"
    OWNED_XYZRENDER_SOURCE="$(dirname "$source_env")"
  fi
  PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 "$source_env/bin/python3" - "$ROOT/config/xyzrender/source.json" <<'PY' || {
import json, sys
from importlib.metadata import version
from pathlib import Path
from rdkit import Chem
assert version("xyzrender") == json.loads(Path(sys.argv[1]).read_text())["version"]
assert Chem.MolFromSmiles("CCO") is not None
PY
    echo "error: $source_env does not match the reviewed xyzrender snapshot or has no RDKit; use scripts/prepare-xyzrender-runtime.py." >&2
    exit 1
  }
  local python_home
  python_home="$(sed -n 's/^home = //p' "$source_env/pyvenv.cfg" | head -n 1)"
  [[ -n "$python_home" && -x "$python_home/python3" ]] || {
    echo "error: could not resolve the relocatable xyzrender Python from $source_env/pyvenv.cfg" >&2
    exit 1
  }
  local runtime="$XYZRENDER_STAGE/xyzrender-runtime"
  local python_root="$XYZRENDER_STAGE/xyzrender-python"
  rm -rf "$XYZRENDER_STAGE"
  mkdir -p "$runtime" "$python_root"
  # Dereference symlinks so every package format receives regular files, and
  # skip what dereferencing would duplicate or what nothing runs: the venv's
  # lib64 -> lib alias, its interpreter links and console scripts (they point
  # into the temporary source), uv markers, the pruned notebook kernel's share/,
  # and the interpreter's aliases, headers and libpython (the standalone
  # python3 is statically linked; nothing on Linux embeds Python). Tcl/Tk and
  # tkinter go too: xyzrender renders headless, and the AppImage bundler fails
  # on _tkinter because it cannot resolve the bundled libtcl.
  rsync -aL --delete --exclude /lib64 --exclude '/bin/*' --exclude /share \
    --exclude /.lock --exclude /.gitignore --exclude /CACHEDIR.TAG \
    "$source_env/" "$runtime/"
  rsync -aL --delete --include /bin/python3 --exclude '/bin/*' --exclude /include \
    --exclude /share --exclude /lib/pkgconfig --exclude '/lib/libpython*' \
    --exclude '/lib/lib*tcl*' --exclude '/lib/tcl*' --exclude '/lib/tk*' \
    --exclude '/lib/itcl*' --exclude '/lib/thread*' --exclude 'lib-dynload/_tkinter*' \
    --exclude '/lib/python3*/tkinter' --exclude '/lib/python3*/turtledemo' \
    --exclude '/lib/python3*/turtle.py' \
    "$(cd -P "$python_home/.." && pwd -P)/" "$python_root/"
  if [[ "${BURETTE_KEEP_FULL_XYZRENDER_RUNTIME:-0}" != "1" ]]; then
    PYTHONDONTWRITEBYTECODE=1 "$source_env/bin/python3" \
      "$ROOT/scripts/prune-xyzrender-runtime.py" "$runtime" "$python_root"
  fi
  find "$runtime" "$python_root" -type d -name __pycache__ -prune -exec rm -rf {} +
  find "$runtime" "$python_root" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
  mkdir -p "$runtime/bin"
  cat >"$runtime/bin/xyzrender" <<'EOF'
#!/bin/sh
set -eu

SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RUNTIME_ROOT="$(CDPATH= cd -- "$SELF_DIR/.." && pwd)"
PYTHON_ROOT="$(CDPATH= cd -- "$RUNTIME_ROOT/../xyzrender-python" && pwd)"
SITE_PACKAGES="$(find "$RUNTIME_ROOT/lib" -maxdepth 2 -type d -name site-packages | head -n 1)"

if [ ! -f "$PYTHON_ROOT/bin/python3" ]; then
  echo "missing bundled python runtime: $PYTHON_ROOT/bin/python3" >&2
  exit 1
fi
if [ -z "$SITE_PACKAGES" ] || [ ! -d "$SITE_PACKAGES" ]; then
  echo "missing bundled site-packages under $RUNTIME_ROOT/lib" >&2
  exit 1
fi

PYTHONNOUSERSITE=1 \
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH="$SITE_PACKAGES" \
exec "$PYTHON_ROOT/bin/python3" -m xyzrender.cli "$@"
EOF
  chmod 755 "$runtime/bin/xyzrender"
  # Installed packages are read-only, so ship hash-checked startup bytecode
  # (valid regardless of file mtimes) built by the staged interpreter itself.
  PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 "$python_root/bin/python3" \
    "$ROOT/scripts/prepare-xyzrender-bytecode.py" "$XYZRENDER_STAGE"
  "$runtime/bin/xyzrender" --help >/dev/null || {
    echo "error: staged xyzrender runtime does not start: $runtime/bin/xyzrender" >&2
    exit 1
  }
  python3 - "$XYZRENDER_TAURI_CONFIG" "$runtime" "$python_root" <<'PY'
import json, sys
config, runtime, python_root = sys.argv[1:]
resources = {runtime: "xyzrender-runtime", python_root: "xyzrender-python"}
with open(config, "w", encoding="utf-8") as output:
    json.dump({"bundle": {"resources": resources}}, output, indent=2)
    output.write("\n")
PY
  echo "Staged xyzrender runtime: $(du -sh "$XYZRENDER_STAGE" | cut -f1) in $XYZRENDER_STAGE"
}
# --- End bundled xyzrender runtime --------------------------------------------

bun scripts/check-release-version.mjs
node scripts/linux-desktop-metadata.mjs --check
bun install --frozen-lockfile --ignore-scripts
bun run build:agent-shell
stage_xyzrender_runtime
# The bundler reuses Burette.AppDir and keeps older packages next to new ones.
rm -rf "$TARGET_DIR/release/bundle"
(cd apps/desktop && bun run build:tauri -- --bundles "$BUNDLES" --config "$XYZRENDER_TAURI_CONFIG")

rm -rf "$OUTPUT"
mkdir -p "$OUTPUT"
for kind in deb rpm appimage; do
  [[ ",$BUNDLES," == *",$kind,"* ]] || continue
  found=0
  for artifact in "$TARGET_DIR/release/bundle/$kind"/*.{deb,rpm,AppImage}; do
    [[ -f "$artifact" ]] || continue
    cp "$artifact" "$OUTPUT/"
    found=1
  done
  [[ "$found" == 1 ]] || { echo "error: no $kind bundle in $TARGET_DIR/release/bundle/$kind" >&2; exit 1; }
done
(cd "$OUTPUT" && sha256sum -- * > SHA256SUMS)

cat <<MSG

BUILD SUCCEEDED: Burette for Linux
$(ls -1 "$OUTPUT" | sed 's/^/  /')
MSG
