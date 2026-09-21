#include <metal_stdlib>

using namespace metal;

struct ConformerDistanceBatchV1 {
    uint atomCount;
    uint conformerCount;
    uint constraintCount;
    uint reserved;
};

kernel void burette_conformer_distance_v1(
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
        float termEnergy = 0.0f;
        float derivativeScale = 0.0f;
        const float weight = weights[term];
        if (distanceSquared > bounds.y) {
            const float normalized = distanceSquared / bounds.y - 1.0f;
            termEnergy = weight * normalized * normalized;
            derivativeScale = 4.0f * weight * normalized / bounds.y;
        } else if (distanceSquared < bounds.x) {
            const float denominator = bounds.x + distanceSquared;
            const float normalized = 2.0f * bounds.x / denominator - 1.0f;
            termEnergy = weight * normalized * normalized;
            derivativeScale = 8.0f * weight * bounds.x
                * (1.0f - 2.0f * bounds.x / denominator)
                / (denominator * denominator);
        }
        if (termEnergy == 0.0f) {
            continue;
        }
        // Each endpoint gathers the term. Split energy evenly so the host sum
        // is the exact objective while gradients remain endpoint-specific.
        energy += 0.5f * termEnergy;
        const float direction = isLeft ? 1.0f : -1.0f;
        gradient += (derivativeScale * direction) * delta;
    }
    atomEnergies[item] = energy;
    gradients[item] = gradient;
}
