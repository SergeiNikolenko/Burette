#include <metal_stdlib>

using namespace metal;

constant ulong kFingerprintWordCount = 64;

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
