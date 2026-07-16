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
  "$script_dir/conformer-optimize.v1.metal"
  "$script_dir/conformer-stereo.v1.metal"
  "$script_dir/conformer-etk.v1.metal"
  "$script_dir/conformer-etk-optimize.v1.metal"
  "$script_dir/mmff-energy.v1.metal"
  "$script_dir/alignment-score.v1.metal"
  "$script_dir/rm1-fock.v1.metal"
  "$script_dir/rm1-eigen.v1.metal"
  "$script_dir/rm1-pair-rotate.v1.metal"
  "$script_dir/pm6-h4-hh.v1.metal"
  "$script_dir/pm6-d3-chno.v1.metal"
  "$script_dir/pm6-one-center-fock.v1.metal"
)
contract_files=(
  "$script_dir/tanimoto-kernel-contract.v2.json"
  "$script_dir/conformer-initialize-kernel-contract.v1.json"
  "$script_dir/conformer-distance-kernel-contract.v1.json"
  "$script_dir/conformer-optimize-kernel-contract.v1.json"
  "$script_dir/conformer-stereo-kernel-contract.v1.json"
  "$script_dir/conformer-etk-kernel-contract.v1.json"
  "$script_dir/conformer-etk-optimize-kernel-contract.v1.json"
  "$script_dir/mmff-energy-kernel-contract.v1.json"
  "$script_dir/alignment-score-kernel-contract.v1.json"
  "$script_dir/rm1-fock-kernel-contract.v1.json"
  "$script_dir/rm1-eigen-kernel-contract.v1.json"
  "$script_dir/rm1-pair-rotate-kernel-contract.v1.json"
  "$script_dir/pm6-h4-hh-kernel-contract.v1.json"
  "$script_dir/pm6-d3-chno-kernel-contract.v1.json"
  "$script_dir/pm6-one-center-fock-kernel-contract.v1.json"
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
  "$stage_dir/conformer-optimize.v1.air"
  "$stage_dir/conformer-stereo.v1.air"
  "$stage_dir/conformer-etk.v1.air"
  "$stage_dir/conformer-etk-optimize.v1.air"
  "$stage_dir/mmff-energy.v1.air"
  "$stage_dir/alignment-score.v1.air"
  "$stage_dir/rm1-fock.v1.air"
  "$stage_dir/rm1-eigen.v1.air"
  "$stage_dir/rm1-pair-rotate.v1.air"
  "$stage_dir/pm6-h4-hh.v1.air"
  "$stage_dir/pm6-d3-chno.v1.air"
  "$stage_dir/pm6-one-center-fock.v1.air"
)
library_file="$stage_dir/native-compute.v17.metallib"
metadata_file="$stage_dir/build-metadata.v2.json"

sha256() {
  /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'
}

source_sha256_0="$(sha256 "${source_files[0]}")"
source_sha256_1="$(sha256 "${source_files[1]}")"
source_sha256_2="$(sha256 "${source_files[2]}")"
source_sha256_3="$(sha256 "${source_files[3]}")"
source_sha256_4="$(sha256 "${source_files[4]}")"
source_sha256_5="$(sha256 "${source_files[5]}")"
source_sha256_6="$(sha256 "${source_files[6]}")"
source_sha256_7="$(sha256 "${source_files[7]}")"
source_sha256_8="$(sha256 "${source_files[8]}")"
source_sha256_9="$(sha256 "${source_files[9]}")"
source_sha256_10="$(sha256 "${source_files[10]}")"
source_sha256_11="$(sha256 "${source_files[11]}")"
source_sha256_12="$(sha256 "${source_files[12]}")"
source_sha256_13="$(sha256 "${source_files[13]}")"
source_sha256_14="$(sha256 "${source_files[14]}")"
contract_sha256_0="$(sha256 "${contract_files[0]}")"
contract_sha256_1="$(sha256 "${contract_files[1]}")"
contract_sha256_2="$(sha256 "${contract_files[2]}")"
contract_sha256_3="$(sha256 "${contract_files[3]}")"
contract_sha256_4="$(sha256 "${contract_files[4]}")"
contract_sha256_5="$(sha256 "${contract_files[5]}")"
contract_sha256_6="$(sha256 "${contract_files[6]}")"
contract_sha256_7="$(sha256 "${contract_files[7]}")"
contract_sha256_8="$(sha256 "${contract_files[8]}")"
contract_sha256_9="$(sha256 "${contract_files[9]}")"
contract_sha256_10="$(sha256 "${contract_files[10]}")"
contract_sha256_11="$(sha256 "${contract_files[11]}")"
contract_sha256_12="$(sha256 "${contract_files[12]}")"
contract_sha256_13="$(sha256 "${contract_files[13]}")"
contract_sha256_14="$(sha256 "${contract_files[14]}")"
metal_tool_sha256="$(sha256 "$metal_tool")"
metallib_tool_sha256="$(sha256 "$metallib_tool")"

for index in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do
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
[[ "$(sha256 "${source_files[3]}")" == "$source_sha256_3" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[4]}")" == "$source_sha256_4" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[5]}")" == "$source_sha256_5" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[6]}")" == "$source_sha256_6" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[7]}")" == "$source_sha256_7" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[8]}")" == "$source_sha256_8" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[9]}")" == "$source_sha256_9" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[10]}")" == "$source_sha256_10" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[11]}")" == "$source_sha256_11" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[12]}")" == "$source_sha256_12" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[13]}")" == "$source_sha256_13" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${source_files[14]}")" == "$source_sha256_14" ]] ||
  fail 'Metal source changed during compilation'
