#include <metal_stdlib>

using namespace metal;

constant uint kAlignmentMappedHorn = 1;
constant uint kPowerIterations = 48;
constant float kEpsilon = 1.0e-8f;
constant float kPi = 3.14159265358979323846f;
constant float kEspA[9] = {
    15.90600036f, 3.95348310f, 17.61453176f,
    3.95348310f, 5.21580206f, 1.91045387f,
    17.61453176f, 1.91045387f, 238.75820253f,
};
constant float kEspB[9] = {
    -0.02495000f, -0.04539319f, -0.00247124f,
    -0.04539319f, -0.25130000f, -0.00258662f,
    -0.00247124f, -0.00258662f, -0.00130000f,
};

struct AlignmentPairV1 {
    ulong probeAtomStart;
    ulong probeAtomCount;
    ulong referenceAtomStart;
    ulong referenceAtomCount;
    ulong mappingStart;
    ulong mappingCount;
    ulong flags;
    ulong reserved;
};

struct AtomMappingV1 {
    uint probeAtom;
    uint referenceAtom;
    float weight;
    uint reserved;
};

inline float4 normalize4_v1(float4 value) {
    const float lengthSquared = dot(value, value);
    return lengthSquared > 1.0e-20f
        ? value * rsqrt(lengthSquared)
        : float4(1.0f, 0.0f, 0.0f, 0.0f);
}

inline float4 multiply_key_v1(thread const float key[16], float4 value) {
    return float4(
        key[0] * value.x + key[1] * value.y + key[2] * value.z + key[3] * value.w,
        key[4] * value.x + key[5] * value.y + key[6] * value.z + key[7] * value.w,
        key[8] * value.x + key[9] * value.y + key[10] * value.z + key[11] * value.w,
        key[12] * value.x + key[13] * value.y + key[14] * value.z + key[15] * value.w
    );
}

inline float4 dominant_quaternion_v1(thread const float key[16]) {
    const float4 starts[5] = {
        float4(1.0f, 0.0f, 0.0f, 0.0f),
        float4(0.0f, 1.0f, 0.0f, 0.0f),
        float4(0.0f, 0.0f, 1.0f, 0.0f),
        float4(0.0f, 0.0f, 0.0f, 1.0f),
        float4(0.5f),
    };
    float shift = 1.0f;
    for (uint row = 0; row < 4; ++row) {
        float rowSum = 0.0f;
        for (uint column = 0; column < 4; ++column) {
            rowSum += abs(key[row * 4 + column]);
        }
        shift = max(shift, rowSum + 1.0f);
    }
    float4 best = starts[0];
    float bestValue = -INFINITY;
    for (uint start = 0; start < 5; ++start) {
        float4 candidate = starts[start];
        for (uint iteration = 0; iteration < kPowerIterations; ++iteration) {
            candidate = normalize4_v1(multiply_key_v1(key, candidate) + shift * candidate);
        }
        const float value = dot(candidate, multiply_key_v1(key, candidate));
        if (value > bestValue) {
            bestValue = value;
            best = candidate;
        }
    }
    if (abs(best.x) > 1.0e-12f ? best.x < 0.0f
        : (abs(best.y) > 1.0e-12f ? best.y < 0.0f
        : (abs(best.z) > 1.0e-12f ? best.z < 0.0f : best.w < 0.0f))) {
        best = -best;
    }
    return normalize4_v1(best);
}

inline void quaternion_rotation_v1(
    float4 quaternion,
    thread float3& row0,
    thread float3& row1,
    thread float3& row2
) {
    const float4 q = normalize4_v1(quaternion);
    const float w = q.x;
    const float x = q.y;
    const float y = q.z;
    const float z = q.w;
    row0 = float3(
        1.0f - 2.0f * (y * y + z * z),
        2.0f * (x * y - z * w),
        2.0f * (x * z + y * w)
    );
    row1 = float3(
        2.0f * (x * y + z * w),
        1.0f - 2.0f * (x * x + z * z),
        2.0f * (y * z - x * w)
    );
    row2 = float3(
        2.0f * (x * z - y * w),
        2.0f * (y * z + x * w),
        1.0f - 2.0f * (x * x + y * y)
    );
}

inline float3 apply_transform_v1(
    float3 position,
    float3 row0,
    float3 row1,
    float3 row2,
    float3 translation
) {
    return float3(
        position.x * row0.x + position.y * row1.x + position.z * row2.x,
        position.x * row0.y + position.y * row1.y + position.z * row2.y,
        position.x * row0.z + position.y * row1.z + position.z * row2.z
    ) + translation;
}

