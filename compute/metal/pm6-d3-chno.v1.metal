#include <metal_stdlib>
using namespace metal;

struct D3AtomV1 { float4 position; uint4 identity; };
struct D3MoleculeV1 { uint4 span; };
struct D3ReferenceV1 { float4 values; };
constant D3ReferenceV1 D3_REFERENCES[125] = {
    { float4(3.0267f, 0.9118f, 0.9118f, 0.0f) },
    { float4(4.7379f, 0.9118f, 0.0f, 0.0f) },
    { float4(4.7379f, 0.0f, 0.9118f, 0.0f) },
    { float4(7.5916f, 0.0f, 0.0f, 0.0f) },
    { float4(12.1402f, 0.9118f, 0.0f, 0.0f) },
    { float4(11.3932f, 0.9118f, 0.9868f, 0.0f) },
    { float4(9.4203f, 0.9118f, 1.9985f, 0.0f) },
    { float4(8.821f, 0.9118f, 2.9987f, 0.0f) },
    { float4(7.3662f, 0.9118f, 3.9844f, 0.0f) },
    { float4(19.2653f, 0.0f, 0.0f, 0.0f) },
    { float4(18.0575f, 0.0f, 0.9868f, 0.0f) },
    { float4(14.7623f, 0.0f, 1.9985f, 0.0f) },
    { float4(13.7992f, 0.0f, 2.9987f, 0.0f) },
    { float4(11.3299f, 0.0f, 3.9844f, 0.0f) },
    { float4(8.7171f, 0.9118f, 0.0f, 0.0f) },
    { float4(8.1417f, 0.9118f, 0.9944f, 0.0f) },
    { float4(7.661f, 0.9118f, 2.0143f, 0.0f) },
    { float4(6.7746f, 0.9118f, 2.9903f, 0.0f) },
    { float4(13.5164f, 0.0f, 0.0f, 0.0f) },
    { float4(12.598f, 0.0f, 0.9944f, 0.0f) },
    { float4(11.8214f, 0.0f, 2.0143f, 0.0f) },
    { float4(10.3987f, 0.0f, 2.9903f, 0.0f) },
    { float4(6.718f, 0.9118f, 0.0f, 0.0f) },
    { float4(6.0575f, 0.9118f, 0.9925f, 0.0f) },
    { float4(5.3717f, 0.9118f, 1.9887f, 0.0f) },
    { float4(10.2371f, 0.0f, 0.0f, 0.0f) },
    { float4(9.1812f, 0.0f, 0.9925f, 0.0f) },
    { float4(8.0848f, 0.0f, 1.9887f, 0.0f) },
    { float4(49.113f, 0.0f, 0.0f, 0.0f) },
    { float4(46.0681f, 0.0f, 0.9868f, 0.0f) },
    { float4(37.8419f, 0.0f, 1.9985f, 0.0f) },
    { float4(35.4129f, 0.0f, 2.9987f, 0.0f) },
    { float4(29.283f, 0.0f, 3.9844f, 0.0f) },
    { float4(46.0681f, 0.9868f, 0.0f, 0.0f) },
    { float4(43.2452f, 0.9868f, 0.9868f, 0.0f) },
    { float4(35.5219f, 0.9868f, 1.9985f, 0.0f) },
    { float4(33.254f, 0.9868f, 2.9987f, 0.0f) },
    { float4(27.5206f, 0.9868f, 3.9844f, 0.0f) },
    { float4(37.8419f, 1.9985f, 0.0f, 0.0f) },
    { float4(35.5219f, 1.9985f, 0.9868f, 0.0f) },
    { float4(29.3602f, 1.9985f, 1.9985f, 0.0f) },
    { float4(27.5063f, 1.9985f, 2.9987f, 0.0f) },
    { float4(22.9517f, 1.9985f, 3.9844f, 0.0f) },
    { float4(35.4129f, 2.9987f, 0.0f, 0.0f) },
    { float4(33.254f, 2.9987f, 0.9868f, 0.0f) },
    { float4(27.5063f, 2.9987f, 1.9985f, 0.0f) },
    { float4(25.7809f, 2.9987f, 2.9987f, 0.0f) },
    { float4(21.5377f, 2.9987f, 3.9844f, 0.0f) },
    { float4(29.283f, 3.9844f, 0.0f, 0.0f) },
    { float4(27.5206f, 3.9844f, 0.9868f, 0.0f) },
    { float4(22.9517f, 3.9844f, 1.9985f, 0.0f) },
    { float4(21.5377f, 3.9844f, 2.9987f, 0.0f) },
    { float4(18.2067f, 3.9844f, 3.9844f, 0.0f) },
    { float4(34.8146f, 0.0f, 0.0f, 0.0f) },
    { float4(32.4848f, 0.0f, 0.9944f, 0.0f) },
    { float4(30.5305f, 0.0f, 2.0143f, 0.0f) },
    { float4(26.9351f, 0.0f, 2.9903f, 0.0f) },
    { float4(32.7009f, 0.9868f, 0.0f, 0.0f) },
    { float4(30.541f, 0.9868f, 0.9944f, 0.0f) },
    { float4(28.6938f, 0.9868f, 2.0143f, 0.0f) },
    { float4(25.3318f, 0.9868f, 2.9903f, 0.0f) },
    { float4(27.1704f, 1.9985f, 0.0f, 0.0f) },
    { float4(25.3827f, 1.9985f, 0.9944f, 0.0f) },
    { float4(23.8965f, 1.9985f, 2.0143f, 0.0f) },
    { float4(21.1488f, 1.9985f, 2.9903f, 0.0f) },
    { float4(25.4799f, 2.9987f, 0.0f, 0.0f) },
    { float4(23.8136f, 2.9987f, 0.9944f, 0.0f) },
    { float4(22.4279f, 2.9987f, 2.0143f, 0.0f) },
    { float4(19.8669f, 2.9987f, 2.9903f, 0.0f) },
    { float4(21.4199f, 3.9844f, 0.0f, 0.0f) },
    { float4(20.0468f, 3.9844f, 0.9944f, 0.0f) },
    { float4(18.9172f, 3.9844f, 2.0143f, 0.0f) },
    { float4(16.8169f, 3.9844f, 2.9903f, 0.0f) },
    { float4(26.5929f, 0.0f, 0.0f, 0.0f) },
    { float4(23.912f, 0.0f, 0.9925f, 0.0f) },
    { float4(21.1428f, 0.0f, 1.9887f, 0.0f) },
    { float4(25.0097f, 0.9868f, 0.0f, 0.0f) },
    { float4(22.5178f, 0.9868f, 0.9925f, 0.0f) },
    { float4(19.909f, 0.9868f, 1.9887f, 0.0f) },
    { float4(20.9597f, 1.9985f, 0.0f, 0.0f) },
    { float4(18.9034f, 1.9985f, 0.9925f, 0.0f) },
    { float4(16.7855f, 1.9985f, 1.9887f, 0.0f) },
    { float4(19.6943f, 2.9987f, 0.0f, 0.0f) },
    { float4(17.775f, 2.9987f, 0.9925f, 0.0f) },
    { float4(15.8009f, 2.9987f, 1.9887f, 0.0f) },
    { float4(16.7544f, 3.9844f, 0.0f, 0.0f) },
    { float4(15.1751f, 3.9844f, 0.9925f, 0.0f) },
    { float4(13.5525f, 3.9844f, 1.9887f, 0.0f) },
    { float4(25.2685f, 0.0f, 0.0f, 0.0f) },
    { float4(23.6295f, 0.0f, 0.9944f, 0.0f) },
    { float4(22.2794f, 0.0f, 2.0143f, 0.0f) },
    { float4(19.7707f, 0.0f, 2.9903f, 0.0f) },
    { float4(23.6295f, 0.9944f, 0.0f, 0.0f) },
    { float4(22.1241f, 0.9944f, 0.9944f, 0.0f) },
    { float4(20.8501f, 0.9944f, 2.0143f, 0.0f) },
    { float4(18.518f, 0.9944f, 2.9903f, 0.0f) },
    { float4(22.2794f, 2.0143f, 0.0f, 0.0f) },
    { float4(20.8501f, 2.0143f, 0.9944f, 0.0f) },
    { float4(19.6768f, 2.0143f, 2.0143f, 0.0f) },
    { float4(17.4928f, 2.0143f, 2.9903f, 0.0f) },
    { float4(19.7707f, 2.9903f, 0.0f, 0.0f) },
    { float4(18.518f, 2.9903f, 0.9944f, 0.0f) },
    { float4(17.4928f, 2.9903f, 2.0143f, 0.0f) },
    { float4(15.5817f, 2.9903f, 2.9903f, 0.0f) },
    { float4(19.6546f, 0.0f, 0.0f, 0.0f) },
    { float4(17.7698f, 0.0f, 0.9925f, 0.0f) },
    { float4(15.8364f, 0.0f, 1.9887f, 0.0f) },
    { float4(18.4128f, 0.9944f, 0.0f, 0.0f) },
    { float4(16.6775f, 0.9944f, 0.9925f, 0.0f) },
    { float4(14.86f, 0.9944f, 1.9887f, 0.0f) },
    { float4(17.4093f, 2.0143f, 0.0f, 0.0f) },
    { float4(15.7631f, 2.0143f, 0.9925f, 0.0f) },
    { float4(14.0807f, 2.0143f, 1.9887f, 0.0f) },
    { float4(15.5249f, 2.9903f, 0.0f, 0.0f) },
    { float4(14.0793f, 2.9903f, 0.9925f, 0.0f) },
    { float4(12.6077f, 2.9903f, 1.9887f, 0.0f) },
    { float4(15.5059f, 0.0f, 0.0f, 0.0f) },
    { float4(14.0764f, 0.0f, 0.9925f, 0.0f) },
    { float4(12.6277f, 0.0f, 1.9887f, 0.0f) },
    { float4(14.0764f, 0.9925f, 0.0f, 0.0f) },
    { float4(12.8161f, 0.9925f, 0.9925f, 0.0f) },
    { float4(11.5009f, 0.9925f, 1.9887f, 0.0f) },
    { float4(12.6277f, 1.9887f, 0.0f, 0.0f) },
    { float4(11.5009f, 1.9887f, 0.9925f, 0.0f) },
    { float4(10.3708f, 1.9887f, 1.9887f, 0.0f) },
};

