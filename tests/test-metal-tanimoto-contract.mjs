import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metalRoot = resolve(root, "compute/metal");
const source = readFileSync(resolve(metalRoot, "tanimoto-neighbors.v1.metal"), "utf8");
const contract = JSON.parse(readFileSync(resolve(metalRoot, "kernel-contract.v1.json"), "utf8"));
const MAX_SAFE_TERM = 2n ** 53n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;
const UINT32_MAX = 2 ** 32 - 1;
const WORDS = 64;

function fingerprint(bits) {
  const words = Array(WORDS).fill(0);
  for (const bit of bits) words[Math.floor(bit / 32)] |= 1 << (bit % 32);
  return words.map((word) => word >>> 0);
}

function popcount32(value) {
  let word = value >>> 0;
  let count = 0;
  while (word !== 0) {
    word &= word - 1;
    count += 1;
  }
  return count;
}

function validateInputs(fingerprints, cutoff, rowTile, columnTile) {
  assert.ok(Number.isSafeInteger(cutoff.numerator) && cutoff.numerator >= 0);
  assert.ok(Number.isSafeInteger(cutoff.denominator) && cutoff.denominator > 0);
  assert.ok(BigInt(cutoff.numerator) <= MAX_SAFE_TERM);
  assert.ok(BigInt(cutoff.denominator) <= MAX_SAFE_TERM);
  assert.ok(cutoff.numerator <= cutoff.denominator);
  assert.ok(fingerprints.length <= UINT32_MAX);
  assert.ok(
    Number.isSafeInteger(rowTile) && rowTile > 0 &&
      rowTile <= contract.dispatch.maximumRowTileRecords,
  );
  assert.ok(
    Number.isSafeInteger(columnTile) && columnTile > 0 &&
      columnTile <= contract.dispatch.maximumColumnTileRecords,
  );
  assert.ok(fingerprints.every((words) => words.length === WORDS));
}

function matches(left, right, cutoff) {
  let intersection = 0n;
  let union = 0n;
  for (let word = 0; word < WORDS; word += 1) {
    intersection += BigInt(popcount32(left[word] & right[word]));
    union += BigInt(popcount32(left[word] | right[word]));
  }
  if (union === 0n) return cutoff.numerator === 0;
  return intersection * BigInt(cutoff.denominator) >= union * BigInt(cutoff.numerator);
}

function tileSchedule(count, rowTile, columnTile) {
  const tiles = [];
  for (let rowStart = 0; rowStart < count; rowStart += rowTile) {
    for (let columnStart = 0; columnStart < count; columnStart += columnTile) {
      tiles.push({
        rowStart,
        rowCount: Math.min(rowTile, count - rowStart),
        columnStart,
        columnCount: Math.min(columnTile, count - columnStart),
      });
    }
  }
  return tiles;
}

function validateSchedule(count, tiles) {
  const nextColumnByRow = Array(count).fill(0);
  for (const tile of tiles) {
    assert.ok(tile.rowCount > 0 && tile.rowCount <= contract.dispatch.maximumRowTileRecords);
    assert.ok(tile.columnCount > 0 && tile.columnCount <= contract.dispatch.maximumColumnTileRecords);
    assert.ok(tile.rowStart >= 0 && tile.rowStart + tile.rowCount <= count);
    assert.ok(tile.columnStart >= 0 && tile.columnStart + tile.columnCount <= count);
    for (let row = tile.rowStart; row < tile.rowStart + tile.rowCount; row += 1) {
      assert.equal(tile.columnStart, nextColumnByRow[row]);
      nextColumnByRow[row] += tile.columnCount;
    }
  }
  assert.deepEqual(nextColumnByRow, Array(count).fill(count));
}

function simulateKernels(fingerprints, cutoff, rowTile, columnTile) {
  validateInputs(fingerprints, cutoff, rowTile, columnTile);
  const count = fingerprints.length;
  const schedule = tileSchedule(count, rowTile, columnTile);
  validateSchedule(count, schedule);
  const degrees = Array(count).fill(0n);
  for (const tile of schedule) {
    for (let row = tile.rowStart; row < tile.rowStart + tile.rowCount; row += 1) {
      for (let column = tile.columnStart; column < tile.columnStart + tile.columnCount; column += 1) {
        if (row !== column && matches(fingerprints[row], fingerprints[column], cutoff)) {
          degrees[row] += 1n;
        }
      }
    }
  }

  const offsets = [0n];
  for (const degree of degrees) offsets.push(offsets.at(-1) + degree);
  const columns = Array(Number(offsets.at(-1))).fill(null);
  const cursors = offsets.slice(0, -1);
  const status = Array(count).fill(0);
  for (const tile of schedule) {
    for (let row = tile.rowStart; row < tile.rowStart + tile.rowCount; row += 1) {
      for (let column = tile.columnStart; column < tile.columnStart + tile.columnCount; column += 1) {
        if (row === column || !matches(fingerprints[row], fingerprints[column], cutoff)) continue;
        if (cursors[row] < offsets[row + 1]) columns[Number(cursors[row])] = BigInt(column);
        else status[row] = 1;
        cursors[row] += 1n;
      }
    }
  }
  assert.deepEqual(status, Array(count).fill(0));
  assert.deepEqual(cursors, offsets.slice(1));
  return { degrees, offsets, columns };
}

