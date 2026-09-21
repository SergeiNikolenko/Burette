// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT
// Independent adapter over pinned RDKit MMFF parameter APIs.

#include "mmff_extractor.h"

#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

#include <boost/shared_ptr.hpp>

#include <ForceField/MMFF/Params.h>
#include <GraphMol/Atom.h>
#include <GraphMol/Bond.h>
#include <GraphMol/ForceFieldHelpers/MMFF/AtomTyper.h>
#include <GraphMol/ForceFieldHelpers/MMFF/Builder.h>
#include <GraphMol/MolOps.h>
#include <GraphMol/ROMol.h>

namespace burette::mmff {
namespace {

using Properties = RDKit::MMFF::MMFFMolProperties;
using TermVector = std::vector<Term>;

float finite_float(double value, const char *label) {
  if (!std::isfinite(value) ||
      value < -static_cast<double>(std::numeric_limits<float>::max()) ||
      value > static_cast<double>(std::numeric_limits<float>::max())) {
    throw std::runtime_error(std::string("RDKit returned invalid ") + label);
  }
  return static_cast<float>(value);
}

Term term(std::array<std::uint32_t, 4> atoms,
          std::array<float, 4> parameters0,
          std::array<float, 4> parameters1 = {}) {
  return Term{atoms, parameters0, parameters1};
}

void extract_bonds(const RDKit::ROMol &mol, Properties &properties,
                   TermVector &output) {
  for (const auto bond : mol.bonds()) {
    unsigned int bond_type = 0;
    ForceFields::MMFF::MMFFBond parameters;
    const auto left = bond->getBeginAtomIdx();
    const auto right = bond->getEndAtomIdx();
    if (properties.getMMFFBondStretchParams(mol, left, right, bond_type,
                                            parameters)) {
      output.push_back(term({left, right, 0, 0},
                            {finite_float(parameters.kb, "MMFF bond force"),
                             finite_float(parameters.r0, "MMFF bond length"),
                             0, 0}));
    }
  }
}

void extract_angles_and_stretch_bends(const RDKit::ROMol &mol,
                                      Properties &properties,
                                      ExtractedParameters &output) {
  const auto *property_table = RDKit::MMFF::DefaultParameters::getMMFFProp();
  for (std::uint32_t center = 0; center < mol.getNumAtoms(); ++center) {
    const auto *atom = mol.getAtomWithIdx(center);
    if (atom->getDegree() < 2) continue;
    std::vector<std::uint32_t> neighbors;
    for (const auto neighbor : mol.atomNeighbors(atom)) {
      neighbors.push_back(neighbor->getIdx());
    }
    const auto *central = (*property_table)(properties.getMMFFAtomType(center));
    if (!central) throw std::runtime_error("RDKit MMFF atom type is missing");
    for (std::size_t first = 0; first < neighbors.size(); ++first) {
      for (std::size_t second = first + 1; second < neighbors.size(); ++second) {
        const auto left = neighbors[first];
        const auto right = neighbors[second];
        unsigned int angle_type = 0;
        ForceFields::MMFF::MMFFAngle angle;
        if (properties.getMMFFAngleBendParams(mol, left, center, right,
                                              angle_type, angle)) {
          output.angles.push_back(term(
              {left, center, right, 0},
              {finite_float(angle.ka, "MMFF angle force"),
               finite_float(angle.theta0, "MMFF equilibrium angle"),
               central->linh ? 1.0F : 0.0F, 0}));
        }
        if (central->linh) continue;
        unsigned int stretch_type = 0;
        ForceFields::MMFF::MMFFStbn stretch;
        ForceFields::MMFF::MMFFBond bonds[2];
        ForceFields::MMFF::MMFFAngle stretch_angle;
        if (properties.getMMFFStretchBendParams(
                mol, left, center, right, stretch_type, stretch, bonds,
                stretch_angle)) {
          output.stretch_bends.push_back(term(
              {left, center, right, 0},
              {finite_float(stretch.kbaIJK, "MMFF stretch-bend force"),
               finite_float(stretch.kbaKJI, "MMFF stretch-bend force"),
               finite_float(bonds[0].r0, "MMFF stretch-bend bond length"),
               finite_float(bonds[1].r0, "MMFF stretch-bend bond length")},
              {finite_float(stretch_angle.theta0,
                            "MMFF stretch-bend angle"),
               0, 0, 0}));
        }
      }
    }
  }
}

void extract_out_of_planes(const RDKit::ROMol &mol, Properties &properties,
                           TermVector &output) {
  constexpr std::array<std::array<unsigned int, 3>, 3> permutations{{
      {{0, 1, 2}}, {{0, 2, 1}}, {{1, 2, 0}}}};
  for (std::uint32_t center = 0; center < mol.getNumAtoms(); ++center) {
    const auto *atom = mol.getAtomWithIdx(center);
    if (atom->getDegree() != 3) continue;
    std::array<std::uint32_t, 3> neighbors{};
    std::size_t index = 0;
    for (const auto neighbor : mol.atomNeighbors(atom)) {
      neighbors[index++] = neighbor->getIdx();
    }
    ForceFields::MMFF::MMFFOop parameters;
    if (!properties.getMMFFOopBendParams(mol, neighbors[0], center,
                                         neighbors[1], neighbors[2],
                                         parameters)) {
      continue;
    }
    for (const auto order : permutations) {
      output.push_back(term(
          {neighbors[order[0]], center, neighbors[order[1]],
           neighbors[order[2]]},
          {finite_float(parameters.koop, "MMFF out-of-plane force"), 0, 0,
           0}));
    }
  }
}

void extract_torsions(const RDKit::ROMol &mol, Properties &properties,
                      TermVector &output) {
  for (const auto *center_bond : mol.bonds()) {
    const auto second = center_bond->getBeginAtomIdx();
    const auto third = center_bond->getEndAtomIdx();
    const auto *second_atom = mol.getAtomWithIdx(second);
    const auto *third_atom = mol.getAtomWithIdx(third);
    const auto supported_center = [](const RDKit::Atom *atom) {
      return atom->getHybridization() == RDKit::Atom::SP2 ||
             atom->getHybridization() == RDKit::Atom::SP3;
    };
    if (!supported_center(second_atom) || !supported_center(third_atom) ||
        second_atom->getDegree() < 2 || third_atom->getDegree() < 2) {
      continue;
    }
    for (const auto first_bond : mol.atomBonds(second_atom)) {
      if (first_bond == center_bond) continue;
      const auto first = first_bond->getOtherAtomIdx(second);
      for (const auto fourth_bond : mol.atomBonds(third_atom)) {
        if (fourth_bond == center_bond || fourth_bond == first_bond) continue;
        const auto fourth = fourth_bond->getOtherAtomIdx(third);
        if (first == fourth) continue;
        unsigned int torsion_type = 0;
        ForceFields::MMFF::MMFFTor parameters;
        if (properties.getMMFFTorsionParams(mol, first, second, third, fourth,
                                            torsion_type, parameters)) {
          output.push_back(term(
              {first, second, third, fourth},
              {finite_float(parameters.V1, "MMFF torsion V1"),
               finite_float(parameters.V2, "MMFF torsion V2"),
               finite_float(parameters.V3, "MMFF torsion V3"), 0}));
        }
      }
    }
  }
}

void extract_nonbonded(const RDKit::ROMol &mol, Properties &properties,
                       ExtractedParameters &output) {
  auto relationships = RDKit::MMFF::Tools::buildNeighborMatrix(mol);
  RDKit::INT_VECT fragment_map;
  RDKit::MolOps::getMolFrags(mol, true, &fragment_map);
  for (std::uint32_t left = 0; left < mol.getNumAtoms(); ++left) {
    for (std::uint32_t right = left + 1; right < mol.getNumAtoms(); ++right) {
      if (fragment_map[left] != fragment_map[right]) continue;
      const auto relationship = RDKit::MMFF::Tools::getTwoBitCell(
          relationships,
          RDKit::MMFF::Tools::twoBitCellPos(mol.getNumAtoms(), left, right));
      if (relationship < RDKit::MMFF::Tools::RELATION_1_4) continue;
      ForceFields::MMFF::MMFFVdWRijstarEps vdw;
      if (properties.getMMFFVdWParams(left, right, vdw)) {
        output.van_der_waals.push_back(term(
            {left, right, 0, 0},
            {finite_float(vdw.R_ij_star, "MMFF van-der-Waals radius"),
             finite_float(vdw.epsilon, "MMFF van-der-Waals epsilon"), 0,
             0}));
      }
      const auto charge_product = properties.getMMFFPartialCharge(left) *
                                  properties.getMMFFPartialCharge(right) /
                                  properties.getMMFFDielectricConstant();
      if (std::abs(charge_product) > 1.0e-10) {
        output.electrostatics.push_back(term(
            {left, right, 0, 0},
            {finite_float(charge_product, "MMFF charge product"),
             relationship == RDKit::MMFF::Tools::RELATION_1_4 ? 1.0F : 0.0F,
             0, 0}));
      }
    }
  }
}

}  // namespace

ExtractedParameters extract_parameters(RDKit::ROMol &mol, Variant variant) {
  if (mol.getNumAtoms() == 0) {
    throw std::invalid_argument("cannot extract MMFF data from an empty molecule");
  }
  Properties properties(mol,
                        variant == Variant::MMFF94 ? "MMFF94" : "MMFF94s");
  if (!properties.isValid()) {
    throw std::invalid_argument("RDKit cannot assign MMFF atom types");
  }
  ExtractedParameters output;
  output.atom_count = mol.getNumAtoms();
  output.partial_charges.reserve(output.atom_count);
  for (std::uint32_t atom = 0; atom < output.atom_count; ++atom) {
    output.partial_charges.push_back(
        finite_float(properties.getMMFFPartialCharge(atom),
                     "MMFF partial charge"));
  }
  extract_bonds(mol, properties, output.bonds);
  extract_angles_and_stretch_bends(mol, properties, output);
  extract_out_of_planes(mol, properties, output.out_of_planes);
  extract_torsions(mol, properties, output.torsions);
  extract_nonbonded(mol, properties, output);
  return output;
}

}  // namespace burette::mmff