inline int element_slot(uint z) { if (z == 1u) return 0; if (z == 6u) return 1; if (z == 7u) return 2; if (z == 8u) return 3; return -1; }
inline float d3_radius(uint z) { if (z == 1u) return 0.32f; if (z == 6u) return 0.75f; if (z == 7u) return 0.71f; return 0.63f; }
inline uint pair_id(uint a, uint b) { uint x=min(a,b), y=max(a,b);
    if (x == 1u && y == 1u) return 0u;
    if (x == 1u && y == 6u) return 1u;
    if (x == 1u && y == 7u) return 2u;
    if (x == 1u && y == 8u) return 3u;
    if (x == 6u && y == 6u) return 4u;
    if (x == 6u && y == 7u) return 5u;
    if (x == 6u && y == 8u) return 6u;
    if (x == 7u && y == 7u) return 7u;
    if (x == 7u && y == 8u) return 8u;
    if (x == 8u && y == 8u) return 9u;
    return 0xffffffffu; }
inline uint2 reference_span(uint id) {
    if (id == 0u) return uint2(0u, 4u);
    if (id == 1u) return uint2(4u, 10u);
    if (id == 2u) return uint2(14u, 8u);
    if (id == 3u) return uint2(22u, 6u);
    if (id == 4u) return uint2(28u, 25u);
    if (id == 5u) return uint2(53u, 20u);
    if (id == 6u) return uint2(73u, 15u);
    if (id == 7u) return uint2(88u, 16u);
    if (id == 8u) return uint2(104u, 12u);
    if (id == 9u) return uint2(116u, 9u);
    return uint2(0u); }
