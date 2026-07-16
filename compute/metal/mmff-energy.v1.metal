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

struct MmffDualV1 {
    float value;
    float derivative;
};

struct MmffDual3V1 {
    MmffDualV1 x;
    MmffDualV1 y;
    MmffDualV1 z;
};

inline MmffDualV1 dual(float value, float derivative = 0.0f) {
    MmffDualV1 result = {value, derivative};
    return result;
}

inline MmffDualV1 dual_add(MmffDualV1 left, MmffDualV1 right) {
    return dual(left.value + right.value, left.derivative + right.derivative);
}

inline MmffDualV1 dual_sub(MmffDualV1 left, MmffDualV1 right) {
    return dual(left.value - right.value, left.derivative - right.derivative);
}

inline MmffDualV1 dual_mul(MmffDualV1 left, MmffDualV1 right) {
    return dual(left.value * right.value,
        left.derivative * right.value + left.value * right.derivative);
}

inline MmffDualV1 dual_scale(MmffDualV1 value, float scale) {
    return dual(value.value * scale, value.derivative * scale);
}

inline MmffDualV1 dual_div(MmffDualV1 numerator, MmffDualV1 denominator) {
    float inverse = 1.0f / denominator.value;
    return dual(numerator.value * inverse,
        (numerator.derivative - numerator.value * inverse * denominator.derivative) * inverse);
}

inline MmffDualV1 dual_sqrt(MmffDualV1 value) {
    float root = sqrt(max(value.value, 1.0e-20f));
    return dual(root, value.derivative / (2.0f * root));
}

inline MmffDualV1 dual_acos(MmffDualV1 value) {
    float bounded = clamp(value.value, -1.0f, 1.0f);
    float denominator = sqrt(max(1.0f - bounded * bounded, 1.0e-20f));
    return dual(acos(bounded), -value.derivative / denominator);
}

inline MmffDualV1 dual_asin(MmffDualV1 value) {
    float bounded = clamp(value.value, -1.0f, 1.0f);
    float denominator = sqrt(max(1.0f - bounded * bounded, 1.0e-20f));
    return dual(asin(bounded), value.derivative / denominator);
}

inline MmffDualV1 dual_cos(MmffDualV1 value) {
    return dual(cos(value.value), -sin(value.value) * value.derivative);
}

inline MmffDualV1 dual_pow7(MmffDualV1 value) {
    float sixth = powr(value.value, 6.0f);
    return dual(sixth * value.value, 7.0f * sixth * value.derivative);
}

inline MmffDual3V1 dual_position(
    const device float4 *positions,
    uint atom,
    uint active_atom,
    uint active_coordinate
) {
    float3 position = positions[atom].xyz;
    MmffDual3V1 result = {
        dual(position.x, atom == active_atom && active_coordinate == 0 ? 1.0f : 0.0f),
        dual(position.y, atom == active_atom && active_coordinate == 1 ? 1.0f : 0.0f),
        dual(position.z, atom == active_atom && active_coordinate == 2 ? 1.0f : 0.0f),
    };
    return result;
}

inline MmffDual3V1 dual3_sub(MmffDual3V1 left, MmffDual3V1 right) {
    MmffDual3V1 result = {
        dual_sub(left.x, right.x), dual_sub(left.y, right.y), dual_sub(left.z, right.z)
    };
    return result;
}

inline MmffDual3V1 dual3_scale(MmffDual3V1 value, float scale) {
    MmffDual3V1 result = {
        dual_scale(value.x, scale), dual_scale(value.y, scale), dual_scale(value.z, scale)
    };
    return result;
}

inline MmffDualV1 dual3_dot(MmffDual3V1 left, MmffDual3V1 right) {
    return dual_add(dual_add(dual_mul(left.x, right.x), dual_mul(left.y, right.y)),
        dual_mul(left.z, right.z));
}

inline MmffDual3V1 dual3_cross(MmffDual3V1 left, MmffDual3V1 right) {
    MmffDual3V1 result = {
        dual_sub(dual_mul(left.y, right.z), dual_mul(left.z, right.y)),
        dual_sub(dual_mul(left.z, right.x), dual_mul(left.x, right.z)),
        dual_sub(dual_mul(left.x, right.y), dual_mul(left.y, right.x)),
    };
    return result;
}

