#include <metal_stdlib>

using namespace metal;

constant ulong kFingerprintWordCount = 64;
constant uint kMaximumTanimotoNeighbors = 64;

// The host validates these fields before dispatch. In particular:
// - recordCount fits uint32 and each tile count is at most 1,024;
// - cutoff values are normalized and at most 2^53 - 1;
// - logical tiles partition [0, N) x [0, N) exactly once;
// - columns advance contiguously for each row;
// - same-row dispatches complete serially on one command queue;
// - count and fill use the identical tile sequence.
struct TanimotoTileV1 {
    ulong recordCount;
    ulong rowStart;
    ulong rowCount;
    ulong columnStart;
    ulong columnCount;
    ulong cutoffNumerator;
    ulong cutoffDenominator;
};

// Query batches partition [0, recordCount) into bounded command buffers. Each
// output uint2 stores exact (intersection, union) counts for one source row.
struct TanimotoQueryBatchV1 {
    ulong recordCount;
    ulong rowStart;
    ulong rowCount;
};

// Produces one dense score row at a time. The host immediately feeds this
// device buffer to MPSMatrixFindTopK, so the O(N) row never crosses to CPU.
struct TanimotoScoreRowV1 {
    ulong recordCount;
    ulong rowIndex;
};

// Selects an exact Tanimoto top-K from one uint2(intersection, union) row.
// A single GPU thread owns the bounded insertion buffer, which keeps the full
// O(N) score row and all exact comparisons on Metal while returning only O(K).
struct TanimotoTopKRowV1 {
    ulong recordCount;
    ulong rowIndex;
    uint neighborCount;
    uint reserved;
};

inline bool tanimoto_matches_v1(
    device const uint* left,
    device const uint* right,
    constant TanimotoTileV1& tile
) {
    ulong intersection = 0;
    ulong unionCount = 0;
    for (ulong word = 0; word < kFingerprintWordCount; ++word) {
        const uint leftWord = left[word];
        const uint rightWord = right[word];
        intersection += static_cast<ulong>(popcount(leftWord & rightWord));
        unionCount += static_cast<ulong>(popcount(leftWord | rightWord));
    }

    if (unionCount == 0) {
        return tile.cutoffNumerator == 0;
    }
    return intersection * tile.cutoffDenominator >=
        unionCount * tile.cutoffNumerator;
}

kernel void burrete_tanimoto_degree_count_v1(
    device const uint* fingerprints [[buffer(0)]],
    constant TanimotoTileV1& tile [[buffer(1)]],
    device ulong* rowDegrees [[buffer(2)]],
    uint localRow [[thread_position_in_grid]]
) {
    if (static_cast<ulong>(localRow) >= tile.rowCount ||
        tile.rowStart >= tile.recordCount ||
        tile.columnStart >= tile.recordCount) {
        return;
    }

    const ulong row = tile.rowStart + static_cast<ulong>(localRow);
    if (row >= tile.recordCount) {
        return;
    }
    const ulong columnCount = min(
        tile.columnCount,
        tile.recordCount - tile.columnStart
    );
    const ulong columnEnd = tile.columnStart + columnCount;
    device const uint* left = fingerprints + row * kFingerprintWordCount;
    ulong matches = 0;
    for (ulong column = tile.columnStart; column < columnEnd; ++column) {
        if (column == row) {
            continue;
        }
        device const uint* right =
            fingerprints + column * kFingerprintWordCount;
        matches += tanimoto_matches_v1(left, right, tile) ? 1 : 0;
    }
    rowDegrees[row] += matches;
}

kernel void burrete_tanimoto_csr_fill_v1(
    device const uint* fingerprints [[buffer(0)]],
    constant TanimotoTileV1& tile [[buffer(1)]],
    device const ulong* rowOffsets [[buffer(2)]],
    device ulong* rowCursors [[buffer(3)]],
    device ulong* columnIndices [[buffer(4)]],
    device uint* rowStatus [[buffer(5)]],
    uint localRow [[thread_position_in_grid]]
) {
    if (static_cast<ulong>(localRow) >= tile.rowCount ||
        tile.rowStart >= tile.recordCount ||
        tile.columnStart >= tile.recordCount) {
        return;
    }

    const ulong row = tile.rowStart + static_cast<ulong>(localRow);
    if (row >= tile.recordCount) {
        return;
    }
    const ulong columnCount = min(
        tile.columnCount,
        tile.recordCount - tile.columnStart
    );
    const ulong columnEnd = tile.columnStart + columnCount;
    const ulong rowEnd = rowOffsets[row + 1];
    device const uint* left = fingerprints + row * kFingerprintWordCount;
    ulong cursor = rowCursors[row];

    for (ulong column = tile.columnStart; column < columnEnd; ++column) {
        if (column == row) {
            continue;
        }
        device const uint* right =
            fingerprints + column * kFingerprintWordCount;
        if (!tanimoto_matches_v1(left, right, tile)) {
            continue;
        }
        if (cursor < rowEnd) {
            columnIndices[cursor] = column;
        } else {
            rowStatus[row] = 1;
        }
        ++cursor;
    }
    rowCursors[row] = cursor;
}