assert.equal(contract.schemaVersion, "burrete.compute.metal-kernel-contract.v1");
assert.equal(contract.fingerprint.bits, 2048);
assert.equal(contract.fingerprint.wordType, "uint32");
assert.equal(contract.fingerprint.wordsPerRecord, WORDS);
assert.equal(contract.fingerprint.rowStrideBytes, 256);
assert.equal(contract.fingerprint.bitOrderWithinWord, "leastSignificantBitFirst");
assert.equal(contract.dispatch.fullPairMatrix, false);
assert.equal(contract.dispatch.atomics, false);
assert.equal(contract.dispatch.maximumPairsPerTile, 1024 * 1024);
assert.equal(contract.dispatch.logicalTilesPartitionPairDomainExactlyOnce, true);
assert.equal(contract.dispatch.sameRowDispatchesCompleteSeriallyOnOneCommandQueue, true);
assert.equal(contract.dispatch.countAndFillUseIdenticalTileSequence, true);
assert.equal(contract.dispatch.threadsPerGrid, "tile.rowCount");
assert.equal(contract.parameterAbi.sizeBytes, 56);
assert.equal(contract.parameterAbi.alignmentBytes, 8);
assert.deepEqual(contract.parameterAbi.fields.map(({ offsetBytes }) => offsetBytes), [0, 8, 16, 24, 32, 40, 48]);
const abiBody = source.match(/struct\s+TanimotoTileV1\s*\{([^}]*)\}/u)?.[1] ?? "";
let previousField = -1;
for (const field of contract.parameterAbi.fields) {
  const fieldPosition = abiBody.search(new RegExp(`ulong\\s+${field.name}\\s*;`, "u"));
  assert.ok(fieldPosition > previousField, `${field.name} must preserve ABI order`);
  previousField = fieldPosition;
}
const expectedBuffers = {
  burrete_tanimoto_degree_count_v1: ["fingerprints", "tile", "rowDegrees"],
  burrete_tanimoto_csr_fill_v1: [
    "fingerprints",
    "tile",
    "rowOffsets",
    "rowCursors",
    "columnIndices",
    "rowStatus",
  ],
};
for (const entrypoint of contract.entrypoints) {
  assert.match(source, new RegExp(`kernel\\s+void\\s+${entrypoint.name}\\s*\\(`, "u"));
  assert.deepEqual(entrypoint.buffers.map(({ name }) => name), expectedBuffers[entrypoint.name]);
  entrypoint.buffers.forEach((buffer, index) => {
    assert.equal(buffer.index, index);
    assert.match(source, new RegExp(`${buffer.name}\\s*\\[\\[buffer\\(${index}\\)\\]\\]`, "u"));
  });
}
assert.deepEqual(
  contract.entrypoints[1].buffers.map(({ type, alignmentBytes, access, elements }) => [
    type, alignmentBytes, access, elements,
  ]),
  [
    ["uint32", 4, "read", "recordCount * 64"],
    ["TanimotoTileV1", 8, "constant", "1"],
    ["uint64", 8, "read", "recordCount + 1"],
    ["uint64", 8, "readWrite", "recordCount"],
    ["uint64", 8, "write", "rowOffsets[recordCount]"],
    ["uint32", 4, "write", "recordCount"],
  ],
);
assert.doesNotMatch(source, /atomic_/u);
assert.match(source, /unionCount\s*==\s*0[\s\S]*cutoffNumerator\s*==\s*0/u);
assert.match(source, /intersection\s*\*\s*tile\.cutoffDenominator\s*>=/u);

const syntax = spawnSync("bash", ["-n", resolve(metalRoot, "build-metallib.sh")], {
  encoding: "utf8",
});
assert.equal(syntax.status, 0, syntax.stderr);

const metalLookup = spawnSync("xcrun", ["--sdk", "macosx", "--find", "metal"]);
const metallibLookup = spawnSync("xcrun", ["--sdk", "macosx", "--find", "metallib"]);
if (metalLookup.status === 0 && metallibLookup.status === 0) {
  const buildDirectory = mkdtempSync(resolve(tmpdir(), "burrete-metallib-"));
  try {
    const build = spawnSync(resolve(metalRoot, "build-metallib.sh"), [buildDirectory], {
      encoding: "utf8",
    });
    assert.equal(build.status, 0, build.stderr);
    const pointer = JSON.parse(readFileSync(resolve(buildDirectory, "current.json"), "utf8"));
    const generation = resolve(buildDirectory, pointer.generation);
    const metadataPath = resolve(generation, "build-metadata.v1.json");
    assert.ok(existsSync(resolve(generation, "tanimoto-neighbors.v1.air")));
    assert.ok(existsSync(resolve(generation, "tanimoto-neighbors.v1.metallib")));
    const metadataHash = createHash("sha256").update(readFileSync(metadataPath)).digest("hex");
    assert.equal(metadataHash, pointer.metadataSha256);
  } finally {
    rmSync(buildDirectory, { recursive: true, force: true });
  }
}

