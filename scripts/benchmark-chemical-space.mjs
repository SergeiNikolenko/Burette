#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";

import initRDKitModule from "@rdkit/rdkit";
import { csvParse } from "d3-dsv";

const METHODS = ["umap", "tsne", "pacmap", "localmap", "trimap", "dreams", "cne", "mmae"];
const EXPECTED_RDKIT_VERSION = "2025.03.4";
const DEFAULT_RECORD_COUNT = 10_000;

const options = parseArguments(process.argv.slice(2));
const inputPaths = [options.input, ...options.supplements].map((path) => resolve(path));
const runtimeRoot = resolve(options.runtimeRoot);
const backendPath = resolve(options.backend);
const outputPath = resolve(options.output);

const sources = await Promise.all(inputPaths.map(async (path) => {
  const bytes = await readFile(path);
  const rows = csvParse(bytes.toString("utf8"));
  if (!rows.columns.includes("smiles")) {
    throw new Error(`Chemical-space benchmark input ${path} must contain a smiles column.`);
  }
  return { path, bytes, rows };
}));
const availableRows = sources.flatMap((source) => source.rows);
if (availableRows.length < options.recordCount) {
  throw new Error(
    `Chemical-space benchmark requires ${options.recordCount} valid rows; inputs have ${availableRows.length} total rows.`,
  );
}
const rdkit = await initRDKitModule();
if (rdkit.version() !== EXPECTED_RDKIT_VERSION) {
  throw new Error(`RDKit ${rdkit.version()} does not match ${EXPECTED_RDKIT_VERSION}.`);
}

const fingerprintStarted = performance.now();
const records = [];
let successfulRecords = 0;
for (const row of availableRows) {
  const record = fingerprintRecord(rdkit, row.smiles, records.length);
  records.push(record);
  if (record.fingerprintBase64) successfulRecords += 1;
  if (successfulRecords === options.recordCount) break;
}
const fingerprintHostTimeMs = performance.now() - fingerprintStarted;
const failedRecords = records.length - successfulRecords;
if (successfulRecords !== options.recordCount) {
  throw new Error(
    `RDKit produced ${successfulRecords} valid fingerprints; ${options.recordCount} were requested.`,
  );
}
process.stderr.write(
  `RDKit Morgan fingerprints: ${successfulRecords} valid, ${failedRecords} rejected, in ${fingerprintHostTimeMs.toFixed(1)} ms\n`,
);

const runs = [];
for (const dimensions of options.dimensions) {
  for (const method of METHODS) {
    const request = {
      operation: "chemicalSpace",
      source: {
        title: basename(inputPaths[0]),
        extension: "fingerprints",
        text: "",
      },
      conformer: null,
      chemicalSpace: {
        options: {
          method,
          dimensions,
          neighbors: options.neighbors,
          epochs: options.epochs,
          minDist: options.minDist,
          spread: 1,
          learningRate: 1,
          negativeSampleRate: 5,
          randomSeed: 42,
          maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
        },
        records,
      },
    };
    const wallStarted = performance.now();
    const payload = await runBackend(backendPath, runtimeRoot, request);
    const processWallTimeMs = performance.now() - wallStarted;
    const result = payload?.result;
    if (payload?.provider !== "nativeMetalDevBridge" || result?.backend !== "nativeMetal") {
      throw new Error(`${method} ${dimensions}D did not return a native Metal result.`);
    }
    const run = {
      method,
      dimensions,
      successfulRecords: result.successfulRecords,
      failedRecords: result.failedRecords,
      neighbors: result.neighbors,
      tanimotoGpuTimeMs: result.tanimotoGpuTimeMs,
      embeddingGpuTimeMs: result.embeddingGpuTimeMs,
      hostTimeMs: result.hostTimeMs,
      processWallTimeMs,
    };
    runs.push(run);
    process.stderr.write(
      `${method.padEnd(8)} ${dimensions}D: Tanimoto ${run.tanimotoGpuTimeMs} ms, embedding ${run.embeddingGpuTimeMs} ms, host ${run.hostTimeMs.toFixed(1)} ms\n`,
    );
  }
}

const report = {
  schemaVersion: "burrete.chemical-space-benchmark.v1",
  generatedAt: new Date().toISOString(),
  input: {
    sources: sources.map((source) => ({
      path: source.path,
      sha256: createHash("sha256").update(source.bytes).digest("hex"),
    })),
    requestedRecords: options.recordCount,
    attemptedRecords: records.length,
  },
  fingerprint: {
    rdkitVersion: rdkit.version(),
    radius: 2,
    bitCount: 2_048,
    useChirality: true,
    useFeatures: false,
    successfulRecords,
    failedRecords,
    hostTimeMs: fingerprintHostTimeMs,
  },
  embedding: {
    backend: "nativeMetal",
    neighbors: options.neighbors,
    epochs: options.epochs,
    minDist: options.minDist,
    dimensions: options.dimensions,
    methods: METHODS,
  },
  runs,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${outputPath}\n`);

function fingerprintRecord(rdkitModule, smiles, index) {
  const identity = { sourceRecordId: index + 1 };
  let molecule = null;
  try {
    molecule = rdkitModule.get_mol(smiles);
    if (!molecule) throw new Error("RDKit rejected the molecule during sanitization.");
    const fingerprint = molecule.get_morgan_fp_as_uint8array(JSON.stringify({
      radius: 2,
      fplen: 2_048,
      useChirality: true,
      useFeatures: false,
    }));
    if (!(fingerprint instanceof Uint8Array) || fingerprint.byteLength !== 256) {
      throw new Error("RDKit returned an invalid 2,048-bit fingerprint.");
    }
    return {
      ...identity,
      fingerprintBase64: Buffer.from(fingerprint).toString("base64"),
      error: null,
    };
  } catch (error) {
    return {
      ...identity,
      fingerprintBase64: null,
      error: String(error instanceof Error ? error.message : error).slice(0, 2_048),
    };
  } finally {
    molecule?.delete();
  }
}

function runBackend(executable, runtime, request) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, ["--runtime-root", runtime], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const error = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        rejectPromise(new Error(error || `Native backend exited with ${signal || code}.`));
        return;
      }
      try {
        resolvePromise(JSON.parse(output));
      } catch (parseError) {
        rejectPromise(new Error(`Native backend returned invalid JSON: ${parseError}`));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must use --name value pairs.");
    }
    values.set(key.slice(2), value);
  }
  const input = values.get("input");
  const runtimeRoot = values.get("runtime-root");
  if (!input || !runtimeRoot) {
    throw new Error(
      "Usage: benchmark-chemical-space.mjs --input <csv> --runtime-root <ComputeMetal> [--backend <path>] [--output <path>]",
    );
  }
  const dimensions = (values.get("dimensions") || "2,3")
    .split(",")
    .map(Number);
  if (dimensions.some((value) => ![2, 3].includes(value))) {
    throw new Error("Dimensions must be 2, 3, or 2,3.");
  }
  return {
    input,
    supplements: (values.get("supplement") || "").split(",").filter(Boolean),
    runtimeRoot,
    backend: values.get("backend") || "target/debug/burrete-compute-dev-backend",
    output: values.get("output") || "build/reports/chemical-space-10k.json",
    recordCount: numericOption(values, "records", DEFAULT_RECORD_COUNT),
    neighbors: numericOption(values, "neighbors", 15),
    epochs: numericOption(values, "epochs", 500),
    minDist: numericOption(values, "min-dist", 0.1),
    dimensions,
  };
}

function numericOption(values, name, fallback) {
  const value = Number(values.get(name) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number.`);
  }
  return value;
}
