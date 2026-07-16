#include <metal_stdlib>

using namespace metal;

struct Rm1PairRotationV1 {
    uint4 spans;
    uint4 model;
    float4 delta;
};

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
    device const float* ri, float3 r0, float3 r1, float3 r2
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

kernel void burrete_rm1_pair_rotate_v1(
    device const Rm1PairRotationV1* pairs [[buffer(0)]],
    device const float* localIntegrals [[buffer(1)]],
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
    const uint localOffset = pairIndex * 22;
    const uint tensorOffset = pairIndex * 256;
    const uint attractionOffset = pairIndex * 16;
    const float distance = length(pair.delta.xyz);
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
                        if ((mu | nu | lambda | sigma) == 0) value = localIntegrals[localOffset];
                    } else if (model == 1) {
                        const uint a = heavyIsLeft ? mu : lambda;
                        const uint b = heavyIsLeft ? nu : sigma;
                        const uint h0 = heavyIsLeft ? lambda : mu;
                        const uint h1 = heavyIsLeft ? sigma : nu;
                        if (h0 == 0 && h1 == 0) {
                            if (a == 0 && b == 0) value = localIntegrals[localOffset];
                            else if (a == 0 || b == 0) value = localIntegrals[localOffset + 1] * r0[max(a, b) - 1];
                            else value = localIntegrals[localOffset + 2] * r0[a - 1] * r0[b - 1]
                                + localIntegrals[localOffset + 3] * (r1[a - 1] * r1[b - 1] + r2[a - 1] * r2[b - 1]);
                        }
                    } else {
                        value = heavy_heavy_value(mu, nu, lambda, sigma,
                            localIntegrals + localOffset, r0, r1, r2);
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