const zero = fingerprint([]);
const positiveZeroGraph = simulateKernels([zero, zero], { numerator: 1, denominator: 2 }, 1, 1);
assert.deepEqual(positiveZeroGraph.offsets, [0n, 0n, 0n]);
const zeroCutoffGraph = simulateKernels([zero, zero], { numerator: 0, denominator: 1 }, 2, 3);
assert.deepEqual(zeroCutoffGraph.columns, [1n, 0n]);

const left = fingerprint([0, 1, 2, 3, 4, 5, 6, 7]);
const right = fingerprint([0, 1, 2, 3, 4, 5, 6, 8, 9]);
assert.equal(matches(left, right, { numerator: 7, denominator: 10 }), true);
assert.equal(matches(left, right, { numerator: 701, denominator: 1000 }), false);
const wordBoundaries = fingerprint([31, 32, 63, 64, 2047]);
assert.deepEqual(
  [wordBoundaries[0], wordBoundaries[1], wordBoundaries[2], wordBoundaries[63]],
  [0x80000000, 0x80000001, 1, 0x80000000],
);
assert.equal(
  matches(wordBoundaries, fingerprint([31, 32, 63, 64]), { numerator: 4, denominator: 5 }),
  true,
);

const records = [
  fingerprint([0, 1, 2]),
  fingerprint([0, 1]),
  fingerprint([2, 3]),
  fingerprint([0, 1, 2]),
  zero,
];
const expected = {
  degrees: [2n, 2n, 0n, 2n, 0n],
  offsets: [0n, 2n, 4n, 4n, 6n, 6n],
  columns: [1n, 3n, 0n, 3n, 0n, 1n],
};
for (const [rowTile, columnTile] of [[1, 1], [2, 3], [3, 2], [4, 8], [8, 4]]) {
  assert.deepEqual(
    simulateKernels(records, { numerator: 1, denominator: 2 }, rowTile, columnTile),
    expected,
  );
}
const tile = (rowStart, rowCount, columnStart, columnCount) => ({
  rowStart, rowCount, columnStart, columnCount,
});
assert.throws(() => validateSchedule(2, [tile(0, 2, 0, 1)]));
assert.throws(() => validateSchedule(2, [tile(0, 2, 0, 1), tile(0, 2, 0, 1)]));
assert.throws(() => validateSchedule(2, [tile(0, 2, 1, 1), tile(0, 2, 0, 1)]));

assert.ok(2048n * MAX_SAFE_TERM <= UINT64_MAX);
assert.throws(() => simulateKernels(records, { numerator: 1, denominator: 0 }, 1, 1));
assert.throws(() => simulateKernels(records, { numerator: 2, denominator: 1 }, 1, 1));
assert.throws(() => simulateKernels(records, { numerator: Number.MAX_SAFE_INTEGER + 1, denominator: 1 }, 1, 1));
assert.throws(() => simulateKernels(records, { numerator: 1, denominator: 2 }, 1025, 1));

const metadataDirectory = mkdtempSync(resolve(tmpdir(), "burrete-metal-metadata-"));
try {
  const metadataPath = resolve(metadataDirectory, "metadata.json");
  const fakeHash = "0".repeat(64);
  const metadataRun = spawnSync(
    process.execPath,
    [resolve(metalRoot, "write-build-metadata.mjs"), metadataPath],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SOURCE_SHA256: fakeHash,
        CONTRACT_SHA256: fakeHash,
        AIR_SHA256: fakeHash,
        METALLIB_SHA256: fakeHash,
        METAL_TOOL_PATH: "/toolchain/metal",
        METAL_TOOL_SHA256: fakeHash,
        METAL_TOOL_VERSION: "Apple metal version test\nTarget test",
        METALLIB_TOOL_PATH: "/toolchain/metallib",
        METALLIB_TOOL_SHA256: fakeHash,
        SDK_PATH: "/SDKs/MacOSX.sdk",
        SDK_VERSION: "14.0",
        SDK_BUILD_VERSION: "23A344",
      },
    },
  );
  assert.equal(metadataRun.status, 0, metadataRun.stderr);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.source.sha256, fakeHash);
  assert.equal(metadata.metallib.sha256, fakeHash);
  assert.equal(metadata.compiler.version, "Apple metal version test Target test");
  assert.deepEqual(metadata.entrypoints, contract.entrypoints.map(({ name }) => name));
} finally {
  rmSync(metadataDirectory, { recursive: true, force: true });
}

console.log("Metal Tanimoto kernel contract tests passed");
