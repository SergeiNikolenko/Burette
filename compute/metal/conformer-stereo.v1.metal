#include <metal_stdlib>

using namespace metal;

struct ConformerStereoBatchV1 {
    uint atomCount;
    uint conformerCount;
    uint chiralCount;
    uint tetrahedralCount;
};

constant uint kChiralFailure = 1u << 0;
constant uint kTetrahedralFailure = 1u << 1;
constant uint kNonfiniteFailure = 1u << 2;
constant float kTetrahedralVolumeTolerance = 0.3f;

inline float signed_volume(
    device const float4* positions,
    ulong base,
    uint4 atoms
) {
    const float3 first = positions[base + atoms.x].xyz;
    const float3 second = positions[base + atoms.y].xyz;
    const float3 third = positions[base + atoms.z].xyz;
    const float3 fourth = positions[base + atoms.w].xyz;
    return dot(first - fourth, cross(second - fourth, third - fourth));
}

kernel void burrete_conformer_stereo_validate_v1(
    device const float4* positions [[buffer(0)]],
    device const uint4* chiralAtomQuads [[buffer(1)]],
    device const float2* chiralVolumeBounds [[buffer(2)]],
    device const uint* tetrahedralAtomQuints [[buffer(3)]],
    device const uint* tetrahedralFlags [[buffer(4)]],
    constant ConformerStereoBatchV1& batch [[buffer(5)]],
    device uint* failureFlags [[buffer(6)]],
    uint conformer [[thread_position_in_grid]]
) {
    if (conformer >= batch.conformerCount || batch.atomCount == 0) {
        return;
    }
    const ulong base = static_cast<ulong>(conformer) * batch.atomCount;
    uint failures = 0;
    for (uint atom = 0; atom < batch.atomCount; ++atom) {
        if (!all(isfinite(positions[base + atom]))) {
            failureFlags[conformer] = kNonfiniteFailure;
            return;
        }
    }
    for (uint term = 0; term < batch.chiralCount; ++term) {
        const float volume = signed_volume(positions, base, chiralAtomQuads[term]);
        const float2 bounds = chiralVolumeBounds[term];
        if (volume < bounds.x || volume > bounds.y) {
            failures |= kChiralFailure;
        }
    }
    for (uint term = 0; term < batch.tetrahedralCount; ++term) {
        const uint offset = term * 5u;
        const uint4 vertices = uint4(
            tetrahedralAtomQuints[offset + 1],
            tetrahedralAtomQuints[offset + 2],
            tetrahedralAtomQuints[offset + 3],
            tetrahedralAtomQuints[offset + 4]
        );
        const float volume = signed_volume(positions, base, vertices);
        // Bit 0 records RDKit's fused-small-ring classification. It is
        // validated by the host and retained for future policy, but RDKit's
        // stage-3 non-planarity threshold is currently uniform.
        (void)tetrahedralFlags[term];
        if (fabs(volume) < kTetrahedralVolumeTolerance) {
            failures |= kTetrahedralFailure;
        }
    }
    failureFlags[conformer] = failures;
}
