#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/burette-conformer-binary.XXXXXX")"
trap 'rm -rf "$build_dir"' EXIT

"${CXX:-c++}" -std=c++17 -Wall -Wextra -Werror \
  -I"$root" \
  "$root/conformer_binary.cpp" \
  "$root/conformer_binary_test.cpp" \
  -o "$build_dir/conformer-binary-test"
"$build_dir/conformer-binary-test"

"${CXX:-c++}" -std=c++17 -Wall -Wextra -Werror \
  -I"$root" \
  "$root/mmff_binary.cpp" \
  "$root/mmff_binary_test.cpp" \
  -o "$build_dir/mmff-binary-test"
"$build_dir/mmff-binary-test"
