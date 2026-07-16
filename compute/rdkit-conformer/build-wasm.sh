#!/usr/bin/env bash
set -euo pipefail

readonly expected_commit="276b5a662302c6a548ac4f1363c066f3258e3a20"
readonly adapter_root="$(cd "$(dirname "$0")" && pwd)"

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 /path/to/rdkit/source /absolute/output/directory" >&2
  exit 64
fi

readonly source_root="$(cd "$1" && pwd)"
mkdir -p "$2"
readonly output_root="$(cd "$2" && pwd)"

for command in git emcmake cmake; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required build command is unavailable: $command" >&2
    exit 69
  fi
done

if [[ "$(git -C "$source_root" rev-parse HEAD)" != "$expected_commit" ]]; then
  echo "RDKit source must be exactly $expected_commit" >&2
  exit 65
fi

readonly temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/burrete-rdkit-conformer.XXXXXX")"
readonly source_worktree="$temporary_root/rdkit"
readonly build_root="$temporary_root/build"
cleanup() {
  git -C "$source_root" worktree remove --force "$source_worktree" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
}
trap cleanup EXIT

git -C "$source_root" worktree add --quiet --detach "$source_worktree" "$expected_commit"
git -C "$source_worktree" apply --check "$adapter_root/rdkit-minimallib.patch"
git -C "$source_worktree" apply "$adapter_root/rdkit-minimallib.patch"

emcmake cmake -S "$source_worktree" -B "$build_root" \
  -DRDK_BUILD_MINIMAL_LIB=ON \
  -DRDK_BUILD_PYTHON_WRAPPERS=OFF \
  -DRDK_BUILD_CPP_TESTS=OFF \
  -DRDK_BUILD_INCHI_SUPPORT=OFF \
  -DRDK_USE_BOOST_SERIALIZATION=OFF \
  -DRDK_OPTIMIZE_POPCNT=OFF \
  -DRDK_BUILD_THREADSAFE_SSS=OFF \
  -DRDK_BUILD_DESCRIPTORS3D=OFF \
  -DRDK_TEST_MULTITHREADED=OFF \
  -DRDK_BUILD_MAEPARSER_SUPPORT=OFF \
  -DRDK_BUILD_COORDGEN_SUPPORT=OFF \
  -DRDK_BUILD_FREETYPE_SUPPORT=OFF \
  -DRDK_BUILD_SLN_SUPPORT=OFF \
  -DRDK_USE_BOOST_IOSTREAMS=OFF \
  -DBURRETE_CONFORMER_SOURCE_DIR="$adapter_root" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="-fwasm-exceptions -O3 -DNDEBUG" \
  -DCMAKE_C_FLAGS="-fwasm-exceptions -O3 -DNDEBUG -DCOMPILE_ANSI_ONLY" \
  -DCMAKE_EXE_LINKER_FLAGS="-fwasm-exceptions -sSTACK_OVERFLOW_CHECK=1 -sUSE_PTHREADS=0 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sMODULARIZE=1 -sEXPORT_NAME=initBurreteRDKitConformer"

cmake --build "$build_root" --target Burrete_rdkit_conformer --parallel 2
install -m 0644 "$build_root/Code/MinimalLib/Burrete_rdkit_conformer.js" "$output_root/"
install -m 0644 "$build_root/Code/MinimalLib/Burrete_rdkit_conformer.wasm" "$output_root/"

echo "Built pinned RDKit conformer extractor in $output_root"
