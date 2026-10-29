// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT
#include "uff_evaluator.h"

#include <cmath>
#include <stdexcept>
#include <ForceField/ForceField.h>
#include <GraphMol/Conformer.h>
#include <GraphMol/FileParsers/FileParsers.h>
#include <GraphMol/ForceFieldHelpers/UFF/AtomTyper.h>
#include <GraphMol/ForceFieldHelpers/UFF/Builder.h>
#include <GraphMol/RWMol.h>

namespace burette::uff {
namespace {
constexpr unsigned int kMaximumContexts = 8;
unsigned int active_contexts = 0;

void validate_coordinate(double coordinate) {
  if (!std::isfinite(coordinate) || std::abs(coordinate) > kMaximumCoordinate) {
    throw std::invalid_argument("UFF coordinates must be finite and within 1000000 angstrom");
  }
}
}  // namespace

Evaluator::Evaluator(const std::string &molblock) {
  if (active_contexts >= kMaximumContexts) {
    throw std::invalid_argument("UFF allows at most 8 living contexts per worker");
  }
  if (molblock.empty() || molblock.size() > kMaximumMolBlockBytes) {
    throw std::invalid_argument("UFF MOL block must contain at most 2 MiB");
  }
  molecule_.reset(RDKit::MolBlockToMol(molblock, true, false, true));
  if (!molecule_ || molecule_->getNumAtoms() == 0 ||
      molecule_->getNumAtoms() > kMaximumAtoms ||
      molecule_->getNumConformers() != 1) {
    throw std::invalid_argument("UFF requires one MOL conformer with 1 to 1024 atoms");
  }
  for (const auto &position : molecule_->getConformer().getPositions()) {
    validate_coordinate(position.x);
    validate_coordinate(position.y);
    validate_coordinate(position.z);
  }
  const auto typed = RDKit::UFF::getAtomTypes(*molecule_);
  if (!typed.second) {
    throw std::invalid_argument("UFF parameters are unavailable for one or more atoms");
  }
  // Frozen ABI v1 policy: the nonbonded term list uses initial coordinates;
  // separate fragments do not interact. This field is reused for this job.
  constexpr double kVdwThreshold = 100.0;
  constexpr bool kIgnoreInterfragmentInteractions = true;
  field_.reset(RDKit::UFF::constructForceField(
      *molecule_, typed.first, kVdwThreshold, -1,
      kIgnoreInterfragmentInteractions));
  if (!field_) {
    throw std::runtime_error("RDKit could not construct the UFF force field");
  }
  field_->initialize();
  ++active_contexts;
}

Evaluator::~Evaluator() { --active_contexts; }

unsigned int Evaluator::atom_count() const { return molecule_->getNumAtoms(); }

Evaluation Evaluator::evaluate(std::vector<double> coordinates) {
  if (coordinates.size() != 3 * atom_count()) {
    throw std::invalid_argument("UFF coordinates must contain exactly 3 values per atom");
  }
  for (const auto coordinate : coordinates) validate_coordinate(coordinate);
  Evaluation result{field_->calcEnergy(coordinates.data()),
                    std::vector<double>(coordinates.size(), 0.0)};
  field_->calcGrad(coordinates.data(), result.gradient.data());
  if (!std::isfinite(result.energy)) {
    throw std::runtime_error("UFF energy is non-finite at these coordinates");
  }
  for (const auto value : result.gradient) {
    if (!std::isfinite(value)) {
      throw std::runtime_error("UFF gradient is non-finite at these coordinates");
    }
  }
  return result;
}
}  // namespace burette::uff
