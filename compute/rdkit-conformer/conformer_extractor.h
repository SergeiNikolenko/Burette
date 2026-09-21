// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT
//
// RDKit Release_2025_03_4 API adapter. See README.md and THIRD_PARTY_NOTICES.md.

#pragma once

#include <cstdint>
#include <vector>

namespace RDKit {
class ROMol;
}

namespace burette::conformer {

enum class Variant : std::uint8_t {
  DG = 0,
  KDG = 1,
  ETDG = 2,
  ETDGv2 = 3,
  ETKDG = 4,
  ETKDGv2 = 5,
  ETKDGv3 = 6,
  SrETKDGv3 = 7,
};

struct ExtractedParameters {
  std::vector<std::uint16_t> atomic_numbers;
  std::vector<std::int8_t> formal_charges;

  std::vector<std::uint32_t> distance_atom_pairs;
  std::vector<float> distance_bounds_squared;
  std::vector<float> distance_weights;

  std::vector<std::uint32_t> chiral_atom_quads;
  std::vector<float> chiral_volume_bounds;

  std::vector<std::uint32_t> torsion_atom_quads;
  std::vector<float> torsion_coefficients;
  std::vector<std::int8_t> torsion_signs;

  std::vector<std::uint32_t> improper_atom_quads;
  std::vector<float> improper_weights;

  std::vector<std::uint32_t> etk_distance_atom_pairs;
  std::vector<float> etk_distance_bounds;
  std::vector<std::uint8_t> etk_distance_kinds;
  std::vector<float> etk_distance_weights;

  std::vector<std::uint32_t> stereo_atom_quints;
  std::vector<std::uint8_t> stereo_flags;
};

ExtractedParameters extract_parameters(RDKit::ROMol &mol, Variant variant);

}  // namespace burette::conformer
