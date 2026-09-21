#include <metal_stdlib>

using namespace metal;

struct Rm1PairRotationV1 {
    uint4 spans;
    uint4 model;
    float4 delta;
};

struct Rm1PairParametersV1 {
    float4 left0;
    float4 left1;
    float4 right0;
    float4 right1;
};

inline float inverse_distance(float value) { return rsqrt(value); }

inline void generate_local_integrals(
    uint model,
    Rm1PairParametersV1 parameters,
    float distanceAngstrom,
    thread float* ri
) {
    const float ev = 27.21f;
    const float distance = distanceAngstrom / 0.529167f;
    const float da = parameters.left0.x;
    const float db = parameters.right0.x;
    const float qa1 = parameters.left0.y;
    const float qb1 = parameters.right0.y;
    const float qa = 2.0f * qa1;
    const float qb = 2.0f * qb1;
    const float rma = parameters.left0.z;
    const float rda = parameters.left0.w;
    const float rqa = parameters.left1.x;
    const float rmb = parameters.right0.z;
    const float rdb = parameters.right0.w;
    const float rqb = parameters.right1.x;
    const float ee = ev * inverse_distance(distance * distance + (rma + rmb) * (rma + rmb));
    ri[0] = ee;
    if (model == 0) return;
    const float halfEv = ev * 0.5f;
    const float quarter = ev * 0.25f;
    const float eighth = ev * 0.125f;
    const float sixteenth = ev * 0.0625f;
    if (model == 1) {
        const bool leftHeavy = da != 0.0f || qa1 != 0.0f;
        const float dipole = leftHeavy ? da : db;
        const float quadrupole = 2.0f * (leftHeavy ? qa1 : qb1);
        const float heavyDipoleRho = leftHeavy ? rda : rdb;
        const float heavyQuadrupoleRho = leftHeavy ? rqa : rqb;
        const float hydrogenRho = leftHeavy ? rmb : rma;
        const float dipoleWidth = (heavyDipoleRho + hydrogenRho) * (heavyDipoleRho + hydrogenRho);
        const float quadrupoleWidth = (heavyQuadrupoleRho + hydrogenRho) * (heavyQuadrupoleRho + hydrogenRho);
        const float center = halfEv * inverse_distance(distance * distance + quadrupoleWidth);
        ri[1] = halfEv * inverse_distance((distance + dipole) * (distance + dipole) + dipoleWidth)
            - halfEv * inverse_distance((distance - dipole) * (distance - dipole) + dipoleWidth);
        ri[2] = ee + quarter * inverse_distance((distance + quadrupole) * (distance + quadrupole) + quadrupoleWidth)
            + quarter * inverse_distance((distance - quadrupole) * (distance - quadrupole) + quadrupoleWidth) - center;
        ri[3] = ee + halfEv * inverse_distance(distance * distance + quadrupole * quadrupole + quadrupoleWidth) - center;
        return;
    }
    const float sqAde = (rda + rmb) * (rda + rmb);
    const float sqAqe = (rqa + rmb) * (rqa + rmb);
    const float sqAed = (rma + rdb) * (rma + rdb);
    const float sqAeq = (rma + rqb) * (rma + rqb);
    const float sqAxx = (rda + rdb) * (rda + rdb);
    const float sqAdq = (rda + rqb) * (rda + rqb);
    const float sqAqd = (rqa + rdb) * (rqa + rdb);
    const float sqAqq = (rqa + rqb) * (rqa + rqb);
    const float dze = -halfEv * inverse_distance((distance + da) * (distance + da) + sqAde)
        + halfEv * inverse_distance((distance - da) * (distance - da) + sqAde);
    const float halfAqe = halfEv * inverse_distance(distance * distance + sqAqe);
    const float qzze = quarter * inverse_distance((distance - qa) * (distance - qa) + sqAqe)
        + quarter * inverse_distance((distance + qa) * (distance + qa) + sqAqe) - halfAqe;
    const float qxxe = halfEv * inverse_distance(distance * distance + qa * qa + sqAqe) - halfAqe;
    const float edz = -halfEv * inverse_distance((distance - db) * (distance - db) + sqAed)
        + halfEv * inverse_distance((distance + db) * (distance + db) + sqAed);
    const float halfAeq = halfEv * inverse_distance(distance * distance + sqAeq);
    const float eqzz = quarter * inverse_distance((distance - qb) * (distance - qb) + sqAeq)
        + quarter * inverse_distance((distance + qb) * (distance + qb) + sqAeq) - halfAeq;
    const float eqxx = halfEv * inverse_distance(distance * distance + qb * qb + sqAeq) - halfAeq;
    const float q20 = quarter * inverse_distance((distance + da) * (distance + da) + sqAdq);
    const float q22 = quarter * inverse_distance((distance - da) * (distance - da) + sqAdq);
    const float q24 = quarter * inverse_distance((distance - db) * (distance - db) + sqAqd);
    const float q26 = quarter * inverse_distance((distance + db) * (distance + db) + sqAqd);
    const float q36 = quarter * inverse_distance(distance * distance + sqAqq);
    const float q39 = quarter * inverse_distance(distance * distance + qa * qa + sqAqq);
    const float q40 = quarter * inverse_distance(distance * distance + qb * qb + sqAqq);
    const float e42 = eighth * inverse_distance((distance - qb) * (distance - qb) + sqAqq);
    const float e44 = eighth * inverse_distance((distance + qb) * (distance + qb) + sqAqq);
    const float e46 = eighth * inverse_distance((distance + qa) * (distance + qa) + sqAqq);
    const float e48 = eighth * inverse_distance((distance - qa) * (distance - qa) + sqAqq);
    ri[1] = -dze;
    ri[2] = ee + qzze;
    ri[3] = ee + qxxe;
    ri[4] = -edz;
    ri[5] = quarter * inverse_distance((distance + da - db) * (distance + da - db) + sqAxx)
        + quarter * inverse_distance((distance - da + db) * (distance - da + db) + sqAxx)
        - quarter * inverse_distance((distance - da - db) * (distance - da - db) + sqAxx)
        - quarter * inverse_distance((distance + da + db) * (distance + da + db) + sqAxx);
    ri[6] = halfEv * inverse_distance(distance * distance + (da - db) * (da - db) + sqAxx)
        - halfEv * inverse_distance(distance * distance + (da + db) * (da + db) + sqAxx);
    ri[7] = -edz + eighth * inverse_distance((distance + qa - db) * (distance + qa - db) + sqAqd)
        - eighth * inverse_distance((distance + qa + db) * (distance + qa + db) + sqAqd)
        + eighth * inverse_distance((distance - qa - db) * (distance - qa - db) + sqAqd)
        - eighth * inverse_distance((distance - qa + db) * (distance - qa + db) + sqAqd) - q24 + q26;
    ri[8] = -edz - q24 + quarter * inverse_distance((distance - db) * (distance - db) + qa * qa + sqAqd)
        + q26 - quarter * inverse_distance((distance + db) * (distance + db) + qa * qa + sqAqd);
    ri[9] = quarter * inverse_distance((qa1 - db) * (qa1 - db) + (distance + qa1) * (distance + qa1) + sqAqd)
        - quarter * inverse_distance((qa1 - db) * (qa1 - db) + (distance - qa1) * (distance - qa1) + sqAqd)
        - quarter * inverse_distance((qa1 + db) * (qa1 + db) + (distance + qa1) * (distance + qa1) + sqAqd)
        + quarter * inverse_distance((qa1 + db) * (qa1 + db) + (distance - qa1) * (distance - qa1) + sqAqd);
    ri[10] = ee + eqzz;
    ri[11] = ee + eqxx;
    ri[12] = -dze + eighth * inverse_distance((distance + da - qb) * (distance + da - qb) + sqAdq)
        - eighth * inverse_distance((distance - da - qb) * (distance - da - qb) + sqAdq)
        + eighth * inverse_distance((distance + da + qb) * (distance + da + qb) + sqAdq)
        - eighth * inverse_distance((distance - da + qb) * (distance - da + qb) + sqAdq) + q22 - q20;
    ri[13] = -dze - q20 + quarter * inverse_distance((distance + da) * (distance + da) + qb * qb + sqAdq)
        + q22 - quarter * inverse_distance((distance - da) * (distance - da) + qb * qb + sqAdq);
    ri[14] = quarter * inverse_distance((da - qb1) * (da - qb1) + (distance - qb1) * (distance - qb1) + sqAdq)
        - quarter * inverse_distance((da - qb1) * (da - qb1) + (distance + qb1) * (distance + qb1) + sqAdq)
        - quarter * inverse_distance((da + qb1) * (da + qb1) + (distance - qb1) * (distance - qb1) + sqAdq)
        + quarter * inverse_distance((da + qb1) * (da + qb1) + (distance + qb1) * (distance + qb1) + sqAdq);
    ri[15] = ee + eqzz + qzze
        + sixteenth * inverse_distance((distance + qa - qb) * (distance + qa - qb) + sqAqq)
        + sixteenth * inverse_distance((distance + qa + qb) * (distance + qa + qb) + sqAqq)
        + sixteenth * inverse_distance((distance - qa - qb) * (distance - qa - qb) + sqAqq)
        + sixteenth * inverse_distance((distance - qa + qb) * (distance - qa + qb) + sqAqq)
        - e48 - e46 - e42 - e44 + q36;
    ri[16] = ee + eqzz + qxxe
        + eighth * inverse_distance((distance - qb) * (distance - qb) + qa * qa + sqAqq)
        + eighth * inverse_distance((distance + qb) * (distance + qb) + qa * qa + sqAqq)
        - e42 - e44 - q39 + q36;
    ri[17] = ee + eqxx + qzze
        + eighth * inverse_distance((distance + qa) * (distance + qa) + qb * qb + sqAqq)
        + eighth * inverse_distance((distance - qa) * (distance - qa) + qb * qb + sqAqq)
        - e46 - e48 - q40 + q36;
    const float qxxqxx = eighth * inverse_distance(distance * distance + (qa - qb) * (qa - qb) + sqAqq)
        + eighth * inverse_distance(distance * distance + (qa + qb) * (qa + qb) + sqAqq) - q39 - q40 + q36;
    ri[18] = ee + eqxx + qxxe + qxxqxx;
    ri[19] = eighth * inverse_distance((distance + qa1 - qb1) * (distance + qa1 - qb1) + (qa1 - qb1) * (qa1 - qb1) + sqAqq)
        - eighth * inverse_distance((distance + qa1 + qb1) * (distance + qa1 + qb1) + (qa1 - qb1) * (qa1 - qb1) + sqAqq)
        - eighth * inverse_distance((distance - qa1 - qb1) * (distance - qa1 - qb1) + (qa1 - qb1) * (qa1 - qb1) + sqAqq)
        + eighth * inverse_distance((distance - qa1 + qb1) * (distance - qa1 + qb1) + (qa1 - qb1) * (qa1 - qb1) + sqAqq)
        - eighth * inverse_distance((distance + qa1 - qb1) * (distance + qa1 - qb1) + (qa1 + qb1) * (qa1 + qb1) + sqAqq)
        + eighth * inverse_distance((distance + qa1 + qb1) * (distance + qa1 + qb1) + (qa1 + qb1) * (qa1 + qb1) + sqAqq)
        + eighth * inverse_distance((distance - qa1 - qb1) * (distance - qa1 - qb1) + (qa1 + qb1) * (qa1 + qb1) + sqAqq)
        - eighth * inverse_distance((distance - qa1 + qb1) * (distance - qa1 + qb1) + (qa1 + qb1) * (qa1 + qb1) + sqAqq);
    const float qxxqyy = quarter * inverse_distance(distance * distance + qa * qa + qb * qb + sqAqq) - q39 - q40 + q36;
    ri[20] = ee + eqxx + qxxe + qxxqyy;
    ri[21] = 0.5f * (qxxqxx - qxxqyy);
}

