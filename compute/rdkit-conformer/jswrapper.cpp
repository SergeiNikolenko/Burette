// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <memory>
#include <stdexcept>
#include <string>

#include <GraphMol/FileParsers/FileParsers.h>
#include <GraphMol/MolOps.h>
#include <GraphMol/RWMol.h>
#include <GraphMol/SmilesParse/SmilesParse.h>

#include "conformer_binary.h"
#include "mmff_binary.h"

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

}  // namespace

EMSCRIPTEN_BINDINGS(Burette_rdkit_conformer) {
  emscripten::function("extract_conformer_parameters",
                       &extract_conformer_parameters);
  emscripten::function("extract_mmff_parameters", &extract_mmff_parameters);
  emscripten::function("conformer_extractor_abi_version",
                       &conformer_extractor_abi_version);
  emscripten::function("mmff_extractor_abi_version",
                       &mmff_extractor_abi_version);
  emscripten::function("rdkit_source_revision", &rdkit_source_revision);
}
