#!/usr/bin/env bash
# Rebuilds the browser symmetry engines from pinned upstream sources:
#   burette-msym.wasm   libmsym point groups and symmetrization
#   burette-niggli.wasm spglib Niggli cell reduction
# Both are standalone WebAssembly modules with no generated JavaScript glue.
set -euo pipefail

readonly libmsym_repository="https://github.com/mcodev31/libmsym.git"
readonly libmsym_commit="85e47232376a8e735c2a7b5283f40b59b3953db1"
readonly spglib_repository="https://github.com/spglib/spglib.git"
readonly spglib_commit="3ebd8ac3318793932baeee90b44f453a7c35b5b4" # v2.8.0
readonly emscripten_version="6.0.13"

readonly adapter_root="$(cd "$(dirname "$0")" && pwd)"
readonly repository_root="$(cd "$adapter_root/../.." && pwd)"
readonly default_output="$repository_root/apps/desktop/src/lib/molecular-workbench/symmetry"

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [output-directory]" >&2
  echo "Optional: BURETTE_LIBMSYM_SOURCE and BURETTE_SPGLIB_SOURCE point at existing git checkouts." >&2
  exit 64
fi
mkdir -p "${1:-$default_output}"
readonly output_root="$(cd "${1:-$default_output}" && pwd)"

for command in git emcc shasum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required build command is unavailable: $command" >&2
    exit 69
  fi
done

if ! emcc --version | head -n 1 | grep -q " $emscripten_version "; then
  echo "Emscripten $emscripten_version is required; found: $(emcc --version | head -n 1)" >&2
  exit 65
fi

readonly temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/burette-symmetry-wasm.XXXXXX")"
cleanup() { rm -rf "$temporary_root"; }
trap cleanup EXIT

# Exports a pinned revision into the build tree. An existing checkout only
# supplies objects; the files compiled always come from the pinned commit.
export_source() {
  local name="$1" repository="$2" commit="$3" existing="${4:-}"
  local clone="$temporary_root/$name.git"
  if [[ -n "$existing" ]]; then
    git clone --quiet --no-checkout --shared "$existing" "$clone"
  else
    git clone --quiet --no-checkout --filter=blob:none "$repository" "$clone"
  fi
  if ! git -C "$clone" cat-file -e "$commit^{commit}" 2>/dev/null; then
    git -C "$clone" fetch --quiet origin "$commit"
  fi
  mkdir -p "$temporary_root/sources/$name"
  git -C "$clone" archive "$commit" | tar -x -C "$temporary_root/sources/$name"
}

export_source libmsym "$libmsym_repository" "$libmsym_commit" "${BURETTE_LIBMSYM_SOURCE:-}"
export_source spglib "$spglib_repository" "$spglib_commit" "${BURETTE_SPGLIB_SOURCE:-}"

(cd "$temporary_root/sources" && shasum -a 256 -c --quiet "$adapter_root/sources.sha256")

readonly sources="$temporary_root/sources"
readonly build_root="$temporary_root/build"
mkdir -p "$build_root"
export EMCC_CORES=2

readonly common_flags=(
  -std=c99 -O3 -g0 -DNDEBUG
  "-ffile-prefix-map=$temporary_root=."
  -sSTANDALONE_WASM=1 --no-entry
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=256MB
)

msym_sources=()
while IFS= read -r file; do msym_sources+=("$sources/$file"); done < <(cd "$sources" && ls libmsym/src/*.c)

emcc "${common_flags[@]}" \
  -I"$adapter_root" -I"$sources/libmsym/src" \
  "${msym_sources[@]}" "$adapter_root/burette_msym.c" \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_burette_msym_analyze,_burette_msym_error,_burette_msym_point_group,_burette_msym_operation_count,_burette_msym_operations,_burette_msym_operation_name,_burette_msym_set_count,_burette_msym_set_offsets,_burette_msym_set_atoms,_burette_msym_set_errors,_burette_msym_coordinates,_burette_msym_symmetrization_error,_burette_msym_center,_burette_msym_release \
  -o "$build_root/burette-msym.wasm"

emcc "${common_flags[@]}" \
  -I"$sources/spglib/include" -I"$sources/spglib/src" \
  "$sources/spglib/src/niggli.c" "$adapter_root/burette_niggli.c" \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_burette_niggli_reduce \
  -o "$build_root/burette-niggli.wasm"

install -m 0644 "$build_root/burette-msym.wasm" "$build_root/burette-niggli.wasm" "$output_root/"
(cd "$build_root" && shasum -a 256 burette-msym.wasm burette-niggli.wasm) > "$adapter_root/outputs.sha256"

echo "Built pinned symmetry engines in $output_root"
cat "$adapter_root/outputs.sha256"
