// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT

#include "mmff_binary.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>

namespace burette::mmff {
namespace {

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

void append_float(std::vector<std::uint8_t> &bytes, float value) {
  std::uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  append_u32(bytes, bits);
}

void align_to(std::vector<std::uint8_t> &bytes, std::size_t alignment) {
  while (bytes.size() % alignment != 0) {
    bytes.push_back(0);
  }
}

std::uint32_t checked_count(std::size_t count, const char *label) {
  if (count > std::numeric_limits<std::uint32_t>::max()) {
    throw std::runtime_error(std::string(label) + " exceeds uint32");
  }
  return static_cast<std::uint32_t>(count);
}

void validate_terms(const std::vector<Term> &terms, std::uint32_t atom_count,
                    const char *label) {
  for (const auto &term : terms) {
    if (std::any_of(term.atoms.begin(), term.atoms.end(),
                    [atom_count](auto atom) { return atom >= atom_count; }) ||
        std::any_of(term.parameters0.begin(), term.parameters0.end(),
                    [](float value) { return !std::isfinite(value); }) ||
        std::any_of(term.parameters1.begin(), term.parameters1.end(),
                    [](float value) { return !std::isfinite(value); })) {
      throw std::runtime_error(std::string(label) +
                               " contains invalid MMFF data");
    }
  }
}

void append_terms(std::vector<std::uint8_t> &bytes,
                  const std::vector<Term> &terms) {
  align_to(bytes, 16);
  for (const auto &term : terms) {
    for (const auto atom : term.atoms) append_u32(bytes, atom);
    for (const auto value : term.parameters0) append_float(bytes, value);
    for (const auto value : term.parameters1) append_float(bytes, value);
  }
}

}  // namespace

std::vector<std::uint8_t> encode_binary(const ExtractedParameters &p,
                                        Variant variant) {
  if (p.atom_count == 0 || p.partial_charges.size() != p.atom_count ||
      static_cast<std::uint8_t>(variant) > 1) {
    throw std::runtime_error("MMFF extractor header values are invalid");
  }
  if (std::any_of(p.partial_charges.begin(), p.partial_charges.end(),
                  [](float value) { return !std::isfinite(value); })) {
    throw std::runtime_error("MMFF partial charges contain non-finite values");
  }
  const std::array<const std::vector<Term> *, 7> groups{
      &p.bonds,          &p.angles,          &p.stretch_bends,
      &p.out_of_planes,  &p.torsions,        &p.van_der_waals,
      &p.electrostatics};
  const std::array<const char *, 7> labels{
      "bonds",         "angles",          "stretch-bends",
      "out-of-planes", "torsions",        "van-der-Waals",
      "electrostatics"};
  std::array<std::uint32_t, 7> counts{};
  for (std::size_t index = 0; index < groups.size(); ++index) {
    counts[index] = checked_count(groups[index]->size(), labels[index]);
    validate_terms(*groups[index], p.atom_count, labels[index]);
  }

  std::vector<std::uint8_t> bytes;
  bytes.insert(bytes.end(), {'B', 'M', 'F', 'X'});
  append_u16(bytes, kBinaryAbiVersion);
  append_u16(bytes, kBinaryHeaderBytes);
  bytes.push_back(static_cast<std::uint8_t>(variant));
  bytes.insert(bytes.end(), 3, 0);
  append_u32(bytes, p.atom_count);
  for (const auto count : counts) append_u32(bytes, count);
  append_u32(bytes, 0);
  append_u32(bytes, 0);
  append_u32(bytes, 20250304);
  bytes.resize(kBinaryHeaderBytes, 0);
  for (const auto charge : p.partial_charges) append_float(bytes, charge);
  for (const auto *terms : groups) append_terms(bytes, *terms);
  if (bytes.size() > std::numeric_limits<std::uint32_t>::max()) {
    throw std::runtime_error("MMFF extractor output exceeds 4 GiB");
  }
  const auto total = static_cast<std::uint32_t>(bytes.size());
  overwrite_u32(bytes, 44, total - kBinaryHeaderBytes);
  overwrite_u32(bytes, 48, total);
  return bytes;
}

}  // namespace burette::mmff
