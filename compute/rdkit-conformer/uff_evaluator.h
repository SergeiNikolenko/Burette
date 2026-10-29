// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT
#pragma once

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

namespace RDKit { class RWMol; }
namespace ForceFields { class ForceField; }

namespace burette::uff {
inline constexpr unsigned int kAbiVersion = 1;
inline constexpr std::size_t kMaximumAtoms = 1024;
inline constexpr std::size_t kMaximumMolBlockBytes = 2 * 1024 * 1024;
inline constexpr double kMaximumCoordinate = 1e6;

struct Evaluation {
  double energy;
  std::vector<double> gradient;
};

// The force field points into the molecule's conformer. Keep both alive and
// destroy the field first. No hydrogens are added or removed at this boundary.
class Evaluator {
 public:
  explicit Evaluator(const std::string &molblock);
  ~Evaluator();
  Evaluator(const Evaluator &) = delete;
  Evaluator &operator=(const Evaluator &) = delete;
  unsigned int atom_count() const;
  Evaluation evaluate(std::vector<double> coordinates);

 private:
  std::unique_ptr<RDKit::RWMol> molecule_;
  std::unique_ptr<ForceFields::ForceField> field_;
};
}  // namespace burette::uff