[[ "$(sha256 "${contract_files[0]}")" == "$contract_sha256_0" &&
   "$(sha256 "${contract_files[1]}")" == "$contract_sha256_1" &&
   "$(sha256 "${contract_files[2]}")" == "$contract_sha256_2" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[3]}")" == "$contract_sha256_3" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[4]}")" == "$contract_sha256_4" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[5]}")" == "$contract_sha256_5" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[6]}")" == "$contract_sha256_6" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[7]}")" == "$contract_sha256_7" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[8]}")" == "$contract_sha256_8" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[9]}")" == "$contract_sha256_9" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[10]}")" == "$contract_sha256_10" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[11]}")" == "$contract_sha256_11" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[12]}")" == "$contract_sha256_12" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[13]}")" == "$contract_sha256_13" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "${contract_files[14]}")" == "$contract_sha256_14" ]] ||
  fail 'Metal kernel contract changed during compilation'
[[ "$(sha256 "$metal_tool")" == "$metal_tool_sha256" ]] ||
  fail 'Metal compiler changed during compilation'
[[ "$(sha256 "$metallib_tool")" == "$metallib_tool_sha256" ]] ||
  fail 'metallib linker changed during compilation'

TANIMOTO_SOURCE_SHA256="$source_sha256_0" \
CONFORMER_SOURCE_SHA256="$source_sha256_1" \
DISTANCE_SOURCE_SHA256="$source_sha256_2" \
OPTIMIZER_SOURCE_SHA256="$source_sha256_3" \
STEREO_SOURCE_SHA256="$source_sha256_4" \
ETK_SOURCE_SHA256="$source_sha256_5" \
ETK_OPTIMIZER_SOURCE_SHA256="$source_sha256_6" \
MMFF_SOURCE_SHA256="$source_sha256_7" \
ALIGNMENT_SOURCE_SHA256="$source_sha256_8" \
RM1_FOCK_SOURCE_SHA256="$source_sha256_9" \
RM1_EIGEN_SOURCE_SHA256="$source_sha256_10" \
RM1_PAIR_ROTATE_SOURCE_SHA256="$source_sha256_11" \
PM6_H4_HH_SOURCE_SHA256="$source_sha256_12" \
PM6_D3_SOURCE_SHA256="$source_sha256_13" \
PM6_ONE_CENTER_FOCK_SOURCE_SHA256="$source_sha256_14" \
TANIMOTO_CONTRACT_SHA256="$contract_sha256_0" \
CONFORMER_CONTRACT_SHA256="$contract_sha256_1" \
DISTANCE_CONTRACT_SHA256="$contract_sha256_2" \
OPTIMIZER_CONTRACT_SHA256="$contract_sha256_3" \
STEREO_CONTRACT_SHA256="$contract_sha256_4" \
ETK_CONTRACT_SHA256="$contract_sha256_5" \
ETK_OPTIMIZER_CONTRACT_SHA256="$contract_sha256_6" \
MMFF_CONTRACT_SHA256="$contract_sha256_7" \
ALIGNMENT_CONTRACT_SHA256="$contract_sha256_8" \
RM1_FOCK_CONTRACT_SHA256="$contract_sha256_9" \
RM1_EIGEN_CONTRACT_SHA256="$contract_sha256_10" \
RM1_PAIR_ROTATE_CONTRACT_SHA256="$contract_sha256_11" \
PM6_H4_HH_CONTRACT_SHA256="$contract_sha256_12" \
PM6_D3_CONTRACT_SHA256="$contract_sha256_13" \
PM6_ONE_CENTER_FOCK_CONTRACT_SHA256="$contract_sha256_14" \
TANIMOTO_AIR_SHA256="$(sha256 "${air_files[0]}")" \
CONFORMER_AIR_SHA256="$(sha256 "${air_files[1]}")" \
DISTANCE_AIR_SHA256="$(sha256 "${air_files[2]}")" \
OPTIMIZER_AIR_SHA256="$(sha256 "${air_files[3]}")" \
STEREO_AIR_SHA256="$(sha256 "${air_files[4]}")" \
ETK_AIR_SHA256="$(sha256 "${air_files[5]}")" \
ETK_OPTIMIZER_AIR_SHA256="$(sha256 "${air_files[6]}")" \
MMFF_AIR_SHA256="$(sha256 "${air_files[7]}")" \
ALIGNMENT_AIR_SHA256="$(sha256 "${air_files[8]}")" \
RM1_FOCK_AIR_SHA256="$(sha256 "${air_files[9]}")" \
RM1_EIGEN_AIR_SHA256="$(sha256 "${air_files[10]}")" \
RM1_PAIR_ROTATE_AIR_SHA256="$(sha256 "${air_files[11]}")" \
PM6_H4_HH_AIR_SHA256="$(sha256 "${air_files[12]}")" \
PM6_D3_AIR_SHA256="$(sha256 "${air_files[13]}")" \
PM6_ONE_CENTER_FOCK_AIR_SHA256="$(sha256 "${air_files[14]}")" \
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
printf 'Built %s/%s\n' "$stage_dir" "native-compute.v17.metallib"
