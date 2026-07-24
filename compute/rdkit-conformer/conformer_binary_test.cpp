// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT

#include "conformer_binary.h"

#include <cassert>
#include <cstdint>
#include <stdexcept>

namespace {

std::uint32_t read_u32(const std::vector<std::uint8_t> &bytes,
                       std::size_t offset) {
  return std::uint32_t{bytes[offset]} |
         (std::uint32_t{bytes[offset + 1]} << 8) |
         (std::uint32_t{bytes[offset + 2]} << 16) |
         (std::uint32_t{bytes[offset + 3]} << 24);
}

}  // namespace

int main() {
  burette::conformer::ExtractedParameters parameters;
  parameters.atomic_numbers = {6, 8};
  parameters.formal_charges = {0, -1};
  parameters.distance_atom_pairs = {0, 1};
  parameters.distance_bounds_squared = {1.0F, 2.25F};
  parameters.distance_weights = {1.0F};

  const auto bytes = burette::conformer::encode_binary(
      parameters, burette::conformer::Variant::ETKDGv3);
  assert(bytes.size() == 92);
  assert(bytes[0] == 'B' && bytes[1] == 'C' && bytes[2] == 'E' &&
         bytes[3] == 'X');
  assert(bytes[4] == 1 && bytes[5] == 0);
  assert(bytes[8] == 6);
  assert(read_u32(bytes, 12) == 2);
  assert(read_u32(bytes, 16) == 1);
  assert(read_u32(bytes, 40) == 28);
  assert(read_u32(bytes, 44) == bytes.size());
  assert(read_u32(bytes, 48) == 20250304);

  parameters.distance_weights.clear();
  bool rejected = false;
  try {
    static_cast<void>(burette::conformer::encode_binary(
        parameters, burette::conformer::Variant::DG));
  } catch (const std::runtime_error &) {
    rejected = true;
  }
  assert(rejected);
}
