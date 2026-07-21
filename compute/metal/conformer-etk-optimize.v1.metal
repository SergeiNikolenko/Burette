#include <metal_stdlib>

using namespace metal;

constant uint BURRETE_ETK_THREADS = 32;
constant float BURRETE_ETK_MIN_CURVATURE = 1.0e-10f;
constant float BURRETE_ETK_MIN_NORM_SQUARED = 1.0e-12f;

struct ConformerEtkOptimizeConfigV1 {
    uint atomCount;
    uint conformerCount;
    uint torsionCount;
    uint improperCount;
    uint distanceCount;
    uint maxIterations;
    uint historySize;
    uint maxLineSearchSteps;
    float gradientTolerance;
    float relativeStepTolerance;
    float armijoCoefficient;
    float maxStepFactor;
};

inline float reduce_sum(threadgroup float* shared, uint tid) {
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint stride = BURRETE_ETK_THREADS / 2; stride > 0; stride >>= 1) {
        if (tid < stride) {
            shared[tid] += shared[tid + stride];
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
    return shared[0];
}

inline float reduce_max(threadgroup float* shared, uint tid) {
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint stride = BURRETE_ETK_THREADS / 2; stride > 0; stride >>= 1) {
        if (tid < stride) {
            shared[tid] = max(shared[tid], shared[tid + stride]);
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
    return shared[0];
}

inline float vector_dot(
    device const float4* left,
    device const float4* right,
    uint atomCount,
    uint tid,
    threadgroup float* shared
) {
    float value = 0.0f;
    for (uint atom = tid; atom < atomCount; atom += BURRETE_ETK_THREADS) {
        value += dot(left[atom], right[atom]);
    }
    shared[tid] = value;
    return reduce_sum(shared, tid);
}

inline float maximum_component(float4 value) {
    return max(max(value.x, value.y), max(value.z, value.w));
}

inline void copy_vector(
    device float4* destination,
    device const float4* source,
    uint atomCount,
    uint tid
) {
    for (uint atom = tid; atom < atomCount; atom += BURRETE_ETK_THREADS) {
        destination[atom] = source[atom];
    }
    threadgroup_barrier(mem_flags::mem_device);
}

inline void add_scaled(
    device float4* target,
    device const float4* source,
    float scale,
    uint atomCount,
    uint tid
) {
    for (uint atom = tid; atom < atomCount; atom += BURRETE_ETK_THREADS) {
        target[atom] += scale * source[atom];
    }
    threadgroup_barrier(mem_flags::mem_device);
}

inline void scale_vector(
    device float4* values,
    float scale,
    uint atomCount,
    uint tid
) {
    for (uint atom = tid; atom < atomCount; atom += BURRETE_ETK_THREADS) {
        values[atom] *= scale;
    }
    threadgroup_barrier(mem_flags::mem_device);
}

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

inline float evaluate_etk_objective(
    device const float4* positions,
    device float4* gradients,
    device const uint4* torsionAtoms,
    device const float* torsionCoefficients,
    device const char* torsionSigns,
    device const uint4* improperAtoms,
    device const float* improperWeights,
    device const uint2* distanceAtoms,
    device const float2* distanceBounds,
    device const float* distanceWeights,
    uint atomCount,
    uint torsionCount,
    uint improperCount,
    uint distanceCount,
    uint tid,
    threadgroup float* shared
) {
    float localEnergy = 0.0f;
    for (uint atom = tid; atom < atomCount; atom += BURRETE_ETK_THREADS) {
        float atomEnergy = 0.0f;
        float3 gradient = float3(0.0f);
        for (uint term = 0; term < torsionCount; ++term) {
            const uint4 atoms = torsionAtoms[term];
            if (atom != atoms.x && atom != atoms.y && atom != atoms.z && atom != atoms.w) continue;
            float angle = 0.0f;
            const float3 angleDerivative = dihedral_derivative(positions, atoms, atom, angle);
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
            atomEnergy += termEnergy * 0.25f;
            gradient += energyDerivative * angleDerivative;
        }
        for (uint term = 0; term < improperCount; ++term) {
            const uint4 atoms = improperAtoms[term];
            if (atom != atoms.x && atom != atoms.y && atom != atoms.z && atom != atoms.w) continue;
            float angle = 0.0f;
            const float3 angleDerivative = dihedral_derivative(positions, atoms, atom, angle);
            const float weight = improperWeights[term];
            atomEnergy += weight * (1.0f - cos(2.0f * angle)) * 0.25f;
            gradient += (2.0f * weight * sin(2.0f * angle)) * angleDerivative;
        }
        for (uint term = 0; term < distanceCount; ++term) {
            const uint2 atoms = distanceAtoms[term];
            const bool isLeft = atom == atoms.x;
            const bool isRight = atom == atoms.y;
            if (!isLeft && !isRight) continue;
            const float3 delta = positions[atoms.x].xyz - positions[atoms.y].xyz;
            const float distance = sqrt(max(dot(delta, delta), BURRETE_ETK_MIN_NORM_SQUARED));
            const float2 bounds = distanceBounds[term];
            const float violation = distance < bounds.x
                ? distance - bounds.x
                : (distance > bounds.y ? distance - bounds.y : 0.0f);
            if (violation == 0.0f) continue;
            const float weight = distanceWeights[term];
            atomEnergy += weight * violation * violation * 0.5f;
            gradient += (isLeft ? 1.0f : -1.0f)
                * (2.0f * weight * violation / distance) * delta;
        }
        gradients[atom] = float4(gradient, 0.0f);
        localEnergy += atomEnergy;
    }
    threadgroup_barrier(mem_flags::mem_device);
    shared[tid] = localEnergy;
    return reduce_sum(shared, tid);
}

inline float scaled_gradient_maximum(
    device const float4* positions,
    device const float4* gradients,
    uint atomCount,
    float energy,
    uint tid,
    threadgroup float* shared
) {
    float localMaximum = 0.0f;
    for (uint atom = tid; atom < atomCount; atom += BURRETE_ETK_THREADS) {
        const float4 positionScale = max(abs(positions[atom]), float4(1.0f));
        localMaximum = max(
            localMaximum,
            maximum_component(abs(gradients[atom]) * positionScale)
        );
    }
    shared[tid] = localMaximum;
    return reduce_max(shared, tid) / max(abs(energy), 1.0f);
}

kernel void burrete_conformer_etk_optimize_v1(
    device float4* positions [[buffer(0)]],
    device const uint4* torsionAtoms [[buffer(1)]],
    device const float* torsionCoefficients [[buffer(2)]],
    device const char* torsionSigns [[buffer(3)]],
    device const uint4* improperAtoms [[buffer(4)]],
    device const float* improperWeights [[buffer(5)]],
    device const uint2* distanceAtoms [[buffer(6)]],
    device const float2* distanceBounds [[buffer(7)]],
    device const float* distanceWeights [[buffer(8)]],
    constant ConformerEtkOptimizeConfigV1& config [[buffer(9)]],
    device float4* gradients [[buffer(10)]],
    device float4* directions [[buffer(11)]],
    device float4* oldPositions [[buffer(12)]],
    device float4* oldGradients [[buffer(13)]],
    device float4* historySteps [[buffer(14)]],
    device float4* historyGradientDeltas [[buffer(15)]],
    device float* inverseCurvatures [[buffer(16)]],
    device float* alphas [[buffer(17)]],
    device float* outputEnergies [[buffer(18)]],
    device float* outputScaledGradientMax [[buffer(19)]],
    device uint* outputIterations [[buffer(20)]],
    device uint* outputStatuses [[buffer(21)]],
    uint3 threadPosition [[thread_position_in_threadgroup]],
    uint3 threadsPerThreadgroup [[threads_per_threadgroup]],
    uint3 threadgroupPosition [[threadgroup_position_in_grid]]
) {
    const uint tid = threadPosition.x;
    const uint conformer = threadgroupPosition.x;
    if (threadsPerThreadgroup.x != BURRETE_ETK_THREADS
        || conformer >= config.conformerCount) {
        return;
    }
    threadgroup float shared[BURRETE_ETK_THREADS];
    const ulong atomOffset = static_cast<ulong>(conformer) * config.atomCount;
    const ulong historyOffset = static_cast<ulong>(conformer)
        * config.historySize * config.atomCount;
    const ulong scalarHistoryOffset = static_cast<ulong>(conformer) * config.historySize;
    device float4* myPositions = positions + atomOffset;
    device float4* myGradients = gradients + atomOffset;
    device float4* myDirections = directions + atomOffset;
    device float4* myOldPositions = oldPositions + atomOffset;
    device float4* myOldGradients = oldGradients + atomOffset;
    device float4* myHistorySteps = historySteps + historyOffset;
    device float4* myHistoryGradientDeltas = historyGradientDeltas + historyOffset;
    device float* myInverseCurvatures = inverseCurvatures + scalarHistoryOffset;
    device float* myAlphas = alphas + scalarHistoryOffset;

    float energy = evaluate_etk_objective(
        myPositions,
        myGradients,
        torsionAtoms,
        torsionCoefficients,
        torsionSigns,
        improperAtoms,
        improperWeights,
        distanceAtoms,
        distanceBounds,
        distanceWeights,
        config.atomCount,
        config.torsionCount,
        config.improperCount,
        config.distanceCount,
        tid,
        shared
    );
    float gradientMaximum = scaled_gradient_maximum(
        myPositions,
        myGradients,
        config.atomCount,
        energy,
        tid,
        shared
    );
    uint status = 3;
    uint completedIterations = 0;
    uint historyCount = 0;
    uint historyNext = 0;

    for (uint atom = tid; atom < config.atomCount; atom += BURRETE_ETK_THREADS) {
        myDirections[atom] = -myGradients[atom];
    }
    threadgroup_barrier(mem_flags::mem_device);

    if (gradientMaximum < config.gradientTolerance) {
        status = 0;
    }

    shared[tid] = 0.0f;
    for (uint atom = tid; atom < config.atomCount; atom += BURRETE_ETK_THREADS) {
        shared[tid] += dot(myPositions[atom], myPositions[atom]);
    }
    const float coordinateNorm = sqrt(reduce_sum(shared, tid));
    const float maxStep = config.maxStepFactor
        * max(coordinateNorm, static_cast<float>(config.atomCount) * 4.0f);

    for (uint iteration = 0;
         iteration < config.maxIterations && status == 3;
         ++iteration) {
        float directionNorm = sqrt(vector_dot(
            myDirections,
            myDirections,
            config.atomCount,
            tid,
            shared
        ));
        if (directionNorm > maxStep) {
            scale_vector(myDirections, maxStep / directionNorm, config.atomCount, tid);
        }
        float slope = vector_dot(
            myDirections,
            myGradients,
            config.atomCount,
            tid,
            shared
        );
        if (!isfinite(slope) || slope >= 0.0f) {
            historyCount = 0;
            historyNext = 0;
            for (uint atom = tid; atom < config.atomCount; atom += BURRETE_ETK_THREADS) {
                myDirections[atom] = -myGradients[atom];
            }
            threadgroup_barrier(mem_flags::mem_device);
            slope = -vector_dot(
                myGradients,
                myGradients,
                config.atomCount,
                tid,
                shared
            );
        }

        copy_vector(myOldPositions, myPositions, config.atomCount, tid);
        copy_vector(myOldGradients, myGradients, config.atomCount, tid);
        const float oldEnergy = energy;
        float localRelativeDirection = 0.0f;
        for (uint atom = tid; atom < config.atomCount; atom += BURRETE_ETK_THREADS) {
            const float4 ratio = abs(myDirections[atom])
                / max(abs(myOldPositions[atom]), float4(1.0f));
            localRelativeDirection = max(localRelativeDirection, maximum_component(ratio));
        }
        shared[tid] = localRelativeDirection;
        const float relativeDirection = reduce_max(shared, tid);
        if (relativeDirection == 0.0f) {
            status = 1;
            break;
        }
        const float minimumLineStep = config.relativeStepTolerance / relativeDirection;
        float lineStep = 1.0f;
        bool accepted = false;
        for (uint lineSearch = 0;
             lineSearch < config.maxLineSearchSteps && !accepted;
             ++lineSearch) {
            if (lineStep < minimumLineStep) {
                break;
            }
            for (uint atom = tid; atom < config.atomCount; atom += BURRETE_ETK_THREADS) {
                myPositions[atom] = myOldPositions[atom] + lineStep * myDirections[atom];
            }
            threadgroup_barrier(mem_flags::mem_device);
            const float trialEnergy = evaluate_etk_objective(
                myPositions,
                myGradients,
                torsionAtoms,
                torsionCoefficients,
                torsionSigns,
                improperAtoms,
                improperWeights,
                distanceAtoms,
                distanceBounds,
                distanceWeights,
                config.atomCount,
                config.torsionCount,
                config.improperCount,
                config.distanceCount,
                tid,
                shared
            );
            if (trialEnergy <= oldEnergy + config.armijoCoefficient * lineStep * slope) {
                energy = trialEnergy;
                accepted = true;
            } else {
                lineStep *= 0.5f;
            }
        }
        if (!accepted) {
            copy_vector(myPositions, myOldPositions, config.atomCount, tid);
            copy_vector(myGradients, myOldGradients, config.atomCount, tid);
            energy = oldEnergy;
            status = 2;
            break;
        }
        completedIterations = iteration + 1;

        float localRelativeStep = 0.0f;
        for (uint atom = tid; atom < config.atomCount; atom += BURRETE_ETK_THREADS) {
            const float4 step = myPositions[atom] - myOldPositions[atom];
            const float4 ratio = abs(step) / max(abs(myPositions[atom]), float4(1.0f));
            localRelativeStep = max(localRelativeStep, maximum_component(ratio));
        }
        shared[tid] = localRelativeStep;
        const float relativeStep = reduce_max(shared, tid);
        gradientMaximum = scaled_gradient_maximum(
            myPositions,
            myGradients,
            config.atomCount,
            energy,
            tid,
            shared
        );
        if (relativeStep < config.relativeStepTolerance) {
            status = 1;
            break;
        }
        if (gradientMaximum < config.gradientTolerance) {
            status = 0;
            break;
        }

        float localCurvature = 0.0f;
        for (uint atom = tid; atom < config.atomCount; atom += BURRETE_ETK_THREADS) {
            const float4 step = myPositions[atom] - myOldPositions[atom];
            const float4 gradientDelta = myGradients[atom] - myOldGradients[atom];
            localCurvature += dot(step, gradientDelta);
        }
        shared[tid] = localCurvature;
        const float curvature = reduce_sum(shared, tid);
        if (isfinite(curvature) && curvature > BURRETE_ETK_MIN_CURVATURE) {
            const uint slot = historyNext;
            device float4* storedStep = myHistorySteps
                + static_cast<ulong>(slot) * config.atomCount;
            device float4* storedGradientDelta = myHistoryGradientDeltas
                + static_cast<ulong>(slot) * config.atomCount;
            for (uint atom = tid; atom < config.atomCount; atom += BURRETE_ETK_THREADS) {
                storedStep[atom] = myPositions[atom] - myOldPositions[atom];
                storedGradientDelta[atom] = myGradients[atom] - myOldGradients[atom];
            }
            if (tid == 0) {
                myInverseCurvatures[slot] = 1.0f / curvature;
            }
            threadgroup_barrier(mem_flags::mem_device);
            historyNext = (historyNext + 1) % config.historySize;
            historyCount = min(historyCount + 1, config.historySize);
        }

        copy_vector(myDirections, myGradients, config.atomCount, tid);
        for (uint reverse = 0; reverse < historyCount; ++reverse) {
            const uint slot = (historyNext + config.historySize - 1 - reverse)
                % config.historySize;
            device const float4* storedStep = myHistorySteps
                + static_cast<ulong>(slot) * config.atomCount;
            device const float4* storedGradientDelta = myHistoryGradientDeltas
                + static_cast<ulong>(slot) * config.atomCount;
            const float alpha = myInverseCurvatures[slot] * vector_dot(
                storedStep,
                myDirections,
                config.atomCount,
                tid,
                shared
            );
            if (tid == 0) {
                myAlphas[historyCount - 1 - reverse] = alpha;
            }
            threadgroup_barrier(mem_flags::mem_device);
            add_scaled(myDirections, storedGradientDelta, -alpha, config.atomCount, tid);
        }
        if (historyCount > 0) {
            const uint newest = (historyNext + config.historySize - 1) % config.historySize;
            device const float4* newestStep = myHistorySteps
                + static_cast<ulong>(newest) * config.atomCount;
            device const float4* newestGradientDelta = myHistoryGradientDeltas
                + static_cast<ulong>(newest) * config.atomCount;
            const float numerator = vector_dot(
                newestStep,
                newestGradientDelta,
                config.atomCount,
                tid,
                shared
            );
            const float denominator = vector_dot(
                newestGradientDelta,
                newestGradientDelta,
                config.atomCount,
                tid,
                shared
            );
            if (denominator > 0.0f) {
                scale_vector(myDirections, numerator / denominator, config.atomCount, tid);
            }
        }
        for (uint chronological = 0; chronological < historyCount; ++chronological) {
            const uint slot = (historyNext + config.historySize - historyCount + chronological)
                % config.historySize;
            device const float4* storedStep = myHistorySteps
                + static_cast<ulong>(slot) * config.atomCount;
            device const float4* storedGradientDelta = myHistoryGradientDeltas
                + static_cast<ulong>(slot) * config.atomCount;
            const float beta = myInverseCurvatures[slot] * vector_dot(
                storedGradientDelta,
                myDirections,
                config.atomCount,
                tid,
                shared
            );
            add_scaled(
                myDirections,
                storedStep,
                myAlphas[chronological] - beta,
                config.atomCount,
                tid
            );
        }
        scale_vector(myDirections, -1.0f, config.atomCount, tid);
    }

    if (status == 3) {
        gradientMaximum = scaled_gradient_maximum(
            myPositions,
            myGradients,
            config.atomCount,
            energy,
            tid,
            shared
        );
    }
    if (tid == 0) {
        outputEnergies[conformer] = energy;
        outputScaledGradientMax[conformer] = gradientMaximum;
        outputIterations[conformer] = completedIterations;
        outputStatuses[conformer] = status;
    }
}