inline uint tensor_index(uint a, uint b, uint c, uint d) {
    return ((a * 4 + b) * 4 + c) * 4 + d;
}

inline float3x3 rotation_matrix(float3 vector) {
    const float w = 1.0f + vector.x;
    if (abs(w) < 1.0e-7f) {
        return float3x3(float3(-1.0f, 0.0f, 0.0f),
                        float3(0.0f, -1.0f, 0.0f),
                        float3(0.0f, 0.0f, 1.0f));
    }
    const float norm = sqrt(vector.z * vector.z + vector.y * vector.y + w * w);
    const float qy = vector.z / norm;
    const float qz = -vector.y / norm;
    const float qw = w / norm;
    return float3x3(
        float3(1.0f - 2.0f * (qy * qy + qz * qz), -2.0f * qz * qw, 2.0f * qy * qw),
        float3(2.0f * qz * qw, 1.0f - 2.0f * qz * qz, 2.0f * qy * qz),
        float3(-2.0f * qy * qw, 2.0f * qy * qz, 1.0f - 2.0f * qy * qy));
}

inline float heavy_heavy_value(
    uint mu, uint nu, uint lambda, uint sigma,
    thread const float* ri, float3 r0, float3 r1, float3 r2
) {
    const uint kk = max(mu, nu);
    const uint ll = min(mu, nu);
    const uint mm = max(lambda, sigma);
    const uint nn = min(lambda, sigma);
    const uint k = kk == 0 ? 0 : kk - 1;
    const uint l = ll == 0 ? 0 : ll - 1;
    const uint m = mm == 0 ? 0 : mm - 1;
    const uint n = nn == 0 ? 0 : nn - 1;
    if (kk == 0) {
        if (mm == 0) return ri[0];
        if (nn == 0) return ri[4] * r0[m];
        return ri[10] * r0[m] * r0[n] + ri[11] * (r1[m] * r1[n] + r2[m] * r2[n]);
    }
    if (ll == 0) {
        if (mm == 0) return ri[1] * r0[k];
        if (nn == 0) return ri[5] * r0[k] * r0[m] + ri[6] * (r1[k] * r1[m] + r2[k] * r2[m]);
        const float axial = r0[k] * r0[m] * r0[n];
        const float pi = (r1[m] * r1[n] + r2[m] * r2[n]) * r0[k];
        const float mix = r1[k] * (r1[n] * r0[m] + r1[m] * r0[n])
            + r2[k] * (r2[m] * r0[n] + r2[n] * r0[m]);
        return ri[12] * axial + ri[13] * pi + ri[14] * mix;
    }
    if (mm == 0) return ri[2] * r0[k] * r0[l] + ri[3] * (r1[k] * r1[l] + r2[k] * r2[l]);
    if (nn == 0) {
        const float axial = r0[k] * r0[l] * r0[m];
        const float pi = (r1[k] * r1[l] + r2[k] * r2[l]) * r0[m];
        const float mixL = r1[l] * r1[m] + r2[l] * r2[m];
        const float mixK = r1[k] * r1[m] + r2[k] * r2[m];
        return ri[7] * axial + ri[8] * pi + ri[9] * (r0[k] * mixL + r0[l] * mixK);
    }
    const float axial = r0[k] * r0[l] * r0[m] * r0[n];
    const float leftPi = (r1[k] * r1[l] + r2[k] * r2[l]) * r0[m] * r0[n];
    const float rightPi = (r1[m] * r1[n] + r2[m] * r2[n]) * r0[k] * r0[l];
    const float purePi = r1[k] * r1[l] * r1[m] * r1[n] + r2[k] * r2[l] * r2[m] * r2[n];
    const float coupled = r0[k] * (r0[m] * (r1[l] * r1[n] + r2[l] * r2[n])
        + r0[n] * (r1[l] * r1[m] + r2[l] * r2[m]))
        + r0[l] * (r0[m] * (r1[k] * r1[n] + r2[k] * r2[n])
        + r0[n] * (r1[k] * r1[m] + r2[k] * r2[m]));
    const float crossPi = r1[k] * r1[l] * r2[m] * r2[n] + r2[k] * r2[l] * r1[m] * r1[n];
    const float exchange = (r1[k] * r2[l] + r2[k] * r1[l]) * (r1[m] * r2[n] + r2[m] * r1[n]);
    return ri[15] * axial + ri[16] * leftPi + ri[17] * rightPi + ri[18] * purePi
        + ri[19] * coupled + ri[20] * crossPi + ri[21] * exchange;
}

