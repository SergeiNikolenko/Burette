#include <metal_stdlib>

using namespace metal;

struct Pm6FockPairV1 {
    uint leftStart;
    uint leftCount;
    uint rightStart;
    uint rightCount;
    uint tensorStart;
    uint reserved;
};

kernel void burrete_pm6_pair_fock_v1(
    device const float* density [[buffer(0)]],
    device const Pm6FockPairV1* pairs [[buffer(1)]],
    device const float* repulsion [[buffer(2)]],
    constant uint& orbitalCount [[buffer(3)]],
    constant uint& pairCount [[buffer(4)]],
    device float* contribution [[buffer(5)]],
    uint index [[thread_position_in_grid]]
) {
    const uint matrixLength = orbitalCount * orbitalCount;
    if (index >= matrixLength) return;
    const uint row = index / orbitalCount;
    const uint column = index - row * orbitalCount;
    float value = 0.0f;
    for (uint pairIndex = 0; pairIndex < pairCount; ++pairIndex) {
        const Pm6FockPairV1 pair = pairs[pairIndex];
        const bool rowLeft = row >= pair.leftStart && row < pair.leftStart + pair.leftCount;
        const bool columnLeft = column >= pair.leftStart && column < pair.leftStart + pair.leftCount;
        const bool rowRight = row >= pair.rightStart && row < pair.rightStart + pair.rightCount;
        const bool columnRight = column >= pair.rightStart && column < pair.rightStart + pair.rightCount;
        if (rowLeft && columnLeft) {
            const uint a = row - pair.leftStart;
            const uint b = column - pair.leftStart;
            for (uint c = 0; c < pair.rightCount; ++c) {
                for (uint d = 0; d < pair.rightCount; ++d) {
                    const uint tensor = pair.tensorStart
                        + ((a * pair.leftCount + b) * pair.rightCount + c) * pair.rightCount + d;
                    value += density[(pair.rightStart + c) * orbitalCount + pair.rightStart + d]
                        * repulsion[tensor];
                }
            }
        } else if (rowRight && columnRight) {
            const uint c = row - pair.rightStart;
            const uint d = column - pair.rightStart;
            for (uint a = 0; a < pair.leftCount; ++a) {
                for (uint b = 0; b < pair.leftCount; ++b) {
                    const uint tensor = pair.tensorStart
                        + ((a * pair.leftCount + b) * pair.rightCount + c) * pair.rightCount + d;
                    value += density[(pair.leftStart + a) * orbitalCount + pair.leftStart + b]
                        * repulsion[tensor];
                }
            }
        } else if ((rowLeft && columnRight) || (rowRight && columnLeft)) {
            const uint a = rowLeft ? row - pair.leftStart : column - pair.leftStart;
            const uint c = rowRight ? row - pair.rightStart : column - pair.rightStart;
            for (uint b = 0; b < pair.leftCount; ++b) {
                for (uint d = 0; d < pair.rightCount; ++d) {
                    const uint tensor = pair.tensorStart
                        + ((a * pair.leftCount + b) * pair.rightCount + c) * pair.rightCount + d;
                    value -= 0.5f
                        * density[(pair.leftStart + b) * orbitalCount + pair.rightStart + d]
                        * repulsion[tensor];
                }
            }
        }
    }
    contribution[index] = value;
}
