#include <metal_stdlib>

using namespace metal;

constant float BURRETE_ETK_MIN_NORM_SQUARED = 1.0e-12f;

struct ConformerEtkBatchV1 {
    uint atomCount;
    uint conformerCount;
    uint torsionCount;
    uint improperCount;
    uint distanceCount;
    uint reserved0;
    uint reserved1;
    uint reserved2;
};

inline float3 dihedral_derivative(
    device const float4* positions,
    uint4 atoms,
    uint target,
    thread float& angle
) {
    const float3 p0 = positions[atoms.x].xyz;
    const float3 p1 = positions[atoms.y].xyz;
    const float3 p2 = positions[atoms.z].xyz;
    const float3 p3 = positions[atoms.w].xyz;
    const float3 b1 = p1 - p0;
    const float3 b2 = p2 - p1;
    const float3 b3 = p3 - p2;
    const float3 n1 = cross(b1, b2);
    const float3 n2 = cross(b2, b3);
    const float n1Squared = max(dot(n1, n1), BURRETE_ETK_MIN_NORM_SQUARED);
    const float n2Squared = max(dot(n2, n2), BURRETE_ETK_MIN_NORM_SQUARED);
    const float b2Squared = max(dot(b2, b2), BURRETE_ETK_MIN_NORM_SQUARED);
    const float b2Length = sqrt(b2Squared);
    const float inverseNormals = rsqrt(n1Squared * n2Squared);
    const float cosine = clamp(dot(n1, n2) * inverseNormals, -1.0f, 1.0f);
    const float sine = dot(cross(n1, b2 / b2Length), n2) * inverseNormals;
    angle = atan2(sine, cosine);

    const float3 d0 = n1 * (b2Length / n1Squared);
    const float3 d3 = n2 * (-b2Length / n2Squared);
    const float firstProjection = -dot(b1, b2) / b2Squared;
    const float lastProjection = -dot(b3, b2) / b2Squared;
    const float3 d1 = (firstProjection - 1.0f) * d0 - lastProjection * d3;
    const float3 d2 = (lastProjection - 1.0f) * d3 - firstProjection * d0;
    if (target == atoms.x) return d0;
    if (target == atoms.y) return d1;
    if (target == atoms.z) return d2;
    return d3;
}

kernel void burrete_conformer_etk_v1(
    device const float4* positions [[buffer(0)]],
    device const uint4* torsionAtoms [[buffer(1)]],
    device const float* torsionCoefficients [[buffer(2)]],
    device const char* torsionSigns [[buffer(3)]],
    device const uint4* improperAtoms [[buffer(4)]],
    device const float* improperWeights [[buffer(5)]],
    device const uint2* distanceAtoms [[buffer(6)]],
    device const float2* distanceBounds [[buffer(7)]],
    device const float* distanceWeights [[buffer(8)]],
    constant ConformerEtkBatchV1& batch [[buffer(9)]],
    device float* atomEnergies [[buffer(10)]],
    device float4* gradients [[buffer(11)]],
    uint item [[thread_position_in_grid]]
) {
    const ulong itemCount = static_cast<ulong>(batch.atomCount) * batch.conformerCount;
    if (static_cast<ulong>(item) >= itemCount || batch.atomCount == 0) {
        return;
    }
    const uint conformer = item / batch.atomCount;
    const uint atom = item - conformer * batch.atomCount;
    const ulong base = static_cast<ulong>(conformer) * batch.atomCount;
    device const float4* myPositions = positions + base;
    float energy = 0.0f;
    float3 gradient = float3(0.0f);

    for (uint term = 0; term < batch.torsionCount; ++term) {
        const uint4 atoms = torsionAtoms[term];
        if (atom != atoms.x && atom != atoms.y && atom != atoms.z && atom != atoms.w) {
            continue;
        }
        float angle = 0.0f;
        const float3 angleDerivative = dihedral_derivative(myPositions, atoms, atom, angle);
        float termEnergy = 0.0f;
        float energyDerivative = 0.0f;
        for (uint harmonic = 0; harmonic < 6; ++harmonic) {
            const uint index = term * 6 + harmonic;
            const float coefficient = torsionCoefficients[index];
            const float sign = static_cast<float>(torsionSigns[index]);
            const float order = static_cast<float>(harmonic + 1);
            termEnergy += coefficient * (1.0f + sign * cos(order * angle)) * 0.5f;
            energyDerivative += coefficient * (-sign * order * sin(order * angle)) * 0.5f;
        }
        energy += termEnergy * 0.25f;
        gradient += energyDerivative * angleDerivative;
    }

    for (uint term = 0; term < batch.improperCount; ++term) {
        const uint4 atoms = improperAtoms[term];
        if (atom != atoms.x && atom != atoms.y && atom != atoms.z && atom != atoms.w) {
            continue;
        }
        float angle = 0.0f;
        const float3 angleDerivative = dihedral_derivative(myPositions, atoms, atom, angle);
        const float weight = improperWeights[term];
        energy += weight * (1.0f - cos(2.0f * angle)) * 0.25f;
        gradient += (2.0f * weight * sin(2.0f * angle)) * angleDerivative;
    }

    for (uint term = 0; term < batch.distanceCount; ++term) {
        const uint2 atoms = distanceAtoms[term];
        const bool isLeft = atom == atoms.x;
        const bool isRight = atom == atoms.y;
        if (!isLeft && !isRight) {
            continue;
        }
        const float3 delta = myPositions[atoms.x].xyz - myPositions[atoms.y].xyz;
        const float distance = sqrt(max(dot(delta, delta), BURRETE_ETK_MIN_NORM_SQUARED));
        const float2 bounds = distanceBounds[term];
        const float violation = distance < bounds.x
            ? distance - bounds.x
            : (distance > bounds.y ? distance - bounds.y : 0.0f);
        if (violation == 0.0f) {
            continue;
        }
        const float weight = distanceWeights[term];
        energy += weight * violation * violation * 0.5f;
        gradient += (isLeft ? 1.0f : -1.0f)
            * (2.0f * weight * violation / distance) * delta;
    }

    atomEnergies[item] = energy;
    gradients[item] = float4(gradient, 0.0f);
}
