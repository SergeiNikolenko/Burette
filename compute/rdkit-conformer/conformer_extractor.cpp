// Copyright 2026 Burrete contributors.
// SPDX-License-Identifier: MIT
//
// This adapter calls pinned RDKit APIs and independently materializes Burrete's
// conformer.engine-pack.v1 arrays. No mlxmolkit source text is included.

#include "conformer_extractor.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <map>
#include <stdexcept>
#include <tuple>
#include <utility>
#include <vector>

#include <DistGeom/BoundsMatrix.h>
#include <DistGeom/ChiralSet.h>
#include <GraphMol/Atom.h>
#include <GraphMol/Bond.h>
#include <GraphMol/DistGeomHelpers/Embedder.h>
#include <GraphMol/ForceFieldHelpers/CrystalFF/TorsionPreferences.h>
#include <GraphMol/MolOps.h>
#include <GraphMol/ROMol.h>

namespace RDKit::DGeomHelpers::EmbeddingOps {
// These functions are linked from the pinned Embedder.cpp. They are deliberately
// isolated here because RDKit 2025.03.4 does not publish them in Embedder.h.
void initETKDG(ROMol *mol, const EmbedParameters &params,
               ForceFields::CrystalFF::CrystalFFDetails &details);
bool setupInitialBoundsMatrix(
    ROMol *mol, DistGeom::BoundsMatPtr bounds,
    const std::map<int, RDGeom::Point3D> *coordinate_map,
    const EmbedParameters &params,
    ForceFields::CrystalFF::CrystalFFDetails &details);
void findChiralSets(const ROMol &mol, DistGeom::VECT_CHIRALSET &chiral,
                    DistGeom::VECT_CHIRALSET &tetrahedral,
                    const std::map<int, RDGeom::Point3D> *coordinate_map);
}  // namespace RDKit::DGeomHelpers::EmbeddingOps