inline MmffDualV1 dual3_length(MmffDual3V1 value) {
    return dual_sqrt(dual3_dot(value, value));
}

inline MmffDual3V1 dual3_normalize(MmffDual3V1 value) {
    MmffDualV1 length = dual3_length(value);
    MmffDual3V1 result = {
        dual_div(value.x, length), dual_div(value.y, length), dual_div(value.z, length)
    };
    return result;
}

inline MmffDualV1 dual_distance(
    const device float4 *positions, uint2 atoms, uint active_atom, uint active_coordinate
) {
    return dual3_length(dual3_sub(
        dual_position(positions, atoms.x, active_atom, active_coordinate),
        dual_position(positions, atoms.y, active_atom, active_coordinate)));
}

inline MmffDualV1 dual_angle(
    const device float4 *positions, uint3 atoms, uint active_atom, uint active_coordinate
) {
    MmffDual3V1 center = dual_position(positions, atoms.y, active_atom, active_coordinate);
    MmffDual3V1 first = dual3_sub(
        dual_position(positions, atoms.x, active_atom, active_coordinate), center);
    MmffDual3V1 second = dual3_sub(
        dual_position(positions, atoms.z, active_atom, active_coordinate), center);
    return dual_acos(dual_div(dual3_dot(first, second),
        dual_mul(dual3_length(first), dual3_length(second))));
}

inline MmffDualV1 dual_dihedral_cosine(
    const device float4 *positions, uint4 atoms, uint active_atom, uint active_coordinate
) {
    MmffDual3V1 first = dual3_sub(
        dual_position(positions, atoms.y, active_atom, active_coordinate),
        dual_position(positions, atoms.x, active_atom, active_coordinate));
    MmffDual3V1 middle = dual3_sub(
        dual_position(positions, atoms.z, active_atom, active_coordinate),
        dual_position(positions, atoms.y, active_atom, active_coordinate));
    MmffDual3V1 last = dual3_sub(
        dual_position(positions, atoms.w, active_atom, active_coordinate),
        dual_position(positions, atoms.z, active_atom, active_coordinate));
    MmffDual3V1 normal_first = dual3_cross(first, middle);
    MmffDual3V1 normal_last = dual3_cross(middle, last);
    return dual_div(dual3_dot(normal_first, normal_last),
        dual_mul(dual3_length(normal_first), dual3_length(normal_last)));
}

inline MmffDualV1 dual_out_of_plane(
    const device float4 *positions, uint4 atoms, uint active_atom, uint active_coordinate
) {
    MmffDual3V1 center = dual_position(positions, atoms.y, active_atom, active_coordinate);
    MmffDual3V1 first = dual3_normalize(dual3_sub(
        dual_position(positions, atoms.x, active_atom, active_coordinate), center));
    MmffDual3V1 third = dual3_normalize(dual3_sub(
        dual_position(positions, atoms.z, active_atom, active_coordinate), center));
    MmffDual3V1 fourth = dual3_normalize(dual3_sub(
        dual_position(positions, atoms.w, active_atom, active_coordinate), center));
    MmffDual3V1 normal = dual3_normalize(dual3_cross(dual3_scale(first, -1.0f), third));
    return dual_asin(dual3_dot(normal, fourth));
}

