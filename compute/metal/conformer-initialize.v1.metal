#include <metal_stdlib>

using namespace metal;

struct ConformerInitializeBatchV1 {
    uint atomCount;
    uint conformerCount;
    ulong outputAtomOffset;
};

inline uint burette_hash32_v1(uint value) {
    value ^= value >> 16;
    value *= 0x7feb352dU;
    value ^= value >> 15;
    value *= 0x846ca68bU;
    return value ^ (value >> 16);
}

inline float burette_unit_signed_v1(uint value) {
    return fma(static_cast<float>(value >> 8), 1.0f / 16777216.0f, 0.0f) * 2.0f - 1.0f;
}

kernel void burette_conformer_initialize_v1(
    device const uint4* seedWords [[buffer(0)]],
    constant ConformerInitializeBatchV1& batch [[buffer(1)]],
    device float4* positions [[buffer(2)]],
    uint item [[thread_position_in_grid]]
) {
    const ulong itemCount = static_cast<ulong>(batch.atomCount) * batch.conformerCount;
    if (static_cast<ulong>(item) >= itemCount || batch.atomCount == 0) {
        return;
    }
    const uint conformer = item / batch.atomCount;
    const uint atom = item - conformer * batch.atomCount;
    const uint4 seed = seedWords[conformer];
    uint4 counters = atom * 4U + uint4(0U, 1U, 2U, 3U);
    uint4 mixed = seed ^ counters * 0x9e3779b9U ^ uint4(0U, 1U, 2U, 3U) * 0x85ebca6bU;
    uint4 random = uint4(
        burette_hash32_v1(mixed.x),
        burette_hash32_v1(mixed.y),
        burette_hash32_v1(mixed.z),
        burette_hash32_v1(mixed.w)
    );
    positions[batch.outputAtomOffset + item] = float4(
        burette_unit_signed_v1(random.x),
        burette_unit_signed_v1(random.y),
        burette_unit_signed_v1(random.z),
        burette_unit_signed_v1(random.w)
    );
}
