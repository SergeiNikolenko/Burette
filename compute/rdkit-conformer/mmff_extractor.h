// Copyright 2026 Burrete contributors.
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace RDKit {
class ROMol;
}

namespace burrete::mmff {

enum class Variant : std::uint8_t { MMFF94 = 0, MMFF94s = 1 };

struct alignas(16) Term {
  std::array<std::uint32_t, 4> atoms{};
  std::array<float, 4> parameters0{};
  std::array<float, 4> parameters1{};
};

static_assert(sizeof(Term) == 48);
static_assert(alignof(Term) == 16);

struct ExtractedParameters {
  std::uint32_t atom_count{};
  std::vector<float> partial_charges;
  std::vector<Term> bonds;
  std::vector<Term> angles;
  std::vector<Term> stretch_bends;
  std::vector<Term> out_of_planes;
  std::vector<Term> torsions;
  std::vector<Term> van_der_waals;
  std::vector<Term> electrostatics;
};

ExtractedParameters extract_parameters(RDKit::ROMol &mol, Variant variant);

}  // namespace burrete::mmff