kernel void burette_rm1_pair_rotate_v1(
    device const Rm1PairRotationV1* pairs [[buffer(0)]],
    device const Rm1PairParametersV1* pairParameters [[buffer(1)]],
    constant uint& pairCount [[buffer(2)]],
    device float* repulsion [[buffer(3)]],
    device float* leftAttraction [[buffer(4)]],
    device float* rightAttraction [[buffer(5)]],
    uint pairIndex [[thread_position_in_grid]]
) {
    if (pairIndex >= pairCount) return;
    const Rm1PairRotationV1 pair = pairs[pairIndex];
    const uint model = pair.model.x;
    const bool heavyIsLeft = pair.model.y != 0;
    const uint leftValence = pair.model.z;
    const uint rightValence = pair.model.w;
    const uint leftCount = pair.spans.y;
    const uint rightCount = pair.spans.w;
    const uint tensorOffset = pairIndex * 256;
    const uint attractionOffset = pairIndex * 16;
    const float distance = length(pair.delta.xyz);
    float localIntegrals[22] = {0.0f};
    generate_local_integrals(model, pairParameters[pairIndex], distance, localIntegrals);
    const float3 axis = heavyIsLeft ? -pair.delta.xyz / distance : pair.delta.xyz / distance;
    const float3x3 rotation = rotation_matrix(axis);
    const float3 r0 = rotation[0];
    const float3 r1 = rotation[1];
    const float3 r2 = rotation[2];

    for (uint mu = 0; mu < 4; ++mu) {
        for (uint nu = 0; nu < 4; ++nu) {
            for (uint lambda = 0; lambda < 4; ++lambda) {
                for (uint sigma = 0; sigma < 4; ++sigma) {
                    float value = 0.0f;
                    if (model == 0) {
                        if ((mu | nu | lambda | sigma) == 0) value = localIntegrals[0];
                    } else if (model == 1) {
                        const uint a = heavyIsLeft ? mu : lambda;
                        const uint b = heavyIsLeft ? nu : sigma;
                        const uint h0 = heavyIsLeft ? lambda : mu;
                        const uint h1 = heavyIsLeft ? sigma : nu;
                        if (h0 == 0 && h1 == 0) {
                            if (a == 0 && b == 0) value = localIntegrals[0];
                            else if (a == 0 || b == 0) value = localIntegrals[1] * r0[max(a, b) - 1];
                            else value = localIntegrals[2] * r0[a - 1] * r0[b - 1]
                                + localIntegrals[3] * (r1[a - 1] * r1[b - 1] + r2[a - 1] * r2[b - 1]);
                        }
                    } else {
                        value = heavy_heavy_value(mu, nu, lambda, sigma,
                            localIntegrals, r0, r1, r2);
                    }
                    repulsion[tensorOffset + tensor_index(mu, nu, lambda, sigma)] = value;
                }
            }
        }
    }
    for (uint row = 0; row < 4; ++row) {
        for (uint column = 0; column < 4; ++column) {
            const uint index = attractionOffset + row * 4 + column;
            leftAttraction[index] = row < leftCount && column < leftCount
                ? -float(rightValence) * repulsion[tensorOffset + tensor_index(row, column, 0, 0)] : 0.0f;
            rightAttraction[index] = row < rightCount && column < rightCount
                ? -float(leftValence) * repulsion[tensorOffset + tensor_index(0, 0, row, column)] : 0.0f;
        }
    }
}
