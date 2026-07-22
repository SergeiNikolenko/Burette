#include <metal_stdlib>

using namespace metal;

// Adapted from the UMAP optimization flow in hanxiao/mlx-vis commit
// 06c8a75ad007820b35185937f83c03e09ab6bd5b (Apache-2.0). The
// implementation is native Metal and uses a race-free Jacobi update over a
// symmetric CSR graph rather than MLX scatter-add.
struct UmapEpochConfigV1 {
    ulong vertexCount;
    ulong edgeCount;
    ulong randomSeed;
    uint componentCount;
    uint negativeSampleRate;
    uint epoch;
    uint epochCount;
    float alpha;
    float curveA;
    float curveB;
    uint reserved;
};

inline ulong umap_mix_v1(ulong value) {
    value ^= value >> 30;
    value *= 0xbf58476d1ce4e5b9UL;
    value ^= value >> 27;
    value *= 0x94d049bb133111ebUL;
    return value ^ (value >> 31);
}

inline float umap_unit_v1(ulong value) {
    return static_cast<float>(umap_mix_v1(value) >> 40) *
        (1.0f / 16777216.0f);
}

kernel void burrete_umap_initialize_v1(
    device float4* positions [[buffer(0)]],
    constant UmapEpochConfigV1& config [[buffer(1)]],
    uint vertexIndex [[thread_position_in_grid]]
) {
    if (static_cast<ulong>(vertexIndex) >= config.vertexCount) {
        return;
    }
    const ulong base = config.randomSeed ^
        (static_cast<ulong>(vertexIndex) * 0x9e3779b97f4a7c15UL);
    const float x = (umap_unit_v1(base) * 2.0f - 1.0f) * 0.01f;
    const float y = (umap_unit_v1(base + 1UL) * 2.0f - 1.0f) * 0.01f;
    const float z = config.componentCount == 3
        ? (umap_unit_v1(base + 2UL) * 2.0f - 1.0f) * 0.01f
        : 0.0f;
    positions[vertexIndex] = float4(x, y, z, 0.0f);
}

kernel void burrete_umap_epoch_v1(
    device const float4* inputPositions [[buffer(0)]],
    device const ulong* rowOffsets [[buffer(1)]],
    device const uint* columnIndices [[buffer(2)]],
    device const float* weights [[buffer(3)]],
    device float4* outputPositions [[buffer(4)]],
    constant UmapEpochConfigV1& config [[buffer(5)]],
    uint vertexIndex [[thread_position_in_grid]]
) {
    if (static_cast<ulong>(vertexIndex) >= config.vertexCount) {
        return;
    }
    const float3 source = inputPositions[vertexIndex].xyz;
    float3 delta = float3(0.0f);
    const ulong start = rowOffsets[vertexIndex];
    const ulong end = rowOffsets[vertexIndex + 1];
    if (start > end || end > config.edgeCount) {
        outputPositions[vertexIndex] = inputPositions[vertexIndex];
        return;
    }

    for (ulong edge = start; edge < end; ++edge) {
        const float weight = clamp(weights[edge], 0.0f, 1.0f);
        const float previousSamples = floor(static_cast<float>(config.epoch) * weight);
        const float currentSamples = floor(static_cast<float>(config.epoch + 1) * weight);
        if (currentSamples <= previousSamples) {
            continue;
        }

        const uint targetIndex = columnIndices[edge];
        if (static_cast<ulong>(targetIndex) >= config.vertexCount || targetIndex == vertexIndex) {
            continue;
        }
        float3 difference = source - inputPositions[targetIndex].xyz;
        if (config.componentCount == 2) {
            difference.z = 0.0f;
        }
        const float distanceSquared = max(dot(difference, difference), 1e-6f);
        const float distancePower = powr(distanceSquared, config.curveB);
        const float coefficient =
            -2.0f * config.curveA * config.curveB *
            powr(distanceSquared, config.curveB - 1.0f) /
            (1.0f + config.curveA * distancePower);
        delta += clamp(coefficient * difference, -4.0f, 4.0f) * config.alpha;

        for (uint sample = 0; sample < config.negativeSampleRate; ++sample) {
            const ulong randomValue = config.randomSeed ^
                (static_cast<ulong>(config.epoch) << 48) ^
                (static_cast<ulong>(vertexIndex) << 24) ^
                (edge * 0x9e3779b97f4a7c15UL) ^ static_cast<ulong>(sample);
            const uint negativeIndex = static_cast<uint>(
                umap_mix_v1(randomValue) % config.vertexCount
            );
            if (negativeIndex == vertexIndex) {
                continue;
            }
            float3 negativeDifference = source - inputPositions[negativeIndex].xyz;
            if (config.componentCount == 2) {
                negativeDifference.z = 0.0f;
            }
            const float negativeDistanceSquared =
                max(dot(negativeDifference, negativeDifference), 1e-6f);
            const float negativePower =
                powr(negativeDistanceSquared, config.curveB);
            const float negativeCoefficient =
                2.0f * config.curveB /
                ((0.001f + negativeDistanceSquared) *
                 (1.0f + config.curveA * negativePower));
            delta += clamp(
                negativeCoefficient * negativeDifference,
                -4.0f,
                4.0f
            ) * config.alpha;
        }
    }

    float3 updated = source + delta;
    if (config.componentCount == 2) {
        updated.z = 0.0f;
    }
    outputPositions[vertexIndex] = float4(updated, 0.0f);
}
