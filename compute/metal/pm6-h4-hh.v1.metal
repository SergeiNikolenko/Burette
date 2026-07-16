#include <metal_stdlib>
using namespace metal;

constant float KCAL_MOL_TO_EV = 1.0f / 23.060547830619f;
constant float HALF_PI = 1.5707963267948966f;

struct Pm6CorrectionAtomV1 {
    float4 position_radius;
    uint4 identity;
};

struct Pm6CorrectionMoleculeV1 {
    uint4 span;
};

inline float distance_atoms(device const Pm6CorrectionAtomV1* atoms, uint left, uint right) {
    return distance(atoms[left].position_radius.xyz, atoms[right].position_radius.xyz);
}

inline float smooth_polynomial(float x) {
    float x2 = x * x;
    float x4 = x2 * x2;
    return x4 * (35.0f + x * (-84.0f + x * (70.0f - 20.0f * x)));
}

inline float covalent_contribution(
    device const Pm6CorrectionAtomV1* atoms,
    uint left,
    uint right
) {
    float covalent_distance = atoms[left].position_radius.w + atoms[right].position_radius.w;
    float cutoff = covalent_distance * 1.6f;
    float separation = distance_atoms(atoms, left, right);
    if (separation == 0.0f || separation >= cutoff) return 0.0f;
    if (separation <= covalent_distance) return 1.0f;
    float x = (separation - covalent_distance) / (cutoff - covalent_distance);
    return 1.0f - smooth_polynomial(x);
}

inline float water_scale(
    device const Pm6CorrectionAtomV1* atoms,
    uint start,
    uint count,
    uint donor,
    uint donor_element,
    uint acceptor_element
) {
    if (donor_element != 8u || acceptor_element != 8u) return 1.0f;
    float hydrogens = 0.0f;
    float others = 0.0f;
    for (uint local = 0u; local < count; ++local) {
        uint index = start + local;
        float contribution = covalent_contribution(atoms, donor, index);
        if (atoms[index].identity.x == 1u) hydrogens += contribution;
        else others += contribution;
    }
    if (hydrogens < 1.0f) return 1.0f;
    float valence_factor = 0.0f;
    if (hydrogens > 1.0f && hydrogens <= 2.0f) valence_factor = hydrogens - 1.0f;
    else if (hydrogens > 2.0f && hydrogens < 3.0f) valence_factor = 3.0f - hydrogens;
    return 1.0f - 0.58f * valence_factor * max(1.0f - others, 0.0f);
}

inline float ammonium_scale(
    device const Pm6CorrectionAtomV1* atoms,
    uint start,
    uint count,
    uint donor,
    uint donor_element
) {
    if (donor_element != 7u) return 1.0f;
    float valence = 0.0f;
    for (uint local = 0u; local < count; ++local) {
        valence += covalent_contribution(atoms, donor, start + local);
    }
    return 1.0f + 2.61f * max(valence - 3.0f, 0.0f);
}

inline float carboxylate_scale(
    device const Pm6CorrectionAtomV1* atoms,
    uint start,
    uint count,
    uint acceptor,
    uint acceptor_element
) {
    if (acceptor_element != 8u) return 1.0f;
    float acceptor_valence = 0.0f;
    uint carbon = 0xffffffffu;
    float carbon_distance = INFINITY;
    for (uint local = 0u; local < count; ++local) {
        uint index = start + local;
        float contribution = covalent_contribution(atoms, acceptor, index);
        acceptor_valence += contribution;
        if (contribution > 0.0f && atoms[index].identity.x == 6u) {
            float separation = distance_atoms(atoms, acceptor, index);
            if (separation < carbon_distance) {
                carbon_distance = separation;
                carbon = index;
            }
        }
    }
    if (carbon == 0xffffffffu) return 1.0f;
    float carbon_valence = 0.0f;
    uint second_oxygen = 0xffffffffu;
    float oxygen_distance = INFINITY;
    for (uint local = 0u; local < count; ++local) {
        uint index = start + local;
        float contribution = covalent_contribution(atoms, carbon, index);
        carbon_valence += contribution;
        if (contribution > 0.0f && index != acceptor && atoms[index].identity.x == 8u) {
            float separation = distance_atoms(atoms, carbon, index);
            if (separation < oxygen_distance) {
                oxygen_distance = separation;
                second_oxygen = index;
            }
        }
    }
    if (second_oxygen == 0xffffffffu) return 1.0f;
    float second_oxygen_valence = 0.0f;
    for (uint local = 0u; local < count; ++local) {
        second_oxygen_valence += covalent_contribution(atoms, second_oxygen, start + local);
    }
    float first_factor = max(1.0f - abs(1.0f - acceptor_valence), 0.0f);
    float second_factor = max(1.0f - abs(1.0f - second_oxygen_valence), 0.0f);
    float carbon_factor = max(1.0f - abs(3.0f - carbon_valence), 0.0f);
    return 1.0f + 0.41f * first_factor * second_factor * carbon_factor;
}