inline MmffDualV1 dual_term_energy(
    const device float4 *positions,
    MmffTermV1 term,
    uint kind,
    uint active_atom,
    uint active_coordinate
) {
    if (kind == 0) {
        MmffDualV1 delta = dual_sub(
            dual_distance(positions, term.atoms.xy, active_atom, active_coordinate),
            dual(term.parameters0.y));
        MmffDualV1 delta2 = dual_mul(delta, delta);
        MmffDualV1 polynomial = dual_add(
            dual_sub(dual(1.0f), dual_scale(delta, 2.0f)),
            dual_scale(delta2, 7.0f / 3.0f));
        return dual_scale(dual_mul(delta2, polynomial),
            0.5f * MDYNE_TO_KCAL_F * term.parameters0.x);
    }
    if (kind == 1) {
        MmffDualV1 angle = dual_angle(positions, term.atoms.xyz, active_atom, active_coordinate);
        if (term.parameters0.z > 0.5f) {
            return dual_scale(dual_add(dual(1.0f), dual_cos(angle)),
                MDYNE_TO_KCAL_F * term.parameters0.x);
        }
        MmffDualV1 delta = dual_sub(dual_scale(angle, RAD_TO_DEG_F), dual(term.parameters0.y));
        MmffDualV1 polynomial = dual_sub(dual(1.0f), dual_scale(delta, 0.4f * DEG_TO_RAD_F));
        return dual_scale(dual_mul(dual_mul(delta, delta), polynomial),
            0.5f * MDYNE_TO_KCAL_F * DEG_TO_RAD_F * DEG_TO_RAD_F * term.parameters0.x);
    }
    if (kind == 2) {
        MmffDualV1 delta_angle = dual_sub(
            dual_scale(dual_angle(positions, term.atoms.xyz, active_atom, active_coordinate), RAD_TO_DEG_F),
            dual(term.parameters1.x));
        MmffDualV1 distances = dual_add(
            dual_scale(dual_sub(dual_distance(positions, term.atoms.xy, active_atom, active_coordinate),
                dual(term.parameters0.z)), term.parameters0.x),
            dual_scale(dual_sub(dual_distance(positions, uint2(term.atoms.z, term.atoms.y),
                active_atom, active_coordinate), dual(term.parameters0.w)), term.parameters0.y));
        return dual_scale(dual_mul(delta_angle, distances), 2.51210f);
    }
    if (kind == 3) {
        MmffDualV1 angle = dual_out_of_plane(positions, term.atoms, active_atom, active_coordinate);
        return dual_scale(dual_mul(angle, angle), 0.5f * MDYNE_TO_KCAL_F * term.parameters0.x);
    }
    if (kind == 4) {
        MmffDualV1 cosine = dual_dihedral_cosine(
            positions, term.atoms, active_atom, active_coordinate);
        MmffDualV1 cosine2 = dual_sub(dual_scale(dual_mul(cosine, cosine), 2.0f), dual(1.0f));
        MmffDualV1 cosine3 = dual_mul(cosine,
            dual_sub(dual_scale(dual_mul(cosine, cosine), 4.0f), dual(3.0f)));
        return dual_scale(dual_add(dual_add(
            dual_scale(dual_add(dual(1.0f), cosine), term.parameters0.x),
            dual_scale(dual_sub(dual(1.0f), cosine2), term.parameters0.y)),
            dual_scale(dual_add(dual(1.0f), cosine3), term.parameters0.z)), 0.5f);
    }
    if (kind == 5) {
        MmffDualV1 rho = dual_scale(
            dual_distance(positions, term.atoms.xy, active_atom, active_coordinate),
            1.0f / term.parameters0.x);
        MmffDualV1 buffered = dual_div(dual(1.07f), dual_add(rho, dual(0.07f)));
        MmffDualV1 attraction = dual_sub(
            dual_div(dual(1.12f), dual_add(dual_pow7(rho), dual(0.12f))), dual(2.0f));
        return dual_scale(dual_mul(dual_pow7(buffered), attraction), term.parameters0.y);
    }
    float scale = term.parameters0.y > 0.5f ? 0.75f : 1.0f;
    return dual_scale(dual_div(dual(1.0f), dual_add(
        dual_distance(positions, term.atoms.xy, active_atom, active_coordinate), dual(0.05f))),
        scale * 332.0716f * term.parameters0.x);
}

inline void accumulate_dual_term(
    const device float4 *positions,
    device float4 *gradients,
    MmffTermV1 term,
    uint kind,
    uint atom_slots
) {
    for (uint slot = 0; slot < atom_slots; ++slot) {
        uint atom = term.atoms[slot];
        bool duplicate = false;
        for (uint prior = 0; prior < slot; ++prior) duplicate = duplicate || term.atoms[prior] == atom;
        if (duplicate) continue;
        for (uint coordinate = 0; coordinate < 3; ++coordinate) {
            gradients[atom][coordinate] +=
                dual_term_energy(positions, term, kind, atom, coordinate).derivative;
        }
    }
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
);

