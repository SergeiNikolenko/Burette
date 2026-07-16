// Copyright 2026 Burrete contributors.
// SPDX-License-Identifier: MIT
// Independent MMFF94/MMFF94s seven-term energy and reference-gradient kernel.

#include <metal_stdlib>
using namespace metal;

constant float PI_F = 3.14159265358979323846f;
constant float DEG_TO_RAD_F = PI_F / 180.0f;
constant float RAD_TO_DEG_F = 180.0f / PI_F;
constant float MDYNE_TO_KCAL_F = 143.9325f;

struct MmffBatchV1 {
    uint atom_count;
    uint conformer_count;
    uint bond_count;
    uint angle_count;
    uint stretch_bend_count;
    uint out_of_plane_count;
    uint torsion_count;
    uint van_der_waals_count;
    uint electrostatic_count;
    uint reserved0;
    uint reserved1;
    uint reserved2;
};

struct MmffTermV1 {
    uint4 atoms;
    float4 parameters0;
    float4 parameters1;
};

struct MmffEnergyV1 {
    float4 first;
    float4 second;
};

inline float3 load_position(const device float4 *positions, uint base, uint atom) {
    return positions[base + atom].xyz;
}

inline float safe_length(float3 value) {
    return sqrt(max(dot(value, value), 1.0e-20f));
}

inline float3 safe_normalize(float3 value) {
    return value / safe_length(value);
}

inline float distance_between(const device float4 *positions, uint base, uint2 atoms) {
    return safe_length(load_position(positions, base, atoms.x) - load_position(positions, base, atoms.y));
}

inline float angle_degrees(const device float4 *positions, uint base, uint3 atoms) {
    float3 first = load_position(positions, base, atoms.x) - load_position(positions, base, atoms.y);
    float3 second = load_position(positions, base, atoms.z) - load_position(positions, base, atoms.y);
    return RAD_TO_DEG_F * acos(clamp(dot(first, second) / (safe_length(first) * safe_length(second)), -1.0f, 1.0f));
}

inline float dihedral_cosine(const device float4 *positions, uint base, uint4 atoms) {
    float3 first = load_position(positions, base, atoms.y) - load_position(positions, base, atoms.x);
    float3 middle = load_position(positions, base, atoms.z) - load_position(positions, base, atoms.y);
    float3 last = load_position(positions, base, atoms.w) - load_position(positions, base, atoms.z);
    float3 normal_first = cross(first, middle);
    float3 normal_last = cross(middle, last);
    return clamp(dot(normal_first, normal_last) / (safe_length(normal_first) * safe_length(normal_last)), -1.0f, 1.0f);
}

inline float out_of_plane_degrees(const device float4 *positions, uint base, uint4 atoms) {
    float3 first = safe_normalize(load_position(positions, base, atoms.x) - load_position(positions, base, atoms.y));
    float3 third = safe_normalize(load_position(positions, base, atoms.z) - load_position(positions, base, atoms.y));
    float3 fourth = safe_normalize(load_position(positions, base, atoms.w) - load_position(positions, base, atoms.y));
    float3 normal = safe_normalize(cross(-first, third));
    return RAD_TO_DEG_F * asin(clamp(dot(normal, fourth), -1.0f, 1.0f));
}

