#include <metal_stdlib>
using namespace metal;

struct D3AtomV2 { float4 position; uint4 identity; };
struct D3MoleculeV2 { uint4 span; };

inline float coordination_number(
    device const D3AtomV2* atoms,
    device const float* covalent_radii,
    uint start,
    uint count,
    uint target
) {
    float value = 0.0f;
    uint z = atoms[target].identity.x;
    for (uint local = 0u; local < count; ++local) {
        uint other = start + local;
        if (other == target) continue;
        float separation_bohr =
            distance(atoms[target].position.xyz, atoms[other].position.xyz) / 0.5291772083f;
        if (separation_bohr < 1.0e-12f) continue;
        float radius_bohr = (4.0f / 3.0f)
            * (covalent_radii[z - 1u] + covalent_radii[atoms[other].identity.x - 1u])
            / 0.5291772083f;
        value += 1.0f / (1.0f + exp(-16.0f * (radius_bohr / separation_bohr - 1.0f)));
    }
    return value;
}

inline float interpolate_c6(
    device const uint* reference_offsets,
    device const float4* references,
    uint pair,
    float cn_left,
    float cn_right
) {
    uint start = reference_offsets[pair];
    uint end = reference_offsets[pair + 1u];
    float fallback = -1.0e30f;
    float weight_sum = 0.0f;
    float weighted = 0.0f;
    for (uint index = start; index < end; ++index) {
        float4 reference = references[index];
        fallback = reference.x;
        float dl = reference.y - cn_left;
        float dr = reference.z - cn_right;
        float weight = exp(-4.0f * (dl * dl + dr * dr));
        weight_sum += weight;
        weighted += weight * reference.x;
    }
    return weight_sum > 0.0f ? weighted / weight_sum : fallback;
}

kernel void burette_pm6_d3_v2(
    device const D3AtomV2* atoms [[buffer(0)]],
    device const D3MoleculeV2* molecules [[buffer(1)]],
    constant uint& molecule_count [[buffer(2)]],
    device const float* covalent_radii [[buffer(3)]],
    device const float* pair_r0 [[buffer(4)]],
    device const uint* reference_offsets [[buffer(5)]],
    device const float4* references [[buffer(6)]],
    device float* dispersion_ev [[buffer(7)]],
    uint gid [[thread_position_in_grid]]
) {
    if (gid >= molecule_count) return;
    uint start = molecules[gid].span.x;
    uint count = molecules[gid].span.y;
    float energy_hartree = 0.0f;
    for (uint left_local = 0u; left_local < count; ++left_local) {
        uint left = start + left_local;
        uint zi = atoms[left].identity.x;
        float cn_left = coordination_number(atoms, covalent_radii, start, count, left);
        for (uint right_local = left_local + 1u; right_local < count; ++right_local) {
            uint right = start + right_local;
            uint zj = atoms[right].identity.x;
            float3 delta = atoms[right].position.xyz - atoms[left].position.xyz;
            float distance_bohr_squared = dot(delta, delta) / (0.5291772083f * 0.5291772083f);
            if (distance_bohr_squared == 0.0f
                || distance_bohr_squared > (15.0f / 0.5291772083f) * (15.0f / 0.5291772083f)) {
                continue;
            }
            float cn_right = coordination_number(atoms, covalent_radii, start, count, right);
            uint pair = (zi - 1u) * 94u + zj - 1u;
            float c6 = interpolate_c6(reference_offsets, references, pair, cn_left, cn_right);
            float ratio = 1.180f * pair_r0[pair] / sqrt(distance_bohr_squared);
            float damping = 1.0f / (1.0f + 6.0f * pow(ratio, 22.0f));
            energy_hartree += c6 * damping
                / (distance_bohr_squared * distance_bohr_squared * distance_bohr_squared);
        }
    }
    dispersion_ev[gid] = -0.880f * energy_hartree * 27.211386245988f;
}
