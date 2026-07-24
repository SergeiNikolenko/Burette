// Copyright 2026 Burette contributors.
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <vector>

#include "mmff_extractor.h"

namespace burette::mmff {

inline constexpr std::uint16_t kBinaryAbiVersion = 1;
inline constexpr std::uint16_t kBinaryHeaderBytes = 64;

std::vector<std::uint8_t> encode_binary(const ExtractedParameters &parameters,
                                        Variant variant);

}  // namespace burette::mmff