inline float mmff_analytic_objective_gradient(
    const device float4 *positions,
    device float4 *gradients,
    constant MmffBatchV1 &batch,
    const device MmffTermV1 *bonds,
    const device MmffTermV1 *angles,
    const device MmffTermV1 *stretch_bends,
    const device MmffTermV1 *out_of_planes,
    const device MmffTermV1 *torsions,
    const device MmffTermV1 *van_der_waals,
    const device MmffTermV1 *electrostatics
) {
    for (uint atom = 0; atom < batch.atom_count; ++atom) gradients[atom] = float4(0.0f);
    for (uint index = 0; index < batch.bond_count; ++index)
        accumulate_dual_term(positions, gradients, bonds[index], 0, 2);
    for (uint index = 0; index < batch.angle_count; ++index)
        accumulate_dual_term(positions, gradients, angles[index], 1, 3);
    for (uint index = 0; index < batch.stretch_bend_count; ++index)
        accumulate_dual_term(positions, gradients, stretch_bends[index], 2, 3);
    for (uint index = 0; index < batch.out_of_plane_count; ++index)
        accumulate_dual_term(positions, gradients, out_of_planes[index], 3, 4);
    for (uint index = 0; index < batch.torsion_count; ++index)
        accumulate_dual_term(positions, gradients, torsions[index], 4, 4);
    for (uint index = 0; index < batch.van_der_waals_count; ++index)
        accumulate_dual_term(positions, gradients, van_der_waals[index], 5, 2);
    for (uint index = 0; index < batch.electrostatic_count; ++index)
        accumulate_dual_term(positions, gradients, electrostatics[index], 6, 2);
    MmffEnergyV1 terms = evaluate_terms(positions, 0, batch, bonds, angles, stretch_bends,
        out_of_planes, torsions, van_der_waals, electrostatics);
    return dot(terms.first, float4(1.0f)) + dot(terms.second, float4(1.0f));
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

kernel void burrete_mmff_analytic_gradient_v1(
    const device float4 *positions [[buffer(0)]],
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
    mmff_analytic_objective_gradient(positions + base, gradients + base, batch,
        bonds, angles, stretch_bends, out_of_planes, torsions, van_der_waals, electrostatics);
}

struct MmffOptimizeConfigV1 {
    MmffBatchV1 batch;
    uint max_iterations;
    uint history_size;
    uint max_line_search_steps;
    uint bfgs_max_atoms;
    float gradient_tolerance;
    float relative_step_tolerance;
    float armijo_coefficient;
    float max_step_factor;
};

inline float mmff_total(MmffEnergyV1 energy) {
    return dot(energy.first, float4(1.0f)) + dot(energy.second, float4(1.0f));
}

inline float mmff_objective(
    const device float4 *positions,
    constant MmffBatchV1 &batch,
    const device MmffTermV1 *bonds,
    const device MmffTermV1 *angles,
    const device MmffTermV1 *stretch_bends,
    const device MmffTermV1 *out_of_planes,
    const device MmffTermV1 *torsions,
    const device MmffTermV1 *van_der_waals,
    const device MmffTermV1 *electrostatics
) {
    return mmff_total(evaluate_terms(positions, 0, batch, bonds, angles, stretch_bends,
        out_of_planes, torsions, van_der_waals, electrostatics));
}

inline float mmff_objective_gradient(
    device float4 *positions,
    device float4 *gradients,
    constant MmffBatchV1 &batch,
    const device MmffTermV1 *bonds,
    const device MmffTermV1 *angles,
    const device MmffTermV1 *stretch_bends,
    const device MmffTermV1 *out_of_planes,
    const device MmffTermV1 *torsions,
    const device MmffTermV1 *van_der_waals,
    const device MmffTermV1 *electrostatics
) {
    return mmff_analytic_objective_gradient(positions, gradients, batch,
        bonds, angles, stretch_bends, out_of_planes, torsions, van_der_waals, electrostatics);
}

inline float coordinate(device const float4 *values, uint index) {
    return values[index / 3][index % 3];
}

inline void set_coordinate(device float4 *values, uint index, float value) {
    values[index / 3][index % 3] = value;
}

inline float vector_dot_serial(device const float4 *left, device const float4 *right, uint atoms) {
    float result = 0.0f;
    for (uint atom = 0; atom < atoms; ++atom) result += dot(left[atom].xyz, right[atom].xyz);
    return result;
}

inline float scaled_gradient_max_serial(
    device const float4 *positions,
    device const float4 *gradients,
    uint atoms,
    float energy
) {
    float result = 0.0f;
    for (uint atom = 0; atom < atoms; ++atom) {
        result = max(result, max(max(
            abs(gradients[atom].x) * max(abs(positions[atom].x), 1.0f),
            abs(gradients[atom].y) * max(abs(positions[atom].y), 1.0f)),
            abs(gradients[atom].z) * max(abs(positions[atom].z), 1.0f)));
    }
    return result / max(abs(energy), 1.0f);
}

inline void reset_bfgs(device float *hessian, uint coordinates) {
    for (uint row = 0; row < coordinates; ++row) {
        for (uint column = 0; column < coordinates; ++column) {
            hessian[row * coordinates + column] = row == column ? 1.0f : 0.0f;
        }
    }
}

kernel void burrete_mmff_optimize_v1(
    device float4 *positions [[buffer(0)]],
    constant MmffOptimizeConfigV1 &config [[buffer(1)]],
    const device MmffTermV1 *bonds [[buffer(2)]],
    const device MmffTermV1 *angles [[buffer(3)]],
    const device MmffTermV1 *stretch_bends [[buffer(4)]],
    const device MmffTermV1 *out_of_planes [[buffer(5)]],
    const device MmffTermV1 *torsions [[buffer(6)]],
    const device MmffTermV1 *van_der_waals [[buffer(7)]],
    const device MmffTermV1 *electrostatics [[buffer(8)]],
    device float4 *gradients [[buffer(9)]],
    device float4 *directions [[buffer(10)]],
    device float4 *old_positions [[buffer(11)]],
    device float4 *old_gradients [[buffer(12)]],
    device float4 *history_steps [[buffer(13)]],
    device float4 *history_deltas [[buffer(14)]],
    device float *inverse_curvatures [[buffer(15)]],
    device float *alphas [[buffer(16)]],
    device float *inverse_hessians [[buffer(17)]],
    device float *output_energies [[buffer(18)]],
    device float *output_gradient_maxima [[buffer(19)]],
    device uint *output_iterations [[buffer(20)]],
    device uint *output_statuses [[buffer(21)]],
    device uint *output_optimizers [[buffer(22)]],
    uint conformer [[thread_position_in_grid]]
) {
    if (conformer >= config.batch.conformer_count) return;
    const uint atoms = config.batch.atom_count;
    const uint coordinates = atoms * 3;
    const bool use_bfgs = atoms <= config.bfgs_max_atoms;
    const ulong atom_offset = static_cast<ulong>(conformer) * atoms;
    const ulong history_offset = static_cast<ulong>(conformer) * config.history_size * atoms;
    const ulong scalar_history_offset = static_cast<ulong>(conformer) * config.history_size;
    const ulong hessian_offset = use_bfgs
        ? static_cast<ulong>(conformer) * coordinates * coordinates
        : 0;
    device float4 *my_positions = positions + atom_offset;
    device float4 *my_gradients = gradients + atom_offset;
    device float4 *my_directions = directions + atom_offset;
    device float4 *my_old_positions = old_positions + atom_offset;
    device float4 *my_old_gradients = old_gradients + atom_offset;
    device float4 *my_history_steps = history_steps + history_offset;
    device float4 *my_history_deltas = history_deltas + history_offset;
    device float *my_inverse_curvatures = inverse_curvatures + scalar_history_offset;
    device float *my_alphas = alphas + scalar_history_offset;
    device float *my_hessian = inverse_hessians + hessian_offset;

    float energy = mmff_objective_gradient(my_positions, my_gradients, config.batch,
        bonds, angles, stretch_bends, out_of_planes, torsions, van_der_waals, electrostatics);
    float gradient_maximum = scaled_gradient_max_serial(my_positions, my_gradients, atoms, energy);
    uint status = gradient_maximum < config.gradient_tolerance ? 0 : 3;
    uint completed_iterations = 0;
    uint history_count = 0;
    uint history_next = 0;
    float coordinate_norm_squared = 0.0f;
    for (uint atom = 0; atom < atoms; ++atom) {
        my_directions[atom] = -my_gradients[atom];
        coordinate_norm_squared += dot(my_positions[atom].xyz, my_positions[atom].xyz);
    }
    if (use_bfgs) reset_bfgs(my_hessian, coordinates);
    const float max_step = config.max_step_factor
        * max(sqrt(coordinate_norm_squared), static_cast<float>(coordinates));

    for (uint iteration = 0; iteration < config.max_iterations && status == 3; ++iteration) {
        float direction_norm = sqrt(vector_dot_serial(my_directions, my_directions, atoms));
        if (direction_norm > max_step) {
            float scale = max_step / direction_norm;
            for (uint atom = 0; atom < atoms; ++atom) my_directions[atom] *= scale;
        }
        float slope = vector_dot_serial(my_directions, my_gradients, atoms);
        if (!isfinite(slope) || slope >= 0.0f) {
            history_count = 0;
            history_next = 0;
            if (use_bfgs) reset_bfgs(my_hessian, coordinates);
            for (uint atom = 0; atom < atoms; ++atom) my_directions[atom] = -my_gradients[atom];
            slope = -vector_dot_serial(my_gradients, my_gradients, atoms);
        }
        float relative_direction = 0.0f;
        for (uint atom = 0; atom < atoms; ++atom) {
            my_old_positions[atom] = my_positions[atom];
            my_old_gradients[atom] = my_gradients[atom];
            relative_direction = max(relative_direction, max(max(
                abs(my_directions[atom].x) / max(abs(my_positions[atom].x), 1.0f),
                abs(my_directions[atom].y) / max(abs(my_positions[atom].y), 1.0f)),
                abs(my_directions[atom].z) / max(abs(my_positions[atom].z), 1.0f)));
        }
        if (relative_direction == 0.0f) { status = 1; break; }
        const float minimum_step = config.relative_step_tolerance / relative_direction;
        const float old_energy = energy;
        float line_step = 1.0f;
        bool accepted = false;
        for (uint line_search = 0;
             line_search < config.max_line_search_steps && line_step >= minimum_step;
             ++line_search) {
            for (uint atom = 0; atom < atoms; ++atom) {
                my_positions[atom] = my_old_positions[atom] + line_step * my_directions[atom];
                my_positions[atom].w = 0.0f;
            }
            float trial = mmff_objective_gradient(my_positions, my_gradients, config.batch,
                bonds, angles, stretch_bends, out_of_planes, torsions, van_der_waals, electrostatics);
            if (trial <= old_energy + config.armijo_coefficient * line_step * slope) {
                energy = trial;
                accepted = true;
                break;
            }
            line_step *= 0.5f;
        }
        if (!accepted) {
            for (uint atom = 0; atom < atoms; ++atom) {
                my_positions[atom] = my_old_positions[atom];
                my_gradients[atom] = my_old_gradients[atom];
            }
            energy = old_energy;
            status = relative_direction * line_step <= config.relative_step_tolerance ? 1 : 2;
            break;
        }
        completed_iterations = iteration + 1;
        float relative_step = 0.0f;
        float curvature = 0.0f;
        for (uint atom = 0; atom < atoms; ++atom) {
            float4 step = my_positions[atom] - my_old_positions[atom];
            float4 delta = my_gradients[atom] - my_old_gradients[atom];
            relative_step = max(relative_step, max(max(
                abs(step.x) / max(abs(my_positions[atom].x), 1.0f),
                abs(step.y) / max(abs(my_positions[atom].y), 1.0f)),
                abs(step.z) / max(abs(my_positions[atom].z), 1.0f)));
            curvature += dot(step.xyz, delta.xyz);
        }
        gradient_maximum = scaled_gradient_max_serial(my_positions, my_gradients, atoms, energy);
        if (relative_step < config.relative_step_tolerance) { status = 1; break; }
        if (gradient_maximum < config.gradient_tolerance) { status = 0; break; }

        if (isfinite(curvature) && curvature > 1.0e-10f) {
            if (use_bfgs) {
                for (uint row = 0; row < coordinates; ++row) {
                    float value = 0.0f;
                    for (uint column = 0; column < coordinates; ++column) {
                        float delta = coordinate(my_gradients, column)
                            - coordinate(my_old_gradients, column);
                        value += my_hessian[row * coordinates + column] * delta;
                    }
                    set_coordinate(my_directions, row, value);
                }
                float delta_h_delta = 0.0f;
                for (uint index = 0; index < coordinates; ++index) {
                    float delta = coordinate(my_gradients, index)
                        - coordinate(my_old_gradients, index);
                    delta_h_delta += delta * coordinate(my_directions, index);
                }
                float rho = 1.0f / curvature;
                float coefficient = (1.0f + delta_h_delta * rho) * rho;
                for (uint row = 0; row < coordinates; ++row) {
                    float step_row = coordinate(my_positions, row) - coordinate(my_old_positions, row);
                    float h_delta_row = coordinate(my_directions, row);
                    for (uint column = 0; column < coordinates; ++column) {
                        float step_column = coordinate(my_positions, column)
                            - coordinate(my_old_positions, column);
                        float h_delta_column = coordinate(my_directions, column);
                        my_hessian[row * coordinates + column] += coefficient * step_row * step_column
                            - rho * (h_delta_row * step_column + step_row * h_delta_column);
                    }
                }
            } else {
                const uint slot = history_next;
                device float4 *stored_step = my_history_steps + static_cast<ulong>(slot) * atoms;
                device float4 *stored_delta = my_history_deltas + static_cast<ulong>(slot) * atoms;
                for (uint atom = 0; atom < atoms; ++atom) {
                    stored_step[atom] = my_positions[atom] - my_old_positions[atom];
                    stored_delta[atom] = my_gradients[atom] - my_old_gradients[atom];
                }
                my_inverse_curvatures[slot] = 1.0f / curvature;
                history_next = (history_next + 1) % config.history_size;
                history_count = min(history_count + 1, config.history_size);
            }
        }

        if (use_bfgs) {
            for (uint row = 0; row < coordinates; ++row) {
                float value = 0.0f;
                for (uint column = 0; column < coordinates; ++column) {
                    value += my_hessian[row * coordinates + column]
                        * coordinate(my_gradients, column);
                }
                set_coordinate(my_directions, row, -value);
            }
        } else {
            for (uint atom = 0; atom < atoms; ++atom) my_directions[atom] = my_gradients[atom];
            for (uint reverse = 0; reverse < history_count; ++reverse) {
                uint slot = (history_next + config.history_size - 1 - reverse) % config.history_size;
                device float4 *stored_step = my_history_steps + static_cast<ulong>(slot) * atoms;
                device float4 *stored_delta = my_history_deltas + static_cast<ulong>(slot) * atoms;
                float alpha = my_inverse_curvatures[slot]
                    * vector_dot_serial(stored_step, my_directions, atoms);
                my_alphas[history_count - 1 - reverse] = alpha;
                for (uint atom = 0; atom < atoms; ++atom) my_directions[atom] -= alpha * stored_delta[atom];
            }
            if (history_count > 0) {
                uint newest = (history_next + config.history_size - 1) % config.history_size;
                device float4 *stored_step = my_history_steps + static_cast<ulong>(newest) * atoms;
                device float4 *stored_delta = my_history_deltas + static_cast<ulong>(newest) * atoms;
                float denominator = vector_dot_serial(stored_delta, stored_delta, atoms);
                if (denominator > 0.0f) {
                    float scale = vector_dot_serial(stored_step, stored_delta, atoms) / denominator;
                    for (uint atom = 0; atom < atoms; ++atom) my_directions[atom] *= scale;
                }
            }
            for (uint forward = 0; forward < history_count; ++forward) {
                uint slot = (history_next + config.history_size - history_count + forward)
                    % config.history_size;
                device float4 *stored_step = my_history_steps + static_cast<ulong>(slot) * atoms;
                device float4 *stored_delta = my_history_deltas + static_cast<ulong>(slot) * atoms;
                float beta = my_inverse_curvatures[slot]
                    * vector_dot_serial(stored_delta, my_directions, atoms);
                float alpha = my_alphas[forward];
                for (uint atom = 0; atom < atoms; ++atom) {
                    my_directions[atom] += (alpha - beta) * stored_step[atom];
                }
            }
            for (uint atom = 0; atom < atoms; ++atom) my_directions[atom] = -my_directions[atom];
        }
    }
    output_energies[conformer] = energy;
    output_gradient_maxima[conformer] = gradient_maximum;
    output_iterations[conformer] = completed_iterations;
    output_statuses[conformer] = status;
    output_optimizers[conformer] = use_bfgs ? 0 : 1;
}