inline float gaussian_pair_v1(float3 left, float2 leftParameter, float3 right, float2 rightParameter) {
    const float exponentSum = leftParameter.x + rightParameter.x;
    const float mixed = leftParameter.x * rightParameter.x / exponentSum;
    const float3 delta = left - right;
    const float prefactor = pow(kPi / exponentSum, 1.5f);
    return leftParameter.y * rightParameter.y * prefactor * exp(-mixed * dot(delta, delta));
}

inline float electrostatic_pair_v1(float3 left, float leftCharge, float3 right, float rightCharge) {
    const float3 delta = left - right;
    const float distanceSquared = dot(delta, delta);
    float potential = 0.0f;
    for (uint term = 0; term < 9; ++term) {
        potential += kEspA[term] * exp(kEspB[term] * distanceSquared);
    }
    return leftCharge * rightCharge * potential;
}

kernel void burette_alignment_score_v1(
    device const float4* probePositions [[buffer(0)]],
    device const float4* probeParameters [[buffer(1)]],
    device const float4* referencePositions [[buffer(2)]],
    device const float4* referenceParameters [[buffer(3)]],
    device const AtomMappingV1* mappings [[buffer(4)]],
    device const AlignmentPairV1* pairs [[buffer(5)]],
    device float4* transforms [[buffer(6)]],
    device float4* primaryScores [[buffer(7)]],
    device float4* secondaryScores [[buffer(8)]],
    device uint* statuses [[buffer(9)]],
    uint pairIndex [[thread_position_in_grid]]
) {
    const AlignmentPairV1 pair = pairs[pairIndex];
    const bool mapped = (pair.flags & kAlignmentMappedHorn) != 0;
    if (pair.probeAtomCount == 0 || pair.referenceAtomCount == 0 || pair.reserved != 0 ||
        (mapped && pair.mappingCount == 0)) {
        statuses[pairIndex] = 0x80000000u;
        return;
    }

    float3 probeCentroid = float3(0.0f);
    float3 referenceCentroid = float3(0.0f);
    float weightSum = 0.0f;
    float covariance[9] = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
    if (mapped) {
        for (ulong index = 0; index < pair.mappingCount; ++index) {
            const AtomMappingV1 mapping = mappings[pair.mappingStart + index];
            const float weight = mapping.weight;
            probeCentroid += weight * probePositions[pair.probeAtomStart + mapping.probeAtom].xyz;
            referenceCentroid += weight * referencePositions[pair.referenceAtomStart + mapping.referenceAtom].xyz;
            weightSum += weight;
        }
        if (!(weightSum > 0.0f) || !isfinite(weightSum)) {
            statuses[pairIndex] = 0x80000001u;
            return;
        }
        probeCentroid /= weightSum;
        referenceCentroid /= weightSum;
        for (ulong index = 0; index < pair.mappingCount; ++index) {
            const AtomMappingV1 mapping = mappings[pair.mappingStart + index];
            const float3 probe = probePositions[pair.probeAtomStart + mapping.probeAtom].xyz - probeCentroid;
            const float3 reference = referencePositions[pair.referenceAtomStart + mapping.referenceAtom].xyz - referenceCentroid;
            const float weight = mapping.weight / weightSum;
            covariance[0] += weight * reference.x * probe.x;
            covariance[1] += weight * reference.x * probe.y;
            covariance[2] += weight * reference.x * probe.z;
            covariance[3] += weight * reference.y * probe.x;
            covariance[4] += weight * reference.y * probe.y;
            covariance[5] += weight * reference.y * probe.z;
            covariance[6] += weight * reference.z * probe.x;
            covariance[7] += weight * reference.z * probe.y;
            covariance[8] += weight * reference.z * probe.z;
        }
    }

    float3 row0 = float3(1.0f, 0.0f, 0.0f);
    float3 row1 = float3(0.0f, 1.0f, 0.0f);
    float3 row2 = float3(0.0f, 0.0f, 1.0f);
    float3 translation = float3(0.0f);
    float rmsd = 0.0f;
    if (mapped) {
        const float sxx = covariance[0];
        const float sxy = covariance[1];
        const float sxz = covariance[2];
        const float syx = covariance[3];
        const float syy = covariance[4];
        const float syz = covariance[5];
        const float szx = covariance[6];
        const float szy = covariance[7];
        const float szz = covariance[8];
        float key[16] = {
            sxx + syy + szz, syz - szy, szx - sxz, sxy - syx,
            syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
            szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
            sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
        };
        quaternion_rotation_v1(dominant_quaternion_v1(key), row0, row1, row2);
        translation = referenceCentroid - apply_transform_v1(
            probeCentroid, row0, row1, row2, float3(0.0f)
        );
        float rmsdSquared = 0.0f;
        for (ulong index = 0; index < pair.mappingCount; ++index) {
            const AtomMappingV1 mapping = mappings[pair.mappingStart + index];
            const float3 aligned = apply_transform_v1(
                probePositions[pair.probeAtomStart + mapping.probeAtom].xyz,
                row0, row1, row2, translation
            );
            const float3 target = referencePositions[pair.referenceAtomStart + mapping.referenceAtom].xyz;
            const float3 delta = aligned - target;
            rmsdSquared += mapping.weight * dot(delta, delta);
        }
        rmsd = sqrt(max(rmsdSquared / weightSum, 0.0f));
    }

    float probeShape = 0.0f;
    float referenceShape = 0.0f;
    float crossShape = 0.0f;
    float probeEsp = 0.0f;
    float referenceEsp = 0.0f;
    float crossEsp = 0.0f;
    for (ulong left = 0; left < pair.probeAtomCount; ++left) {
        const float3 leftPosition = apply_transform_v1(
            probePositions[pair.probeAtomStart + left].xyz,
            row0, row1, row2, translation
        );
        const float4 leftParameter = probeParameters[pair.probeAtomStart + left];
        for (ulong right = 0; right < pair.probeAtomCount; ++right) {
            const float3 rightPosition = apply_transform_v1(
                probePositions[pair.probeAtomStart + right].xyz,
                row0, row1, row2, translation
            );
            const float4 rightParameter = probeParameters[pair.probeAtomStart + right];
            probeShape += gaussian_pair_v1(leftPosition, leftParameter.xy, rightPosition, rightParameter.xy);
            probeEsp += electrostatic_pair_v1(leftPosition, leftParameter.z, rightPosition, rightParameter.z);
        }
        for (ulong right = 0; right < pair.referenceAtomCount; ++right) {
            const float3 rightPosition = referencePositions[pair.referenceAtomStart + right].xyz;
            const float4 rightParameter = referenceParameters[pair.referenceAtomStart + right];
            crossShape += gaussian_pair_v1(leftPosition, leftParameter.xy, rightPosition, rightParameter.xy);
            crossEsp += electrostatic_pair_v1(leftPosition, leftParameter.z, rightPosition, rightParameter.z);
        }
    }
    for (ulong left = 0; left < pair.referenceAtomCount; ++left) {
        const float3 leftPosition = referencePositions[pair.referenceAtomStart + left].xyz;
        const float4 leftParameter = referenceParameters[pair.referenceAtomStart + left];
        for (ulong right = 0; right < pair.referenceAtomCount; ++right) {
            const float3 rightPosition = referencePositions[pair.referenceAtomStart + right].xyz;
            const float4 rightParameter = referenceParameters[pair.referenceAtomStart + right];
            referenceShape += gaussian_pair_v1(leftPosition, leftParameter.xy, rightPosition, rightParameter.xy);
            referenceEsp += electrostatic_pair_v1(leftPosition, leftParameter.z, rightPosition, rightParameter.z);
        }
    }

    const float shapeTanimoto = clamp(
        crossShape / max(probeShape + referenceShape - crossShape, kEpsilon), 0.0f, 1.0f
    );
    const float shapeCarbo = clamp(
        crossShape / max(sqrt(max(probeShape, kEpsilon) * max(referenceShape, kEpsilon)), kEpsilon),
        0.0f, 1.0f
    );
    const bool electrostaticAvailable = probeEsp > kEpsilon && referenceEsp > kEpsilon;
    float electrostaticCarbo = 0.0f;
    float electrostaticTanimoto = 0.0f;
    float combined = shapeTanimoto;
    if (electrostaticAvailable) {
        electrostaticCarbo = clamp(
            crossEsp / max(sqrt(probeEsp * referenceEsp), kEpsilon), -1.0f, 1.0f
        );
        electrostaticTanimoto = clamp(
            crossEsp / max(probeEsp + referenceEsp - crossEsp, kEpsilon), -1.0f / 3.0f, 1.0f
        );
        combined = 0.5f * (shapeTanimoto + 0.5f * (electrostaticCarbo + 1.0f));
    }

    transforms[pairIndex * 4] = float4(row0, 0.0f);
    transforms[pairIndex * 4 + 1] = float4(row1, 0.0f);
    transforms[pairIndex * 4 + 2] = float4(row2, 0.0f);
    transforms[pairIndex * 4 + 3] = float4(translation, 0.0f);
    primaryScores[pairIndex] = float4(rmsd, crossShape, shapeTanimoto, shapeCarbo);
    secondaryScores[pairIndex] = float4(crossEsp, electrostaticCarbo, electrostaticTanimoto, combined);
    statuses[pairIndex] = electrostaticAvailable ? 1u : 0u;
}