inline float h4_triple(
    device const Pm6CorrectionAtomV1* atoms,
    uint start,
    uint count,
    uint hydrogen,
    uint left,
    uint right
) {
    float left_h = distance_atoms(atoms, left, hydrogen);
    float right_h = distance_atoms(atoms, right, hydrogen);
    float donor_acceptor = distance_atoms(atoms, left, right);
    float3 left_vector = atoms[left].position_radius.xyz - atoms[hydrogen].position_radius.xyz;
    float3 right_vector = atoms[right].position_radius.xyz - atoms[hydrogen].position_radius.xyz;
    float denominator = max(length(left_vector) * length(right_vector), 1.0e-12f);
    float cosine = clamp(dot(left_vector, right_vector) / denominator, -1.0f, 1.0f);
    float angle = M_PI_F - acos(cosine);
    if (angle >= HALF_PI) return 0.0f;

    uint donor = left_h < right_h ? left : right;
    uint acceptor = left_h < right_h ? right : left;
    float donor_h = min(left_h, right_h);
    float acceptor_h = max(left_h, right_h);
    float r = donor_acceptor;
    float radial = ((((((-0.003034074074073135f * r + 0.07357629629627092f) * r
        - 0.700871111110828f) * r + 3.2530962962946175f) * r
        - 7.206874074068388f) * r + 5.317546666655722f) * r
        + 3.407360000011028f) * r - 4.685120000004504f;
    float angular_polynomial = smooth_polynomial(angle / HALF_PI);
    float angular = 1.0f - angular_polynomial * angular_polynomial;
    uint donor_element = atoms[donor].identity.x;
    uint acceptor_element = atoms[acceptor].identity.x;
    float pair_parameter = 0.0f;
    if (donor_element == 8u && acceptor_element == 8u) pair_parameter = 2.32f;
    else if (donor_element == 8u && acceptor_element == 7u) pair_parameter = 3.10f;
    else if (donor_element == 7u && acceptor_element == 8u) pair_parameter = 1.07f;
    else if (donor_element == 7u && acceptor_element == 7u) pair_parameter = 2.01f;
    if (pair_parameter == 0.0f) return 0.0f;
    float bond_switch = 1.0f;
    if (donor_h > 1.15f) {
        float stretched = donor_h - 1.15f;
        float average = max(0.5f * donor_h + 0.5f * acceptor_h - 1.15f, 1.0e-12f);
        bond_switch = 1.0f - smooth_polynomial(stretched / average);
    }
    return pair_parameter * radial * angular * bond_switch
        * water_scale(atoms, start, count, donor, donor_element, acceptor_element)
        * ammonium_scale(atoms, start, count, donor, donor_element)
        * carboxylate_scale(atoms, start, count, acceptor, acceptor_element);
}

inline float hh_pair(float r) {
    if (r <= 1.0f) return 25.46293603147693f;
    if (r < 1.5f) {
        return ((((-2714.9523516034697f * r + 17103.650110591705f) * r
            - 42511.85798221796f) * r + 52063.19679913834f) * r
            - 31430.65833597229f) * r + 7516.08469609514f;
    }
    return 118.7326f * exp(-1.53965f * pow(r, 1.72905f));
}

kernel void burrete_pm6_h4_hh_v1(
    device const Pm6CorrectionAtomV1* atoms [[buffer(0)]],
    device const Pm6CorrectionMoleculeV1* molecules [[buffer(1)]],
    constant uint& molecule_count [[buffer(2)]],
    device float2* corrections_ev [[buffer(3)]],
    uint gid [[thread_position_in_grid]]
) {
    if (gid >= molecule_count) return;
    uint start = molecules[gid].span.x;
    uint count = molecules[gid].span.y;
    float h4 = 0.0f;
    float hh = 0.0f;
    for (uint h_local = 0u; h_local < count; ++h_local) {
        uint hydrogen = start + h_local;
        if (atoms[hydrogen].identity.x != 1u) continue;
        for (uint left_local = 0u; left_local < count; ++left_local) {
            uint left = start + left_local;
            uint left_element = atoms[left].identity.x;
            if (left_element != 7u && left_element != 8u) continue;
            for (uint right_local = left_local + 1u; right_local < count; ++right_local) {
                uint right = start + right_local;
                uint right_element = atoms[right].identity.x;
                if (right_element == 7u || right_element == 8u) {
                    h4 += h4_triple(atoms, start, count, hydrogen, left, right);
                }
            }
        }
        for (uint other_local = 0u; other_local < h_local; ++other_local) {
            uint other = start + other_local;
            if (atoms[other].identity.x == 1u) hh += hh_pair(distance_atoms(atoms, hydrogen, other));
        }
    }
    corrections_ev[gid] = float2(h4, hh) * KCAL_MOL_TO_EV;
}
