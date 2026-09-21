#include <metal_stdlib>

using namespace metal;

constant uint kRm1EigenMaximumOrder = 32;
constant uint kRm1EigenMatrixStride = 1024;
constant uint kRm1EigenValueStride = 32;

kernel void burette_rm1_symmetric_eigen_v1(
    device const float* inputMatrices [[buffer(0)]],
    device const uint* orders [[buffer(1)]],
    constant uint& matrixCount [[buffer(2)]],
    device float* eigenvalues [[buffer(3)]],
    device float* eigenvectors [[buffer(4)]],
    device uint* statuses [[buffer(5)]],
    uint matrixIndex [[threadgroup_position_in_grid]],
    uint lane [[thread_index_in_threadgroup]]
) {
    threadgroup float values[kRm1EigenMatrixStride];
    threadgroup float vectors[kRm1EigenMatrixStride];
    threadgroup uint pivotP;
    threadgroup uint pivotQ;
    threadgroup uint converged;
    threadgroup float pivotSine;
    threadgroup float pivotCosine;

    if (matrixIndex >= matrixCount) {
        return;
    }
    const uint order = orders[matrixIndex];
    if (order == 0 || order > kRm1EigenMaximumOrder) {
        if (lane == 0) {
            statuses[matrixIndex] = 2;
        }
        return;
    }
    const uint matrixOffset = matrixIndex * kRm1EigenMatrixStride;
    const uint valueOffset = matrixIndex * kRm1EigenValueStride;
    for (uint index = lane; index < kRm1EigenMatrixStride; index += kRm1EigenMaximumOrder) {
        values[index] = inputMatrices[matrixOffset + index];
        const uint row = index / kRm1EigenMaximumOrder;
        const uint column = index - row * kRm1EigenMaximumOrder;
        vectors[index] = row == column && row < order ? 1.0f : 0.0f;
    }
    threadgroup_barrier(mem_flags::mem_threadgroup);

    const uint maximumIterations = 64 * order * order;
    for (uint iteration = 0; iteration < maximumIterations; ++iteration) {
        if (lane == 0) {
            float maximum = 0.0f;
            uint bestP = 0;
            uint bestQ = 0;
            for (uint row = 0; row < order; ++row) {
                for (uint column = row + 1; column < order; ++column) {
                    const float candidate = abs(values[row * kRm1EigenMaximumOrder + column]);
                    if (candidate > maximum) {
                        maximum = candidate;
                        bestP = row;
                        bestQ = column;
                    }
                }
            }
            converged = maximum <= 1.0e-7f ? 1 : 0;
            pivotP = bestP;
            pivotQ = bestQ;
            if (converged == 0) {
                const float app = values[bestP * kRm1EigenMaximumOrder + bestP];
                const float aqq = values[bestQ * kRm1EigenMaximumOrder + bestQ];
                const float apq = values[bestP * kRm1EigenMaximumOrder + bestQ];
                const float angle = 0.5f * atan2(2.0f * apq, aqq - app);
                pivotSine = sin(angle);
                pivotCosine = cos(angle);
            }
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
        if (converged != 0) {
            break;
        }

        const uint p = pivotP;
        const uint q = pivotQ;
        const float sine = pivotSine;
        const float cosine = pivotCosine;
        if (lane < order && lane != p && lane != q) {
            const float aip = values[lane * kRm1EigenMaximumOrder + p];
            const float aiq = values[lane * kRm1EigenMaximumOrder + q];
            const float newP = cosine * aip - sine * aiq;
            const float newQ = sine * aip + cosine * aiq;
            values[lane * kRm1EigenMaximumOrder + p] = newP;
            values[p * kRm1EigenMaximumOrder + lane] = newP;
            values[lane * kRm1EigenMaximumOrder + q] = newQ;
            values[q * kRm1EigenMaximumOrder + lane] = newQ;
        }
        if (lane < order) {
            const float vip = vectors[lane * kRm1EigenMaximumOrder + p];
            const float viq = vectors[lane * kRm1EigenMaximumOrder + q];
            vectors[lane * kRm1EigenMaximumOrder + p] = cosine * vip - sine * viq;
            vectors[lane * kRm1EigenMaximumOrder + q] = sine * vip + cosine * viq;
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
        if (lane == 0) {
            const float app = values[p * kRm1EigenMaximumOrder + p];
            const float aqq = values[q * kRm1EigenMaximumOrder + q];
            const float apq = values[p * kRm1EigenMaximumOrder + q];
            values[p * kRm1EigenMaximumOrder + p] =
                cosine * cosine * app - 2.0f * sine * cosine * apq + sine * sine * aqq;
            values[q * kRm1EigenMaximumOrder + q] =
                sine * sine * app + 2.0f * sine * cosine * apq + cosine * cosine * aqq;
            values[p * kRm1EigenMaximumOrder + q] = 0.0f;
            values[q * kRm1EigenMaximumOrder + p] = 0.0f;
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }

    if (lane == 0) {
        if (converged == 0) {
            statuses[matrixIndex] = 1;
            return;
        }
        for (uint left = 0; left < order; ++left) {
            uint smallest = left;
            for (uint right = left + 1; right < order; ++right) {
                if (values[right * kRm1EigenMaximumOrder + right]
                    < values[smallest * kRm1EigenMaximumOrder + smallest]) {
                    smallest = right;
                }
            }
            if (smallest != left) {
                for (uint row = 0; row < order; ++row) {
                    const uint a = row * kRm1EigenMaximumOrder + left;
                    const uint b = row * kRm1EigenMaximumOrder + smallest;
                    const float temporary = vectors[a];
                    vectors[a] = vectors[b];
                    vectors[b] = temporary;
                }
                const uint a = left * kRm1EigenMaximumOrder + left;
                const uint b = smallest * kRm1EigenMaximumOrder + smallest;
                const float temporary = values[a];
                values[a] = values[b];
                values[b] = temporary;
            }
        }
        for (uint index = 0; index < order; ++index) {
            eigenvalues[valueOffset + index] = values[index * kRm1EigenMaximumOrder + index];
        }
        for (uint row = 0; row < order; ++row) {
            for (uint column = 0; column < order; ++column) {
                eigenvectors[matrixOffset + row * kRm1EigenMaximumOrder + column] =
                    vectors[row * kRm1EigenMaximumOrder + column];
            }
        }
        statuses[matrixIndex] = 0;
    }
}