kernel void burrete_tanimoto_query_counts_v1(
    device const uint* fingerprints [[buffer(0)]],
    constant const uint* query [[buffer(1)]],
    device uint2* counts [[buffer(2)]],
    constant TanimotoQueryBatchV1& batch [[buffer(3)]],
    uint localRow [[thread_position_in_grid]]
) {
    if (static_cast<ulong>(localRow) >= batch.rowCount ||
        batch.rowStart >= batch.recordCount) {
        return;
    }

    const ulong row = batch.rowStart + static_cast<ulong>(localRow);
    if (row >= batch.recordCount) {
        return;
    }
    device const uint* fingerprint =
        fingerprints + row * kFingerprintWordCount;
    uint intersection = 0;
    uint unionCount = 0;
    for (ulong word = 0; word < kFingerprintWordCount; ++word) {
        const uint queryWord = query[word];
        const uint fingerprintWord = fingerprint[word];
        intersection += popcount(queryWord & fingerprintWord);
        unionCount += popcount(queryWord | fingerprintWord);
    }
    counts[row] = uint2(intersection, unionCount);
}

kernel void burrete_tanimoto_score_row_v1(
    device const uint* fingerprints [[buffer(0)]],
    device float* scores [[buffer(1)]],
    constant TanimotoScoreRowV1& config [[buffer(2)]],
    uint column [[thread_position_in_grid]]
) {
    if (static_cast<ulong>(column) >= config.recordCount ||
        config.rowIndex >= config.recordCount) {
        return;
    }
    if (static_cast<ulong>(column) == config.rowIndex) {
        scores[column] = -INFINITY;
        return;
    }

    device const uint* left =
        fingerprints + config.rowIndex * kFingerprintWordCount;
    device const uint* right =
        fingerprints + static_cast<ulong>(column) * kFingerprintWordCount;
    uint intersection = 0;
    uint unionCount = 0;
    for (ulong word = 0; word < kFingerprintWordCount; ++word) {
        intersection += popcount(left[word] & right[word]);
        unionCount += popcount(left[word] | right[word]);
    }
    scores[column] = unionCount == 0
        ? 0.0f
        : static_cast<float>(intersection) / static_cast<float>(unionCount);
}

kernel void burrete_tanimoto_counts_row_v1(
    device const uint* fingerprints [[buffer(0)]],
    device uint2* counts [[buffer(1)]],
    constant TanimotoScoreRowV1& config [[buffer(2)]],
    uint column [[thread_position_in_grid]]
) {
    if (static_cast<ulong>(column) >= config.recordCount ||
        config.rowIndex >= config.recordCount) {
        return;
    }
    if (static_cast<ulong>(column) == config.rowIndex) {
        counts[column] = uint2(0, 0);
        return;
    }

    device const uint* left =
        fingerprints + config.rowIndex * kFingerprintWordCount;
    device const uint* right =
        fingerprints + static_cast<ulong>(column) * kFingerprintWordCount;
    uint intersection = 0;
    uint unionCount = 0;
    for (ulong word = 0; word < kFingerprintWordCount; ++word) {
        intersection += popcount(left[word] & right[word]);
        unionCount += popcount(left[word] | right[word]);
    }
    counts[column] = uint2(intersection, unionCount);
}

inline bool tanimoto_ranked_before_v1(
    uint candidateIntersection,
    uint candidateUnion,
    uint candidateIndex,
    uint existingIntersection,
    uint existingUnion,
    uint existingIndex
) {
    const ulong candidateCross =
        static_cast<ulong>(candidateIntersection) * existingUnion;
    const ulong existingCross =
        static_cast<ulong>(existingIntersection) * candidateUnion;
    return candidateCross > existingCross ||
        (candidateCross == existingCross && candidateIndex < existingIndex);
}

kernel void burrete_tanimoto_top_k_row_v1(
    device const uint2* counts [[buffer(0)]],
    device uint* outputIndices [[buffer(1)]],
    device float* outputSimilarities [[buffer(2)]],
    constant TanimotoTopKRowV1& config [[buffer(3)]],
    uint threadIndex [[thread_position_in_grid]]
) {
    if (threadIndex != 0 || config.rowIndex >= config.recordCount ||
        config.neighborCount == 0 ||
        config.neighborCount > kMaximumTanimotoNeighbors) {
        return;
    }

    uint selectedIndices[kMaximumTanimotoNeighbors];
    uint selectedIntersections[kMaximumTanimotoNeighbors];
    uint selectedUnions[kMaximumTanimotoNeighbors];
    uint selectedCount = 0;

    for (ulong candidate = 0; candidate < config.recordCount; ++candidate) {
        if (candidate == config.rowIndex) {
            continue;
        }
        const uint2 candidateCounts = counts[candidate];
        uint insertion = selectedCount;
        for (uint rank = 0; rank < selectedCount; ++rank) {
            if (tanimoto_ranked_before_v1(
                    candidateCounts.x,
                    candidateCounts.y,
                    static_cast<uint>(candidate),
                    selectedIntersections[rank],
                    selectedUnions[rank],
                    selectedIndices[rank])) {
                insertion = rank;
                break;
            }
        }
        if (insertion >= config.neighborCount) {
            continue;
        }
        const uint newCount = min(selectedCount + 1, config.neighborCount);
        for (uint rank = newCount - 1; rank > insertion; --rank) {
            selectedIndices[rank] = selectedIndices[rank - 1];
            selectedIntersections[rank] = selectedIntersections[rank - 1];
            selectedUnions[rank] = selectedUnions[rank - 1];
        }
        selectedIndices[insertion] = static_cast<uint>(candidate);
        selectedIntersections[insertion] = candidateCounts.x;
        selectedUnions[insertion] = candidateCounts.y;
        selectedCount = newCount;
    }

    for (uint rank = 0; rank < config.neighborCount; ++rank) {
        outputIndices[rank] = selectedIndices[rank];
        outputSimilarities[rank] = selectedUnions[rank] == 0
            ? 0.0f
            : static_cast<float>(selectedIntersections[rank]) /
                static_cast<float>(selectedUnions[rank]);
    }
}
