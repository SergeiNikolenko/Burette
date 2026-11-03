#!/usr/bin/env bash
# Rebuilds the browser powder-diffraction engine from pinned upstream sources:
#   burette-xrd.wasm  Gemmi X-ray structure factors over a resolution shell
# A standalone WebAssembly module with no generated JavaScript glue.
set -euo pipefail

readonly gemmi_repository="https://github.com/project-gemmi/gemmi.git"
readonly gemmi_commit="5cc1c23c6007e0e6cbd69289c6f7c0bff50e943e" # v0.7.5
readonly emscripten_version="6.0.13"

readonly adapter_root="$(cd "$(dirname "$0")" && pwd)"
readonly repository_root="$(cd "$adapter_root/../.." && pwd)"
readonly default_output="$repository_root/apps/desktop/src/lib/molecular-workbench/xrd"

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [output-directory]" >&2
  echo "Optional: BURETTE_GEMMI_SOURCE points at an existing git checkout." >&2
  exit 64
fi
mkdir -p "${1:-$default_output}"
readonly output_root="$(cd "${1:-$default_output}" && pwd)"

for command in git em++ shasum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required build command is unavailable: $command" >&2
    exit 69
  fi
done

if ! em++ --version | head -n 1 | grep -q " $emscripten_version "; then
  echo "Emscripten $emscripten_version is required; found: $(em++ --version | head -n 1)" >&2
  exit 65
fi

readonly temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/burette-xrd-wasm.XXXXXX")"
cleanup() { rm -rf "$temporary_root"; }
trap cleanup EXIT

# Exports the pinned revision into the build tree. An existing checkout only
# supplies objects; the files compiled always come from the pinned commit.
readonly clone="$temporary_root/gemmi.git"
if [[ -n "${BURETTE_GEMMI_SOURCE:-}" ]]; then
  git clone --quiet --no-checkout --shared "$BURETTE_GEMMI_SOURCE" "$clone"
else
  git clone --quiet --no-checkout --filter=blob:none "$gemmi_repository" "$clone"
fi
if ! git -C "$clone" cat-file -e "$gemmi_commit^{commit}" 2>/dev/null; then
  git -C "$clone" fetch --quiet origin "$gemmi_commit"
fi
mkdir -p "$temporary_root/sources/gemmi"
git -C "$clone" archive "$gemmi_commit" LICENSE.txt include/gemmi src/symmetry.cpp | tar -x -C "$temporary_root/sources/gemmi"

# Every upstream file the adapter compiles, plus the license.
(cd "$temporary_root/sources" && shasum -a 256 -c --quiet "$adapter_root/sources.sha256")

readonly sources="$temporary_root/sources"
readonly build_root="$temporary_root/build"
mkdir -p "$build_root"
export EMCC_CORES=2

# Exceptions stay disabled: inputs are validated before Gemmi runs, and a
# Gemmi failure aborts the module, which the worker reports as an error.
em++ -std=c++17 -O3 -g0 -DNDEBUG \
  "-ffile-prefix-map=$temporary_root=." "-ffile-prefix-map=$adapter_root=." \
  -sSTANDALONE_WASM=1 --no-entry \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=256MB \
  -I"$sources/gemmi/include" \
  "$adapter_root/burette_xrd.cpp" "$sources/gemmi/src/symmetry.cpp" \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_burette_xrd_count,_burette_xrd_structure_factors \
  -o "$build_root/burette-xrd.wasm"

install -m 0644 "$build_root/burette-xrd.wasm" "$output_root/"
(cd "$build_root" && shasum -a 256 burette-xrd.wasm) > "$adapter_root/outputs.sha256"

echo "Built pinned powder-diffraction engine in $output_root"
cat "$adapter_root/outputs.sha256"
