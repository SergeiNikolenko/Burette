#include <metal_stdlib>

using namespace metal;

constant uint BURRETE_DG_THREADS = 32;
constant float BURRETE_DG_MIN_CURVATURE = 1.0e-10f;

struct ConformerOptimizeConfigV1 {
    uint atomCount;
    uint conformerCount;
    uint constraintCount;
    uint maxIterations;
    uint historySize;
    uint maxLineSearchSteps;
    uint reserved0;
    uint reserved1;
    float gradientTolerance;
    float relativeStepTolerance;
    float armijoCoefficient;
    float maxStepFactor;
};

inline float reduce_sum(threadgroup float* shared, uint tid) {
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint stride = BURRETE_DG_THREADS / 2; stride > 0; stride >>= 1) {
        if (tid < stride) {
            shared[tid] += shared[tid + stride];
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
    return shared[0];
}

inline float reduce_max(threadgroup float* shared, uint tid) {
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint stride = BURRETE_DG_THREADS / 2; stride > 0; stride >>= 1) {
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
    for (uint atom = tid; atom < atomCount; atom += BURRETE_DG_THREADS) {
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
    for (uint atom = tid; atom < atomCount; atom += BURRETE_DG_THREADS) {
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
    for (uint atom = tid; atom < atomCount; atom += BURRETE_DG_THREADS) {
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
    for (uint atom = tid; atom < atomCount; atom += BURRETE_DG_THREADS) {
        values[atom] *= scale;
    }
    threadgroup_barrier(mem_flags::mem_device);
}

inline float evaluate_distance_objective(
    device const float4* positions,
    device float4* gradients,
    device const uint2* atomPairs,
    device const float2* boundsSquared,
    device const float* weights,
    uint atomCount,
    uint constraintCount,
    uint tid,
    threadgroup float* shared
) {
    float localEnergy = 0.0f;
    for (uint atom = tid; atom < atomCount; atom += BURRETE_DG_THREADS) {
        float4 gradient = float4(0.0f);
        float atomEnergy = 0.0f;
        for (uint term = 0; term < constraintCount; ++term) {
            const uint2 pair = atomPairs[term];
            const bool isLeft = pair.x == atom;
            const bool isRight = pair.y == atom;
            if (!isLeft && !isRight) {
                continue;
            }
            const float4 delta = positions[pair.x] - positions[pair.y];
            const float distanceSquared = dot(delta, delta);
            const float2 bounds = boundsSquared[term];
            const float weight = weights[term];
            float termEnergy = 0.0f;
            float derivativeScale = 0.0f;
            if (distanceSquared > bounds.y) {
                const float normalized = distanceSquared / bounds.y - 1.0f;
                termEnergy = weight * normalized * normalized;
                derivativeScale = 4.0f * weight * normalized / bounds.y;
            } else if (distanceSquared < bounds.x) {
                const float denominator = bounds.x + distanceSquared;
                const float normalized = 2.0f * bounds.x / denominator - 1.0f;
                termEnergy = weight * normalized * normalized;
                derivativeScale = 8.0f * weight * bounds.x
                    * (1.0f - 2.0f * bounds.x / denominator)
                    / (denominator * denominator);
            }
            atomEnergy += 0.5f * termEnergy;
            const float direction = isLeft ? 1.0f : -1.0f;
            gradient += (derivativeScale * direction) * delta;
        }
        gradients[atom] = gradient;
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
    for (uint atom = tid; atom < atomCount; atom += BURRETE_DG_THREADS) {
        const float4 positionScale = max(abs(positions[atom]), float4(1.0f));
        localMaximum = max(
            localMaximum,
            maximum_component(abs(gradients[atom]) * positionScale)
        );
    }
    shared[tid] = localMaximum;
    return reduce_max(shared, tid) / max(abs(energy), 1.0f);
}

kernel void burrete_conformer_optimize_v1(
    device float4* positions [[buffer(0)]],
    device const uint2* atomPairs [[buffer(1)]],
    device const float2* boundsSquared [[buffer(2)]],
    device const float* weights [[buffer(3)]],
    constant ConformerOptimizeConfigV1& config [[buffer(4)]],
    device float4* gradients [[buffer(5)]],
    device float4* directions [[buffer(6)]],
    device float4* oldPositions [[buffer(7)]],
    device float4* oldGradients [[buffer(8)]],
    device float4* historySteps [[buffer(9)]],
    device float4* historyGradientDeltas [[buffer(10)]],
    device float* inverseCurvatures [[buffer(11)]],
    device float* alphas [[buffer(12)]],
    device float* outputEnergies [[buffer(13)]],
    device float* outputScaledGradientMax [[buffer(14)]],
    device uint* outputIterations [[buffer(15)]],
    device uint* outputStatuses [[buffer(16)]],
    uint3 threadPosition [[thread_position_in_threadgroup]],
    uint3 threadsPerThreadgroup [[threads_per_threadgroup]],
    uint3 threadgroupPosition [[threadgroup_position_in_grid]]
) {
    const uint tid = threadPosition.x;
    const uint conformer = threadgroupPosition.x;
    if (threadsPerThreadgroup.x != BURRETE_DG_THREADS
        || conformer >= config.conformerCount) {
        return;
    }
    threadgroup float shared[BURRETE_DG_THREADS];
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

    float energy = evaluate_distance_objective(
        myPositions,
        myGradients,
        atomPairs,
        boundsSquared,
        weights,
        config.atomCount,
        config.constraintCount,
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

    for (uint atom = tid; atom < config.atomCount; atom += BURRETE_DG_THREADS) {
        myDirections[atom] = -myGradients[atom];
    }
    threadgroup_barrier(mem_flags::mem_device);

    if (gradientMaximum < config.gradientTolerance) {
        status = 0;
    }

    shared[tid] = 0.0f;
    for (uint atom = tid; atom < config.atomCount; atom += BURRETE_DG_THREADS) {
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
            for (uint atom = tid; atom < config.atomCount; atom += BURRETE_DG_THREADS) {
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
        for (uint atom = tid; atom < config.atomCount; atom += BURRETE_DG_THREADS) {
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
            for (uint atom = tid; atom < config.atomCount; atom += BURRETE_DG_THREADS) {
                myPositions[atom] = myOldPositions[atom] + lineStep * myDirections[atom];
            }
            threadgroup_barrier(mem_flags::mem_device);
            const float trialEnergy = evaluate_distance_objective(
                myPositions,
                myGradients,
                atomPairs,
                boundsSquared,
                weights,
                config.atomCount,
                config.constraintCount,
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
        for (uint atom = tid; atom < config.atomCount; atom += BURRETE_DG_THREADS) {
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
        for (uint atom = tid; atom < config.atomCount; atom += BURRETE_DG_THREADS) {
            const float4 step = myPositions[atom] - myOldPositions[atom];
            const float4 gradientDelta = myGradients[atom] - myOldGradients[atom];
            localCurvature += dot(step, gradientDelta);
        }
        shared[tid] = localCurvature;
        const float curvature = reduce_sum(shared, tid);
        if (isfinite(curvature) && curvature > BURRETE_DG_MIN_CURVATURE) {
            const uint slot = historyNext;
            device float4* storedStep = myHistorySteps
                + static_cast<ulong>(slot) * config.atomCount;
            device float4* storedGradientDelta = myHistoryGradientDeltas
                + static_cast<ulong>(slot) * config.atomCount;
            for (uint atom = tid; atom < config.atomCount; atom += BURRETE_DG_THREADS) {
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
