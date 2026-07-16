#include <metal_stdlib>

using namespace metal;

struct ConformerDistanceBatchV1 {
    uint atomCount;
    uint conformerCount;
    uint constraintCount;
    uint reserved;
};

kernel void burrete_conformer_distance_v1(
    device const float4* positions [[buffer(0)]],
    device const uint2* atomPairs [[buffer(1)]],
    device const float2* boundsSquared [[buffer(2)]],
    device const float* weights [[buffer(3)]],
    constant ConformerDistanceBatchV1& batch [[buffer(4)]],
    device float* atomEnergies [[buffer(5)]],
    device float4* gradients [[buffer(6)]],
    uint item [[thread_position_in_grid]]
) {
    const ulong itemCount = static_cast<ulong>(batch.atomCount) * batch.conformerCount;
    if (static_cast<ulong>(item) >= itemCount || batch.atomCount == 0) {
        return;
    }
    const uint conformer = item / batch.atomCount;
    const uint atom = item - conformer * batch.atomCount;
    const ulong base = static_cast<ulong>(conformer) * batch.atomCount;
    float energy = 0.0f;
    float4 gradient = float4(0.0f);

    for (uint term = 0; term < batch.constraintCount; ++term) {
        const uint2 pair = atomPairs[term];
        const bool isLeft = pair.x == atom;
        const bool isRight = pair.y == atom;
        if (!isLeft && !isRight) {
            continue;
        }
        const float4 delta = positions[base + pair.x] - positions[base + pair.y];
        const float distanceSquared = dot(delta, delta);
        const float2 bounds = boundsSquared[term];
        float violation = 0.0f;
        if (distanceSquared < bounds.x) {
            violation = distanceSquared - bounds.x;
        } else if (distanceSquared > bounds.y) {
            violation = distanceSquared - bounds.y;
        }
        if (violation == 0.0f) {
            continue;
        }
        const float weight = weights[term];
        energy += 0.5f * weight * violation * violation;
        const float direction = isLeft ? 1.0f : -1.0f;
        gradient += (4.0f * weight * violation * direction) * delta;
    }
    atomEnergies[item] = energy;
    gradients[item] = gradient;
}
