// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <memory>
#include <cmath>
#include <stdexcept>
#include <string>

#include <GraphMol/FileParsers/FileParsers.h>
#include <GraphMol/MolOps.h>
#include <GraphMol/RWMol.h>
#include <GraphMol/PartialCharges/GasteigerCharges.h>
#include <GraphMol/SmilesParse/SmilesParse.h>

#include "conformer_binary.h"
#include "mmff_binary.h"
#include "uff_evaluator.h"

namespace {

burette::conformer::Variant parse_variant(unsigned int raw) {
  if (raw > static_cast<unsigned int>(burette::conformer::Variant::SrETKDGv3)) {
    throw std::invalid_argument("conformer variant is outside ABI v1");
  }
  return static_cast<burette::conformer::Variant>(raw);
}

burette::mmff::Variant parse_mmff_variant(unsigned int raw) {
  if (raw > static_cast<unsigned int>(burette::mmff::Variant::MMFF94s)) {
    throw std::invalid_argument("MMFF variant is outside ABI v1");
  }
  return static_cast<burette::mmff::Variant>(raw);
}

std::unique_ptr<RDKit::RWMol> parse_molecule(const std::string &input,
                                            unsigned int input_format) {
  std::unique_ptr<RDKit::RWMol> molecule;
  if (input_format == 0) {
    molecule.reset(RDKit::MolBlockToMol(input, true, false, true));
  } else if (input_format == 1) {
    molecule.reset(RDKit::SmilesToMol(input, 0, true));
    if (molecule) {
      RDKit::MolOps::addHs(*molecule, false, false);
    }
  } else {
    throw std::invalid_argument("conformer input format is outside ABI v1");
  }
  if (!molecule) {
    throw std::invalid_argument("RDKit could not parse the conformer input");
  }
  return molecule;
}

emscripten::val extract_conformer_parameters(const std::string &input,
                                             unsigned int input_format,
                                             unsigned int raw_variant) {
  auto molecule = parse_molecule(input, input_format);
  const auto variant = parse_variant(raw_variant);
  const auto parameters =
      burette::conformer::extract_parameters(*molecule, variant);
  const auto bytes = burette::conformer::encode_binary(parameters, variant);
  auto result = emscripten::val::global("Uint8Array").new_(bytes.size());
  if (!bytes.empty()) {
    const auto view = emscripten::val(emscripten::typed_memory_view(
        bytes.size(), reinterpret_cast<const unsigned char *>(bytes.data())));
    result.call<void>("set", view);
  }
  return result;
}

emscripten::val extract_mmff_parameters(const std::string &input,
                                        unsigned int input_format,
                                        unsigned int raw_variant) {
  auto molecule = parse_molecule(input, input_format);
  const auto variant = parse_mmff_variant(raw_variant);
  const auto parameters = burette::mmff::extract_parameters(*molecule, variant);
  const auto bytes = burette::mmff::encode_binary(parameters, variant);
  auto result = emscripten::val::global("Uint8Array").new_(bytes.size());
  if (!bytes.empty()) {
    const auto view = emscripten::val(emscripten::typed_memory_view(
        bytes.size(), reinterpret_cast<const unsigned char *>(bytes.data())));
    result.call<void>("set", view);
  }
  return result;
}

std::string rdkit_source_revision() {
  return "Release_2025_03_4@276b5a662302c6a548ac4f1363c066f3258e3a20";
}

unsigned int conformer_extractor_abi_version() {
  return burette::conformer::kBinaryAbiVersion;
}

unsigned int mmff_extractor_abi_version() {
  return burette::mmff::kBinaryAbiVersion;
}

emscripten::val create_uff_evaluator(const std::string &molblock) {
  auto result = emscripten::val::object();
  try {
    result.set("context", std::make_shared<burette::uff::Evaluator>(molblock));
  } catch (const std::exception &error) {
    result.set("error", std::string(error.what()).substr(0, 2048));
  }
  return result;
}

emscripten::val evaluate_uff(burette::uff::Evaluator &context,
                             const emscripten::val &input) {
  auto result = emscripten::val::object();
  try {
    const auto length = input["length"].as<unsigned int>();
    if (length != 3 * context.atom_count()) {
      throw std::invalid_argument("UFF coordinates must contain exactly 3 values per atom");
    }
    std::vector<double> coordinates(length);
    for (unsigned int i = 0; i < length; ++i) coordinates[i] = input[i].as<double>();
    const auto evaluation = context.evaluate(std::move(coordinates));
    result.set("energyKcalMol", evaluation.energy);
    auto gradient = emscripten::val::global("Float64Array").new_(length);
    gradient.call<void>("set", emscripten::val(emscripten::typed_memory_view(
        evaluation.gradient.size(), evaluation.gradient.data())));
    result.set("gradient", gradient);
  } catch (const std::exception &error) {
    result.set("error", std::string(error.what()).substr(0, 2048));
  }
  return result;
}

emscripten::val compute_gasteiger_charges(const std::string &molblock) {
  auto result = emscripten::val::object();
  try {
    if (molblock.empty() || molblock.size() > burette::uff::kMaximumMolBlockBytes) {
      throw std::invalid_argument("Gasteiger MOL block must contain at most 2 MiB");
    }
    auto molecule = parse_molecule(molblock, 0);
    if (molecule->getNumAtoms() == 0 || molecule->getNumAtoms() > burette::uff::kMaximumAtoms) {
      throw std::invalid_argument("Gasteiger requires 1 to 1024 atoms");
    }
    std::vector<double> charges(molecule->getNumAtoms(), 0.0);
    RDKit::computeGasteigerCharges(*molecule, charges, 12, true);
    for (const auto charge : charges) {
      if (!std::isfinite(charge)) throw std::runtime_error("Gasteiger charge is non-finite");
    }
    auto values = emscripten::val::global("Float64Array").new_(charges.size());
    values.call<void>("set", emscripten::val(emscripten::typed_memory_view(charges.size(), charges.data())));
    result.set("charges", values);
  } catch (const std::exception &error) {
    result.set("error", std::string(error.what()).substr(0, 2048));
  }
  return result;
}

}  // namespace

EMSCRIPTEN_BINDINGS(Burette_rdkit_conformer) {
  emscripten::class_<burette::uff::Evaluator>("UffEvaluator")
      .smart_ptr<std::shared_ptr<burette::uff::Evaluator>>("UffEvaluatorPtr")
      .function("atom_count", &burette::uff::Evaluator::atom_count)
      .function("evaluate", &evaluate_uff);
  emscripten::function("create_uff_evaluator", &create_uff_evaluator);
  emscripten::function("compute_gasteiger_charges", &compute_gasteiger_charges);
  emscripten::function("uff_evaluator_abi_version", +[]() {
    return burette::uff::kAbiVersion;
  });
  emscripten::function("extract_conformer_parameters",
                       &extract_conformer_parameters);
  emscripten::function("extract_mmff_parameters", &extract_mmff_parameters);
  emscripten::function("conformer_extractor_abi_version",
                       &conformer_extractor_abi_version);
  emscripten::function("mmff_extractor_abi_version",
                       &mmff_extractor_abi_version);
  emscripten::function("rdkit_source_revision", &rdkit_source_revision);
}
