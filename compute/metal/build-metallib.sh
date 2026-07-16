#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

if [[ $# -ne 1 || -z "$1" ]]; then
  printf 'usage: %s OUTPUT_DIRECTORY\n' "$(basename "$0")" >&2
  exit 64
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
source_files=(
  "$script_dir/tanimoto.v2.metal"
  "$script_dir/conformer-initialize.v1.metal"
  "$script_dir/conformer-distance.v1.metal"
)
contract_files=(
  "$script_dir/tanimoto-kernel-contract.v2.json"
  "$script_dir/conformer-initialize-kernel-contract.v1.json"
  "$script_dir/conformer-distance-kernel-contract.v1.json"
)
metadata_writer="$script_dir/write-build-metadata.mjs"
mkdir -p -- "$1"
output_dir="$(CDPATH= cd -- "$1" && pwd -P)"

command -v xcrun >/dev/null 2>&1 || fail 'xcrun is required to build Metal assets'
command -v bun >/dev/null 2>&1 || fail 'bun is required to write Metal build metadata'
[[ -x /usr/bin/shasum ]] || fail '/usr/bin/shasum is required'

if ! metal_tool="$(xcrun --sdk macosx --find metal 2>/dev/null)" ||
  [[ ! -x "$metal_tool" ]]; then
  fail 'Metal compiler unavailable; install the Xcode Metal Toolchain (xcodebuild -downloadComponent MetalToolchain)'
fi
if ! compiler_version="$("$metal_tool" --version 2>&1)"; then
  fail "Metal compiler cannot execute: $compiler_version"
fi
if ! metallib_tool="$(xcrun --sdk macosx --find metallib 2>/dev/null)" ||
  [[ ! -x "$metallib_tool" ]]; then
  fail 'metallib linker unavailable; install the Xcode Metal Toolchain (xcodebuild -downloadComponent MetalToolchain)'
fi
if ! sdk_path="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)" ||
  [[ ! -d "$sdk_path" ]]; then
  fail 'active macOS SDK is unavailable through xcrun'
fi
sdk_version="$(xcrun --sdk macosx --show-sdk-version 2>/dev/null)" ||
  fail 'active macOS SDK version is unavailable through xcrun'
sdk_build_version="$(xcrun --sdk macosx --show-sdk-build-version 2>/dev/null)" ||
  fail 'active macOS SDK build version is unavailable through xcrun'

stage_dir="$(mktemp -d "$output_dir/generation.XXXXXX")"
pointer_stage=''
keep_stage=0
cleanup() {
  [[ -z "$pointer_stage" ]] || rm -f "$pointer_stage"
  [[ "$keep_stage" -eq 1 ]] || rm -rf "$stage_dir"
}
trap cleanup EXIT
air_files=(
  "$stage_dir/tanimoto.v2.air"
  "$stage_dir/conformer-initialize.v1.air"
  "$stage_dir/conformer-distance.v1.air"
)
library_file="$stage_dir/native-compute.v4.metallib"
metadata_file="$stage_dir/build-metadata.v2.json"

sha256() {
  /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'
}

source_sha256_0="$(sha256 "${source_files[0]}")"
source_sha256_1="$(sha256 "${source_files[1]}")"
source_sha256_2="$(sha256 "${source_files[2]}")"
contract_sha256_0="$(sha256 "${contract_files[0]}")"
contract_sha256_1="$(sha256 "${contract_files[1]}")"
contract_sha256_2="$(sha256 "${contract_files[2]}")"
metal_tool_sha256="$(sha256 "$metal_tool")"
metallib_tool_sha256="$(sha256 "$metallib_tool")"

for index in 0 1 2; do
  "$metal_tool" \
    -std=metal3.1 \
    -mmacosx-version-min=14.0 \
    -c "${source_files[$index]}" \
    -o "${air_files[$index]}"
done
"$metallib_tool" "${air_files[@]}" -o "$library_file"

[[ "$(sha256 "${source_files[0]}")" == "$source_sha256_0" &&
   "$(sha256 "${source_files[1]}")" == "$source_sha256_1" &&
   "$(sha256 "${source_files[2]}")" == "$source_sha256_2" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${contract_files[0]}")" == "$contract_sha256_0" &&
   "$(sha256 "${contract_files[1]}")" == "$contract_sha256_1" &&
   "$(sha256 "${contract_files[2]}")" == "$contract_sha256_2" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "$metal_tool")" == "$metal_tool_sha256" ]] ||
  fail 'Metal compiler changed during compilation'
[[ "$(sha256 "$metallib_tool")" == "$metallib_tool_sha256" ]] ||
  fail 'metallib linker changed during compilation'

TANIMOTO_SOURCE_SHA256="$source_sha256_0" \
CONFORMER_SOURCE_SHA256="$source_sha256_1" \
DISTANCE_SOURCE_SHA256="$source_sha256_2" \
TANIMOTO_CONTRACT_SHA256="$contract_sha256_0" \
CONFORMER_CONTRACT_SHA256="$contract_sha256_1" \
DISTANCE_CONTRACT_SHA256="$contract_sha256_2" \
TANIMOTO_AIR_SHA256="$(sha256 "${air_files[0]}")" \
CONFORMER_AIR_SHA256="$(sha256 "${air_files[1]}")" \
DISTANCE_AIR_SHA256="$(sha256 "${air_files[2]}")" \
METALLIB_SHA256="$(sha256 "$library_file")" \
METAL_TOOL_PATH="$metal_tool" \
METAL_TOOL_SHA256="$metal_tool_sha256" \
METAL_TOOL_VERSION="$compiler_version" \
METALLIB_TOOL_PATH="$metallib_tool" \
METALLIB_TOOL_SHA256="$metallib_tool_sha256" \
SDK_PATH="$sdk_path" \
SDK_VERSION="$sdk_version" \
SDK_BUILD_VERSION="$sdk_build_version" \
  bun "$metadata_writer" "$metadata_file"

generation_name="$(basename "$stage_dir")"
metadata_sha256="$(sha256 "$metadata_file")"
pointer_stage="$(mktemp "$output_dir/.current.XXXXXX")"
printf '{"schemaVersion":"burrete.compute.metal-generation-pointer.v1","generation":"%s","metadataSha256":"%s"}\n' \
  "$generation_name" "$metadata_sha256" > "$pointer_stage"

# The generation is complete before the only advertised pointer is replaced.
# Keeping it before rename makes interruption safe on either side of the move.
keep_stage=1
/bin/mv -f "$pointer_stage" "$output_dir/current.json"
pointer_stage=''
printf 'Built %s/%s\n' "$stage_dir" "native-compute.v4.metallib"
