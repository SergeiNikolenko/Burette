import assert from "node:assert/strict";
import { runBrowserDevChemicalSpace } from "../apps/desktop/src/lib/browser-dev-compute.ts";

const originalFetch = globalThis.fetch;
const records = [
  { sourceRecordId: 0, input: "CCO", format: "smiles", moleculeContentSha256: "ethanol" },
  { sourceRecordId: 1, input: "c1ccccc1", format: "smiles", moleculeContentSha256: "benzene" },
];
const options = {
  representation: "unimol-v1",
  method: "umap",
  dimensions: 2,
  neighbors: 1,
  epochs: 100,
  minDist: 0.1,
  spread: 1,
  learningRate: 1,
  negativeSampleRate: 5,
  randomSeed: 42,
};
const sourceIndices = new Uint32Array([1, 0]);
const similarities = new Float32Array([0.8, 0.8]);
const representation = {
  engine: "unimol-v1",
  backend: "metalMps",
  sourceRecordIds: [0, 1],
  failedRecords: 0,
  dimensions: 512,
  representationTimeMs: 12,
  similarityGpuTimeMs: 2,
  knnCache: {
    neighborsPerVertex: 1,
    sourceIndicesBase64: Buffer.from(sourceIndices.buffer).toString("base64"),
    similaritiesBase64: Buffer.from(similarities.buffer).toString("base64"),
  },
};
const embedding = {
  method: "umap",
  dimensions: 2,
  backend: "nativeMetal",
  positions: [[0, 0], [1, 1]],
  sourceRecordIds: [0, 1],
  failedRecords: 0,
  elapsedMs: 4,
};

let representationAttempts = 0;
let nativeComputeAttempts = 0;
globalThis.fetch = async (url) => {
  if (url === "/__burette/chemical-space-representation") {
    representationAttempts += 1;
    if (representationAttempts === 1) throw new TypeError("Failed to fetch");
    return Response.json(representation);
  }
  if (url === "/__burette/native-compute") {
    nativeComputeAttempts += 1;
    return Response.json({ provider: "nativeMetalDevBridge", result: embedding });
  }
  throw new Error(`Unexpected URL: ${url}`);
};

try {
  const result = await runBrowserDevChemicalSpace(records, options, () => {});
  assert.equal(representationAttempts, 2);
  assert.equal(nativeComputeAttempts, 1);
  assert.equal(result.representation, "unimol-v1");
  assert.deepEqual(result.positions, embedding.positions);
} finally {
  globalThis.fetch = originalFetch;
}

let persistentTransportAttempts = 0;
globalThis.fetch = async (url) => {
  if (url !== "/__burette/chemical-space-representation") {
    throw new Error(`Unexpected URL: ${url}`);
  }
  persistentTransportAttempts += 1;
  throw new TypeError("Failed to fetch");
};
try {
  await assert.rejects(
    runBrowserDevChemicalSpace(
      records,
      { ...options, representation: "unimol2-84m" },
      () => {},
    ),
    /Local Metal service is temporarily unavailable/,
  );
  assert.equal(persistentTransportAttempts, 2);
} finally {
  globalThis.fetch = originalFetch;
}

let modelErrorAttempts = 0;
globalThis.fetch = async (url) => {
  if (url !== "/__burette/chemical-space-representation") {
    throw new Error(`Unexpected URL: ${url}`);
  }
  modelErrorAttempts += 1;
  throw new Error("Metal model worker failed");
};
try {
  await assert.rejects(
    runBrowserDevChemicalSpace(
      records,
      { ...options, representation: "chemberta" },
      () => {},
    ),
    /Metal model worker failed/,
  );
  assert.equal(modelErrorAttempts, 1);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("browser representation retry test passed");