namespace burrete::conformer {
namespace {

constexpr float kImproperWeight = 10.0F;
constexpr float kKnownDistanceWeight = 100.0F;
constexpr float kKnownDistanceTolerance = 0.01F;
constexpr float kLongRangeWeight = 10.0F;

const RDKit::DGeomHelpers::EmbedParameters &parameters_for(Variant variant) {
  using namespace RDKit::DGeomHelpers;
  static const EmbedParameters dg;
  switch (variant) {
    case Variant::DG:
      return dg;
    case Variant::KDG:
      return KDG;
    case Variant::ETDG:
      return ETDG;
    case Variant::ETDGv2:
      return ETDGv2;
    case Variant::ETKDG:
      return ETKDG;
    case Variant::ETKDGv2:
      return ETKDGv2;
    case Variant::ETKDGv3:
      return ETKDGv3;
    case Variant::SrETKDGv3:
      return srETKDGv3;
  }
  throw std::invalid_argument("unsupported conformer variant");
}

std::uint32_t checked_atom_index(int index, std::size_t atom_count) {
  if (index < 0 || static_cast<std::size_t>(index) >= atom_count) {
    throw std::runtime_error("RDKit returned an out-of-range atom index");
  }
  return static_cast<std::uint32_t>(index);
}

void append_pair(std::vector<std::uint32_t> &target, std::uint32_t left,
                 std::uint32_t right) {
  if (right < left) {
    std::swap(left, right);
  }
  target.push_back(left);
  target.push_back(right);
}

std::vector<std::vector<std::uint32_t>> topological_distances(
    const RDKit::ROMol &mol) {
  const auto atom_count = mol.getNumAtoms();
  std::vector<std::vector<std::uint32_t>> result(
      atom_count,
      std::vector<std::uint32_t>(atom_count,
                                 std::numeric_limits<std::uint32_t>::max()));
  for (unsigned int source = 0; source < atom_count; ++source) {
    std::vector<unsigned int> queue{source};
    result[source][source] = 0;
    for (std::size_t cursor = 0; cursor < queue.size(); ++cursor) {
      const auto current = queue[cursor];
      for (const auto neighbor : mol.atomNeighbors(mol.getAtomWithIdx(current))) {
        const auto next = neighbor->getIdx();
        if (result[source][next] != std::numeric_limits<std::uint32_t>::max()) {
          continue;
        }
        result[source][next] = result[source][current] + 1;
        queue.push_back(next);
      }
    }
  }
  return result;
}

void extract_distances(const DistGeom::BoundsMatrix &bounds,
                       ExtractedParameters &output) {
  const auto atom_count = bounds.numRows();
  for (unsigned int left = 0; left < atom_count; ++left) {
    for (unsigned int right = left + 1; right < atom_count; ++right) {
      const auto lower = bounds.getLowerBound(left, right);
      const auto upper = bounds.getUpperBound(left, right);
      if (!(lower > 0.0) || !(upper > 0.0) || upper - lower > 5.0) {
        continue;
      }
      append_pair(output.distance_atom_pairs, left, right);
      output.distance_bounds_squared.push_back(
          static_cast<float>(lower * lower));
      output.distance_bounds_squared.push_back(
          static_cast<float>(upper * upper));
      output.distance_weights.push_back(1.0F);
    }
  }
}

void extract_chirality(RDKit::ROMol &mol, ExtractedParameters &output) {
  DistGeom::VECT_CHIRALSET chiral;
  DistGeom::VECT_CHIRALSET tetrahedral;
  RDKit::DGeomHelpers::EmbeddingOps::findChiralSets(mol, chiral, tetrahedral,
                                                    nullptr);
  for (const auto &term : chiral) {
    output.chiral_atom_quads.insert(
        output.chiral_atom_quads.end(),
        {term->d_idx1, term->d_idx2, term->d_idx3, term->d_idx4});
    output.chiral_volume_bounds.push_back(
        static_cast<float>(term->getLowerVolumeBound()));
    output.chiral_volume_bounds.push_back(
        static_cast<float>(term->getUpperVolumeBound()));
  }
  chiral.insert(chiral.end(), tetrahedral.begin(), tetrahedral.end());
  for (const auto &term : chiral) {
    output.stereo_atom_quints.insert(
        output.stereo_atom_quints.end(),
        {term->d_idx0, term->d_idx1, term->d_idx2, term->d_idx3, term->d_idx4});
    const auto fused = static_cast<std::uint64_t>(
        DistGeom::ChiralSetStructureFlags::IN_FUSED_SMALL_RINGS);
    output.stereo_flags.push_back(
        static_cast<std::uint8_t>((term->d_structureFlags & fused) != 0));
  }
}

void extract_torsions(
    const ForceFields::CrystalFF::CrystalFFDetails &details,
    std::size_t atom_count, ExtractedParameters &output) {
  if (details.expTorsionAtoms.size() != details.expTorsionAngles.size()) {
    throw std::runtime_error("RDKit returned inconsistent torsion arrays");
  }
  for (std::size_t term = 0; term < details.expTorsionAtoms.size(); ++term) {
    const auto &atoms = details.expTorsionAtoms[term];
    const auto &signs = details.expTorsionAngles[term].first;
    const auto &coefficients = details.expTorsionAngles[term].second;
    if (atoms.size() != 4 || signs.size() != 6 || coefficients.size() != 6) {
      throw std::runtime_error("RDKit returned a non-canonical torsion term");
    }
    for (const auto atom : atoms) {
      output.torsion_atom_quads.push_back(
          checked_atom_index(atom, atom_count));
    }
    for (std::size_t harmonic = 0; harmonic < 6; ++harmonic) {
      if (signs[harmonic] < -1 || signs[harmonic] > 1) {
        throw std::runtime_error("RDKit returned an unsupported torsion sign");
      }
      output.torsion_coefficients.push_back(
          static_cast<float>(coefficients[harmonic]));
      output.torsion_signs.push_back(
          static_cast<std::int8_t>(signs[harmonic]));
    }
  }
}

void extract_impropers(
    const ForceFields::CrystalFF::CrystalFFDetails &details,
    std::size_t atom_count, ExtractedParameters &output) {
  constexpr std::array<std::array<std::size_t, 4>, 3> permutations{{
      {{0, 1, 2, 3}}, {{0, 1, 3, 2}}, {{2, 1, 3, 0}}}};
  for (const auto &term : details.improperAtoms) {
    if (term.size() != 6) {
      throw std::runtime_error("RDKit returned a non-canonical improper term");
    }
    const float weight = term[4] == 6 && term[5] != 0
                             ? kImproperWeight * (50.0F / 6.0F)
                             : kImproperWeight;
    for (const auto &order : permutations) {
      for (const auto index : order) {
        output.improper_atom_quads.push_back(
            checked_atom_index(term[index], atom_count));
      }
      output.improper_weights.push_back(weight);
    }
  }
}

void extract_etk_distances(const RDKit::ROMol &mol,
                           const RDKit::DGeomHelpers::EmbedParameters &params,
                           const DistGeom::BoundsMatrix &bounds,
                           ExtractedParameters &output) {
  const auto topology = topological_distances(mol);
  const auto atom_count = mol.getNumAtoms();
  for (unsigned int left = 0; left < atom_count; ++left) {
    for (unsigned int right = left + 1; right < atom_count; ++right) {
      const auto kind = topology[left][right];
      const bool known = params.useBasicKnowledge && (kind == 1 || kind == 2);
      const bool torsional = kind == 3;
      const bool long_range =
          params.useBasicKnowledge && kind >= 4 &&
          kind != std::numeric_limits<std::uint32_t>::max();
      if (!known && !torsional && !long_range) {
        continue;
      }
      const auto lower = bounds.getLowerBound(left, right);
      const auto upper = bounds.getUpperBound(left, right);
      if (!(lower > 0.0) || !(upper > 0.0)) {
        continue;
      }
      append_pair(output.etk_distance_atom_pairs, left, right);
      if (known) {
        const auto midpoint = static_cast<float>((lower + upper) * 0.5);
        output.etk_distance_bounds.push_back(midpoint - kKnownDistanceTolerance);
        output.etk_distance_bounds.push_back(midpoint + kKnownDistanceTolerance);
        output.etk_distance_weights.push_back(kKnownDistanceWeight);
      } else {
        output.etk_distance_bounds.push_back(static_cast<float>(lower));
        output.etk_distance_bounds.push_back(static_cast<float>(upper));
        output.etk_distance_weights.push_back(torsional ? 1.0F : kLongRangeWeight);
      }
      output.etk_distance_kinds.push_back(static_cast<std::uint8_t>(
          std::min(kind, std::uint32_t{std::numeric_limits<std::uint8_t>::max()})));
    }
  }
}

}  // namespace

ExtractedParameters extract_parameters(RDKit::ROMol &mol, Variant variant) {
  if (mol.getNumAtoms() == 0) {
    throw std::invalid_argument("cannot extract conformer data from an empty molecule");
  }
  RDKit::MolOps::assignStereochemistry(mol, true, true, true);
  const auto &params = parameters_for(variant);
  ForceFields::CrystalFF::CrystalFFDetails details;
  RDKit::DGeomHelpers::EmbeddingOps::initETKDG(&mol, params, details);
  DistGeom::BoundsMatPtr bounds(new DistGeom::BoundsMatrix(mol.getNumAtoms()));
  if (!RDKit::DGeomHelpers::EmbeddingOps::setupInitialBoundsMatrix(
          &mol, bounds, nullptr, params, details)) {
    throw std::runtime_error("RDKit could not triangle-smooth the bounds matrix");
  }

  ExtractedParameters output;
  output.atomic_numbers.reserve(mol.getNumAtoms());
  output.formal_charges.reserve(mol.getNumAtoms());
  for (const auto atom : mol.atoms()) {
    const auto atomic_number = atom->getAtomicNum();
    const auto formal_charge = atom->getFormalCharge();
    if (atomic_number < 1 || atomic_number > 118 ||
        formal_charge < std::numeric_limits<std::int8_t>::min() ||
        formal_charge > std::numeric_limits<std::int8_t>::max()) {
      throw std::runtime_error("molecule atom data exceeds the extractor ABI");
    }
    output.atomic_numbers.push_back(static_cast<std::uint16_t>(atomic_number));
    output.formal_charges.push_back(static_cast<std::int8_t>(formal_charge));
  }

  extract_distances(*bounds, output);
  extract_chirality(mol, output);
  extract_torsions(details, mol.getNumAtoms(), output);
  extract_impropers(details, mol.getNumAtoms(), output);
  extract_etk_distances(mol, params, *bounds, output);
  return output;
}

}  // namespace burrete::conformer