inline float pair_r0(uint id) {
    if (id == 0u) return 2.1823f;
    if (id == 1u) return 2.4492f;
    if (id == 2u) return 2.3667f;
    if (id == 3u) return 2.1768f;
    if (id == 4u) return 2.9103f;
    if (id == 5u) return 2.7063f;
    if (id == 6u) return 2.5697f;
    if (id == 7u) return 2.6225f;
    if (id == 8u) return 2.4846f;
    if (id == 9u) return 2.4817f;
    return 0.0f; }

inline float coordination_number(device const D3AtomV1* atoms, uint start, uint count, uint target) {
    float value = 0.0f;
    uint z = atoms[target].identity.x;
    for (uint local = 0u; local < count; ++local) {
        uint other = start + local;
        if (other == target) continue;
        float separation_bohr = distance(atoms[target].position.xyz, atoms[other].position.xyz) / 0.5291772083f;
        if (separation_bohr < 1.0e-12f) continue;
        float radius_bohr = (4.0f / 3.0f) * (d3_radius(z) + d3_radius(atoms[other].identity.x)) / 0.5291772083f;
        value += 1.0f / (1.0f + exp(-16.0f * (radius_bohr / separation_bohr - 1.0f)));
    }
    return value;
}
inline float interpolate_c6(uint2 span, float cn_left, float cn_right) {
    float fallback = -1.0e30f;
    float weight_sum = 0.0f;
    float weighted = 0.0f;
    for (uint index = 0u; index < span.y; ++index) {
        float4 reference = D3_REFERENCES[span.x + index].values;
        fallback = reference.x;
        float dl = reference.y - cn_left;
        float dr = reference.z - cn_right;
        float weight = exp(-4.0f * (dl * dl + dr * dr));
        weight_sum += weight;
        weighted += weight * reference.x;
    }
    return weight_sum > 0.0f ? weighted / weight_sum : fallback;
}