inline MmffEnergyV1 evaluate_terms(
    const device float4 *positions,
    uint base,
    constant MmffBatchV1 &batch,
    const device MmffTermV1 *bonds,
    const device MmffTermV1 *angles,
    const device MmffTermV1 *stretch_bends,
    const device MmffTermV1 *out_of_planes,
    const device MmffTermV1 *torsions,
    const device MmffTermV1 *van_der_waals,
    const device MmffTermV1 *electrostatics
) {
    MmffEnergyV1 energy = {float4(0.0f), float4(0.0f)};
    for (uint index = 0; index < batch.bond_count; ++index) {
        MmffTermV1 term = bonds[index];
        float delta = distance_between(positions, base, term.atoms.xy) - term.parameters0.y;
        float delta2 = delta * delta;
        energy.first[0] += 0.5f * MDYNE_TO_KCAL_F * term.parameters0.x * delta2
            * (1.0f - 2.0f * delta + (7.0f / 3.0f) * delta2);
    }
    for (uint index = 0; index < batch.angle_count; ++index) {
        MmffTermV1 term = angles[index];
        float degrees = angle_degrees(positions, base, term.atoms.xyz);
        if (term.parameters0.z > 0.5f) {
            energy.first[1] += MDYNE_TO_KCAL_F * term.parameters0.x * (1.0f + cos(degrees * DEG_TO_RAD_F));
        } else {
            float delta = degrees - term.parameters0.y;
            energy.first[1] += 0.5f * MDYNE_TO_KCAL_F * DEG_TO_RAD_F * DEG_TO_RAD_F
                * term.parameters0.x * delta * delta * (1.0f - 0.4f * DEG_TO_RAD_F * delta);
        }
    }
    for (uint index = 0; index < batch.stretch_bend_count; ++index) {
        MmffTermV1 term = stretch_bends[index];
        float ij = distance_between(positions, base, term.atoms.xy);
        float kj = distance_between(positions, base, uint2(term.atoms.z, term.atoms.y));
        float delta_angle = angle_degrees(positions, base, term.atoms.xyz) - term.parameters1.x;
        energy.first[2] += 2.51210f * delta_angle
            * (term.parameters0.x * (ij - term.parameters0.z)
                + term.parameters0.y * (kj - term.parameters0.w));
    }
    for (uint index = 0; index < batch.out_of_plane_count; ++index) {
        MmffTermV1 term = out_of_planes[index];
        float degrees = out_of_plane_degrees(positions, base, term.atoms);
        energy.first[3] += 0.5f * MDYNE_TO_KCAL_F * DEG_TO_RAD_F * DEG_TO_RAD_F
            * term.parameters0.x * degrees * degrees;
    }
    for (uint index = 0; index < batch.torsion_count; ++index) {
        MmffTermV1 term = torsions[index];
        float cosine = dihedral_cosine(positions, base, term.atoms);
        float cosine2 = 2.0f * cosine * cosine - 1.0f;
        float cosine3 = cosine * (4.0f * cosine * cosine - 3.0f);
        energy.second[0] += 0.5f * (term.parameters0.x * (1.0f + cosine)
            + term.parameters0.y * (1.0f - cosine2)
            + term.parameters0.z * (1.0f + cosine3));
    }
    for (uint index = 0; index < batch.van_der_waals_count; ++index) {
        MmffTermV1 term = van_der_waals[index];
        float rho = distance_between(positions, base, term.atoms.xy) / term.parameters0.x;
        float buffered = 1.07f / (rho + 0.07f);
        energy.second[1] += term.parameters0.y * powr(buffered, 7.0f)
            * (1.12f / (powr(rho, 7.0f) + 0.12f) - 2.0f);
    }
    for (uint index = 0; index < batch.electrostatic_count; ++index) {
        MmffTermV1 term = electrostatics[index];
        float scale = term.parameters0.y > 0.5f ? 0.75f : 1.0f;
        energy.second[2] += scale * 332.0716f * term.parameters0.x
            / (distance_between(positions, base, term.atoms.xy) + 0.05f);
    }
    return energy;
}

kernel void burrete_mmff_energy_v1(
    const device float4 *positions [[buffer(0)]],
    constant MmffBatchV1 &batch [[buffer(1)]],
    const device MmffTermV1 *bonds [[buffer(2)]],
    const device MmffTermV1 *angles [[buffer(3)]],
    const device MmffTermV1 *stretch_bends [[buffer(4)]],
    const device MmffTermV1 *out_of_planes [[buffer(5)]],
    const device MmffTermV1 *torsions [[buffer(6)]],
    const device MmffTermV1 *van_der_waals [[buffer(7)]],
    const device MmffTermV1 *electrostatics [[buffer(8)]],
    device float4 *breakdowns [[buffer(9)]],
    uint conformer [[thread_position_in_grid]]
) {
    if (conformer >= batch.conformer_count) return;
    MmffEnergyV1 energy = evaluate_terms(positions, conformer * batch.atom_count, batch, bonds, angles,
        stretch_bends, out_of_planes, torsions, van_der_waals, electrostatics);
    breakdowns[conformer * 2] = energy.first;
    breakdowns[conformer * 2 + 1] = energy.second;
}

kernel void burrete_mmff_reference_gradient_v1(
    device float4 *positions [[buffer(0)]],
    constant MmffBatchV1 &batch [[buffer(1)]],
    const device MmffTermV1 *bonds [[buffer(2)]],
    const device MmffTermV1 *angles [[buffer(3)]],
    const device MmffTermV1 *stretch_bends [[buffer(4)]],
    const device MmffTermV1 *out_of_planes [[buffer(5)]],
    const device MmffTermV1 *torsions [[buffer(6)]],
    const device MmffTermV1 *van_der_waals [[buffer(7)]],
    const device MmffTermV1 *electrostatics [[buffer(8)]],
    device float4 *gradients [[buffer(9)]],
    uint conformer [[thread_position_in_grid]]
) {
    if (conformer >= batch.conformer_count) return;
    uint base = conformer * batch.atom_count;
    constexpr float step = 1.0e-3f;
    for (uint atom = 0; atom < batch.atom_count; ++atom) {
        uint atom_item = base + atom;
        for (uint coordinate = 0; coordinate < 3; ++coordinate) {
            float original = positions[atom_item][coordinate];
            positions[atom_item][coordinate] = original + step;
            MmffEnergyV1 plus_terms = evaluate_terms(positions, base, batch, bonds, angles, stretch_bends,
                out_of_planes, torsions, van_der_waals, electrostatics);
            float plus = dot(plus_terms.first, float4(1.0f)) + dot(plus_terms.second, float4(1.0f));
            positions[atom_item][coordinate] = original - step;
            MmffEnergyV1 minus_terms = evaluate_terms(positions, base, batch, bonds, angles, stretch_bends,
                out_of_planes, torsions, van_der_waals, electrostatics);
            float minus = dot(minus_terms.first, float4(1.0f)) + dot(minus_terms.second, float4(1.0f));
            positions[atom_item][coordinate] = original;
            gradients[atom_item][coordinate] = (plus - minus) / (2.0f * step);
        }
        gradients[atom_item].w = 0.0f;
    }
}
