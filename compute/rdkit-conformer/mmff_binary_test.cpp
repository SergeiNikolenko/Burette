// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT

#include "mmff_binary.h"

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
  burette::mmff::ExtractedParameters parameters;
  parameters.atom_count = 2;
  parameters.partial_charges = {0.1F, -0.1F};
  parameters.bonds.push_back({{0, 1, 0, 0}, {4.0F, 1.2F, 0, 0}, {}});
  const auto bytes = burette::mmff::encode_binary(
      parameters, burette::mmff::Variant::MMFF94s);
  assert(bytes.size() == 128);
  assert(bytes[0] == 'B' && bytes[1] == 'M' && bytes[2] == 'F' &&
         bytes[3] == 'X');
  assert(bytes[8] == 1);
  assert(read_u32(bytes, 12) == 2);
  assert(read_u32(bytes, 16) == 1);
  assert(read_u32(bytes, 44) == 64);
  assert(read_u32(bytes, 48) == bytes.size());
  assert(read_u32(bytes, 52) == 20250304);

  parameters.bonds[0].atoms[1] = 2;
  bool rejected = false;
  try {
    static_cast<void>(burette::mmff::encode_binary(
        parameters, burette::mmff::Variant::MMFF94));
  } catch (const std::runtime_error &) {
    rejected = true;
  }
  assert(rejected);
}