kernel void burrete_pm6_d3_chno_v1(
    device const D3AtomV1* atoms [[buffer(0)]],
    device const D3MoleculeV1* molecules [[buffer(1)]],
    constant uint& molecule_count [[buffer(2)]],
    device float* dispersion_ev [[buffer(3)]],
    uint gid [[thread_position_in_grid]]
) {
    if (gid >= molecule_count) return;
    uint start = molecules[gid].span.x;
    uint count = molecules[gid].span.y;
    float energy_hartree = 0.0f;
    for (uint left_local = 0u; left_local < count; ++left_local) {
        uint left = start + left_local;
        uint zi = atoms[left].identity.x;
        float cn_left_original = coordination_number(atoms, start, count, left);
        for (uint right_local = left_local + 1u; right_local < count; ++right_local) {
            uint right = start + right_local;
            uint zj = atoms[right].identity.x;
            float3 delta = atoms[right].position.xyz - atoms[left].position.xyz;
            float distance_bohr_squared = dot(delta, delta) / (0.5291772083f * 0.5291772083f);
            if (distance_bohr_squared == 0.0f || distance_bohr_squared > (15.0f / 0.5291772083f) * (15.0f / 0.5291772083f)) continue;
            float cn_right_original = coordination_number(atoms, start, count, right);
            bool swapped = zi > zj;
            float cn_left = swapped ? cn_right_original : cn_left_original;
            float cn_right = swapped ? cn_left_original : cn_right_original;
            uint id = pair_id(zi, zj);
            float c6 = interpolate_c6(reference_span(id), cn_left, cn_right);
            float ratio = 1.180f * pair_r0(id) / sqrt(distance_bohr_squared);
            float damping = 1.0f / (1.0f + 6.0f * pow(ratio, 22.0f));
            energy_hartree += c6 * damping / (distance_bohr_squared * distance_bohr_squared * distance_bohr_squared);
        }
    }
    dispersion_ev[gid] = -0.880f * energy_hartree * 27.211386245988f;
}
