// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT

#include "conformer_binary.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <type_traits>

namespace burette::conformer {
namespace {

template <typename T>
std::uint32_t checked_count(const std::vector<T> &values, std::size_t width,
                            const char *label) {
  if (width == 0 || values.size() % width != 0 ||
      values.size() / width > std::numeric_limits<std::uint32_t>::max()) {
    throw std::runtime_error(std::string(label) +
                             " violates the conformer extractor ABI");
  }
  return static_cast<std::uint32_t>(values.size() / width);
}

void require_size(std::size_t actual, std::uint64_t expected,
                  const char *label) {
  if (actual != expected) {
    throw std::runtime_error(std::string(label) +
                             " violates the conformer extractor ABI");
  }
}

void require_atom_indices(const std::vector<std::uint32_t> &indices,
                          std::uint32_t atom_count, const char *label) {
  if (indices.end() !=
      std::find_if(indices.begin(), indices.end(), [atom_count](auto index) {
        return index >= atom_count;
      })) {
    throw std::runtime_error(std::string(label) +
                             " contains an out-of-range atom index");
  }
}

void require_finite(const std::vector<float> &values, const char *label) {
  if (values.end() !=
      std::find_if(values.begin(), values.end(),
                   [](float value) { return !std::isfinite(value); })) {
    throw std::runtime_error(std::string(label) +
                             " contains a non-finite value");
  }
}

void append_u16(std::vector<std::uint8_t> &bytes, std::uint16_t value) {
  bytes.push_back(static_cast<std::uint8_t>(value));
  bytes.push_back(static_cast<std::uint8_t>(value >> 8));
}

void append_u32(std::vector<std::uint8_t> &bytes, std::uint32_t value) {
  for (unsigned int shift = 0; shift < 32; shift += 8) {
    bytes.push_back(static_cast<std::uint8_t>(value >> shift));
  }
}

void overwrite_u32(std::vector<std::uint8_t> &bytes, std::size_t offset,
                   std::uint32_t value) {
  for (unsigned int shift = 0; shift < 32; shift += 8) {
    bytes[offset++] = static_cast<std::uint8_t>(value >> shift);
  }
}

void align_to(std::vector<std::uint8_t> &bytes, std::size_t alignment) {
  while (bytes.size() % alignment != 0) {
    bytes.push_back(0);
  }
}

template <typename T>
void append_values(std::vector<std::uint8_t> &bytes,
                   const std::vector<T> &values) {
  static_assert(std::is_integral_v<T> || std::is_same_v<T, float>);
  align_to(bytes, alignof(T));
  for (const auto value : values) {
    if constexpr (sizeof(T) == 1) {
      bytes.push_back(static_cast<std::uint8_t>(value));
    } else if constexpr (sizeof(T) == 2) {
      append_u16(bytes, static_cast<std::uint16_t>(value));
    } else if constexpr (std::is_same_v<T, float>) {
      static_assert(sizeof(float) == sizeof(std::uint32_t));
      std::uint32_t bits = 0;
      std::memcpy(&bits, &value, sizeof(bits));
      append_u32(bytes, bits);
    } else {
      append_u32(bytes, static_cast<std::uint32_t>(value));
    }
  }
}

}  // namespace

std::vector<std::uint8_t> encode_binary(const ExtractedParameters &p,
                                        Variant variant) {
  if (static_cast<std::uint8_t>(variant) >
      static_cast<std::uint8_t>(Variant::SrETKDGv3)) {
    throw std::runtime_error("conformer variant is outside ABI v1");
  }
  const auto atoms = checked_count(p.atomic_numbers, 1, "atomicNumbers");
  const auto distances =
      checked_count(p.distance_atom_pairs, 2, "distanceAtomPairs");
  const auto chiral = checked_count(p.chiral_atom_quads, 4, "chiralAtomQuads");
  const auto torsions =
      checked_count(p.torsion_atom_quads, 4, "torsionAtomQuads");
  const auto impropers =
      checked_count(p.improper_atom_quads, 4, "improperAtomQuads");
  const auto etk_distances =
      checked_count(p.etk_distance_atom_pairs, 2, "etkDistanceAtomPairs");
  const auto stereo =
      checked_count(p.stereo_atom_quints, 5, "stereoAtomQuints");

  require_size(p.formal_charges.size(), atoms, "formalCharges");
  require_size(p.distance_bounds_squared.size(), std::uint64_t{distances} * 2,
               "distanceBoundsSquared");
  require_size(p.distance_weights.size(), distances, "distanceWeights");
  require_size(p.chiral_volume_bounds.size(), std::uint64_t{chiral} * 2,
               "chiralVolumeBounds");
  require_size(p.torsion_coefficients.size(), std::uint64_t{torsions} * 6,
               "torsionCoefficients");
  require_size(p.torsion_signs.size(), std::uint64_t{torsions} * 6,
               "torsionSigns");
  require_size(p.improper_weights.size(), impropers, "improperWeights");
  require_size(p.etk_distance_bounds.size(), std::uint64_t{etk_distances} * 2,
               "etkDistanceBounds");
  require_size(p.etk_distance_kinds.size(), etk_distances, "etkDistanceKinds");
  require_size(p.etk_distance_weights.size(), etk_distances,
               "etkDistanceWeights");
  require_size(p.stereo_flags.size(), stereo, "stereoFlags");
  require_atom_indices(p.distance_atom_pairs, atoms, "distanceAtomPairs");
  require_atom_indices(p.chiral_atom_quads, atoms, "chiralAtomQuads");
  require_atom_indices(p.torsion_atom_quads, atoms, "torsionAtomQuads");
  require_atom_indices(p.improper_atom_quads, atoms, "improperAtomQuads");
  require_atom_indices(p.etk_distance_atom_pairs, atoms,
                       "etkDistanceAtomPairs");
  require_atom_indices(p.stereo_atom_quints, atoms, "stereoAtomQuints");
  require_finite(p.distance_bounds_squared, "distanceBoundsSquared");
  require_finite(p.distance_weights, "distanceWeights");
  require_finite(p.chiral_volume_bounds, "chiralVolumeBounds");
  require_finite(p.torsion_coefficients, "torsionCoefficients");
  require_finite(p.improper_weights, "improperWeights");
  require_finite(p.etk_distance_bounds, "etkDistanceBounds");
  require_finite(p.etk_distance_weights, "etkDistanceWeights");

  std::vector<std::uint8_t> bytes;
  bytes.reserve(kBinaryHeaderBytes);
  bytes.insert(bytes.end(), {'B', 'C', 'E', 'X'});
  append_u16(bytes, kBinaryAbiVersion);
  append_u16(bytes, kBinaryHeaderBytes);
  bytes.push_back(static_cast<std::uint8_t>(variant));
  bytes.push_back(0);
  append_u16(bytes, 0);
  for (const auto count :
       {atoms, distances, chiral, torsions, impropers, etk_distances, stereo}) {
    append_u32(bytes, count);
  }
  append_u32(bytes, 0);  // payload bytes, filled after encoding
  append_u32(bytes, 0);  // total bytes, filled after encoding
  append_u32(bytes, 20250304);
  bytes.resize(kBinaryHeaderBytes, 0);

  append_values(bytes, p.atomic_numbers);
  append_values(bytes, p.formal_charges);
  append_values(bytes, p.distance_atom_pairs);
  append_values(bytes, p.distance_bounds_squared);
  append_values(bytes, p.distance_weights);
  append_values(bytes, p.chiral_atom_quads);
  append_values(bytes, p.chiral_volume_bounds);
  append_values(bytes, p.torsion_atom_quads);
  append_values(bytes, p.torsion_coefficients);
  append_values(bytes, p.torsion_signs);
  append_values(bytes, p.improper_atom_quads);
  append_values(bytes, p.improper_weights);
  append_values(bytes, p.etk_distance_atom_pairs);
  append_values(bytes, p.etk_distance_bounds);
  append_values(bytes, p.etk_distance_kinds);
  append_values(bytes, p.etk_distance_weights);
  append_values(bytes, p.stereo_atom_quints);
  append_values(bytes, p.stereo_flags);

  if (bytes.size() > std::numeric_limits<std::uint32_t>::max()) {
    throw std::runtime_error("conformer extractor output exceeds 4 GiB");
  }
  const auto total = static_cast<std::uint32_t>(bytes.size());
  overwrite_u32(bytes, 40, total - kBinaryHeaderBytes);
  overwrite_u32(bytes, 44, total);
  return bytes;
}

}  // namespace burette::conformer
