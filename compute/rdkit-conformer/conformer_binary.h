// Copyright 2026 Burrete contributors.
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <vector>

#include "conformer_extractor.h"

namespace burrete::conformer {

inline constexpr std::uint16_t kBinaryAbiVersion = 1;
inline constexpr std::uint16_t kBinaryHeaderBytes = 64;

std::vector<std::uint8_t> encode_binary(const ExtractedParameters &parameters,
                                        Variant variant);

}  // namespace burrete::conformer
