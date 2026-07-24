import type {
  ConformerExtractionWorkerRequest,
  ConformerExtractionWorkerResponse,
  ConformerVariant,
  MmffVariant,
} from "./compute-conformer";
import type { ConformerGenerationResult } from "./conformer-generation";
import {
  fingerprintBrowserChemicalSpaceRecords,
  type BrowserChemicalSpaceInputRecord,
  type ChemicalSpaceOptions,
  type ChemicalSpaceClusterResult,
  type ChemicalSpaceProgress,
  type ChemicalSpaceRepresentation,
  type ChemicalSpaceResult,
  type FingerprintOutputRecord,
} from "./compute-cluster";
import type { StandaloneAlignmentResult, StandaloneComputeSource, StandaloneSemiempiricalResult } from "./standalone-compute";
import { stableTextDocumentId } from "./file-export";
import type { TextFileDocument } from "../types";

type BrowserDevNativeComputeOperation = "generate3d" | "generateEnsemble" | "optimizeGeometry" | "semiempiricalRm1" | "alignPoses" | "chemicalSpace" | "chemicalSpaceCluster";

type BrowserDevNativeComputeResponse<T> = {
  provider: "nativeMetalDevBridge";
  result: T;
};

const MAX_BROWSER_FINGERPRINT_CACHE_ENTRIES = 4;
const REPRESENTATION_FETCH_RETRY_DELAY_MS = 400;
const browserFingerprintCache = new Map<string, Promise<FingerprintOutputRecord[]>>();
const browserRepresentationCache = new Map<string, Promise<LearnedRepresentationResult>>();

type KnnCache = {
  neighborsPerVertex: number;
  sourceIndicesBase64: string;
  similaritiesBase64: string;
};

type LearnedRepresentationResult = {
  engine: Exclude<ChemicalSpaceRepresentation, "morgan">;
  backend: "metalMps";
  sourceRecordIds: number[];
  failedRecords: number;
  dimensions: number;
  representationTimeMs: number;
  similarityGpuTimeMs: number;
  knnCache: KnnCache;
};

type RepresentationProgressEvent = {
  type: "progress";
  progress: {
    stage: ChemicalSpaceProgress["representationStage"];
    completedRecords: number;
    totalRecords: number;
    percent: number;
  };
};

type RepresentationResultEvent = {
  type: "result";
  result: LearnedRepresentationResult;
};

type RepresentationErrorEvent = {
  type: "error";
  error: string;
};

export function runBrowserDevSemiempirical(
  source: StandaloneComputeSource,
): Promise<StandaloneSemiempiricalResult> {
  return runBrowserDevNativeCompute<StandaloneSemiempiricalResult>(source, "semiempiricalRm1")
    .then((result) => {
      if (result.backend !== "nativeMetalScfHybrid") {
        throw new Error("Metal-only semi-empirical workflow rejected a non-Metal result.");
      }
      return result;
    });
}

export function runBrowserDevAlignment(
  source: StandaloneComputeSource,
): Promise<StandaloneAlignmentResult> {
  return runBrowserDevNativeCompute(source, "alignPoses");
}

export async function runBrowserDevChemicalSpace(
  records: BrowserChemicalSpaceInputRecord[],
  options: ChemicalSpaceOptions,
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
): Promise<ChemicalSpaceResult> {
  if (options.representation !== "morgan") {
    const represented = await prepareBrowserChemicalSpaceRepresentation(
      records,
      options.representation,
      onProgress,
      signal,
    );
    if (signal?.aborted) throw abortError();
    onProgress({ phase: "embedding" });
    return executeBrowserLearnedChemicalSpace(records, represented, options);
  }
  const fingerprints = await prepareBrowserChemicalSpaceFingerprints(
    records,
    onProgress,
    signal,
  );
  if (signal?.aborted) throw abortError();
  onProgress({ phase: "embedding" });
  return executeBrowserChemicalSpace(fingerprints, options);
}

export async function runBrowserDevChemicalSpaceClustering(
  records: BrowserChemicalSpaceInputRecord[],
  cutoff: number,
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
): Promise<ChemicalSpaceClusterResult> {
  const fingerprints = await prepareBrowserChemicalSpaceFingerprints(records, onProgress, signal);
  if (signal?.aborted) throw abortError();
  onProgress({ phase: "embedding" });
  return runBrowserDevNativeCompute<ChemicalSpaceClusterResult>(
    {
      title: "browser-chemical-space-clusters",
      extension: "fingerprints",
      text: "",
    },
    "chemicalSpaceCluster",
    undefined,
    undefined,
    {
      options: {
        cutoff,
        maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
      },
      records: fingerprints.map((record) => ({
        sourceRecordId: record.sourceRecordId,
        fingerprintBase64: record.fingerprintBase64,
        error: record.error,
      })),
    },
  );
}

export async function runBrowserDevChemicalSpaceStudy(
  records: BrowserChemicalSpaceInputRecord[],
  frames: ChemicalSpaceOptions[],
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
): Promise<ChemicalSpaceResult[]> {
  const representation = frames[0]?.representation ?? "morgan";
  if (frames.some((frame) => frame.representation !== representation)) {
    throw new Error("A parameter study must use one molecular representation.");
  }
  if (representation !== "morgan") {
    const represented = await prepareBrowserChemicalSpaceRepresentation(
      records,
      representation,
      onProgress,
      signal,
    );
    const results: ChemicalSpaceResult[] = [];
    for (let index = 0; index < frames.length; index += 1) {
      if (signal?.aborted) throw abortError();
      onProgress({ phase: "study", completedFrames: index, totalFrames: frames.length });
      results.push(await executeBrowserLearnedChemicalSpace(records, represented, frames[index]));
    }
    onProgress({ phase: "study", completedFrames: frames.length, totalFrames: frames.length });
    return results;
  }
  const fingerprints = await prepareBrowserChemicalSpaceFingerprints(
    records,
    onProgress,
    signal,
  );
  const results: ChemicalSpaceResult[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    if (signal?.aborted) throw abortError();
    onProgress({
      phase: "study",
      completedFrames: index,
      totalFrames: frames.length,
    });
    results.push(await executeBrowserChemicalSpace(fingerprints, frames[index]));
  }
  onProgress({
    phase: "study",
    completedFrames: frames.length,
    totalFrames: frames.length,
  });
  return results;
}

function prepareBrowserChemicalSpaceRepresentation(
  records: BrowserChemicalSpaceInputRecord[],
  engine: Exclude<ChemicalSpaceRepresentation, "morgan">,
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
) {
  const key = `${engine}:${browserFingerprintCacheKey(records)}`;
  const cached = browserRepresentationCache.get(key);
  if (cached) {
    browserRepresentationCache.delete(key);
    browserRepresentationCache.set(key, cached);
    return cached;
  }
  onProgress({ phase: "representations", completedRecords: 0, totalRecords: records.length });
  const pending = fetchRepresentationWithRetry(async () => {
    const response = await fetch("/__burette/chemical-space-representation", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ operation: "represent", engine, neighbors: 64, records }),
      signal,
    });
    if (response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
      return readRepresentationStream(response, engine, onProgress);
    }
    const payload = await response.json().catch(() => null) as
      | (LearnedRepresentationResult & { error?: unknown })
      | null;
    if (!response.ok || !payload) {
      throw new Error(
        typeof payload?.error === "string"
          ? payload.error
          : `Metal representation request failed with status ${response.status}`,
      );
    }
    if (payload.backend !== "metalMps" || payload.engine !== engine) {
      throw new Error("Metal representation worker returned an unattested result.");
    }
    onProgress({
      phase: "representations",
      completedRecords: records.length,
      totalRecords: records.length,
    });
    return payload;
  }, signal);
  browserRepresentationCache.set(key, pending);
  trimCache(browserRepresentationCache, MAX_BROWSER_FINGERPRINT_CACHE_ENTRIES);
  void pending.catch(() => {
    if (browserRepresentationCache.get(key) === pending) browserRepresentationCache.delete(key);
  });
  return pending;
}

async function fetchRepresentationWithRetry<T>(
  request: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (!(error instanceof TypeError)) throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, REPRESENTATION_FETCH_RETRY_DELAY_MS));
  if (signal?.aborted) throw abortError();
  try {
    return await request();
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error instanceof TypeError) {
      throw new Error("Local Metal service is temporarily unavailable. Retry when the browser shell is ready.");
    }
    throw error;
  }
}

async function readRepresentationStream(
  response: Response,
  engine: Exclude<ChemicalSpaceRepresentation, "morgan">,
  onProgress: (progress: ChemicalSpaceProgress) => void,
) {
  if (!response.ok || !response.body) {
    throw new Error(`Metal representation request failed with status ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: LearnedRepresentationResult | null = null;
  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as
      | RepresentationProgressEvent
      | RepresentationResultEvent
      | RepresentationErrorEvent;
    if (event.type === "progress") {
      onProgress({
        phase: "representations",
        representationStage: event.progress.stage,
        completedRecords: event.progress.completedRecords,
        totalRecords: event.progress.totalRecords,
        percent: event.progress.percent,
      });
    } else if (event.type === "result") {
      result = event.result;
    } else if (event.type === "error") {
      throw new Error(event.error);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  consumeLine(buffer);
  const resolvedResult = result as LearnedRepresentationResult | null;
  if (!resolvedResult || resolvedResult.backend !== "metalMps" || resolvedResult.engine !== engine) {
    throw new Error("Metal representation worker returned an unattested result.");
  }
  return resolvedResult;
}

function prepareBrowserChemicalSpaceFingerprints(
  records: BrowserChemicalSpaceInputRecord[],
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
) {
  const key = browserFingerprintCacheKey(records);
  const cached = browserFingerprintCache.get(key);
  if (cached) {
    browserFingerprintCache.delete(key);
    browserFingerprintCache.set(key, cached);
    return cached;
  }
  const pending = fingerprintBrowserChemicalSpaceRecords(
    records,
    (completedRecords, totalRecords) => onProgress({
      phase: "fingerprints",
      completedRecords,
      totalRecords,
    }),
    signal,
  );
  browserFingerprintCache.set(key, pending);
  trimBrowserFingerprintCache();
  void pending.catch(() => {
    if (browserFingerprintCache.get(key) === pending) {
      browserFingerprintCache.delete(key);
    }
  });
  return pending;
}

function browserFingerprintCacheKey(records: BrowserChemicalSpaceInputRecord[]) {
  return records
    .map((record) => `${record.sourceRecordId}:${record.moleculeContentSha256}:${record.format}`)
    .join("|");
}

function trimBrowserFingerprintCache() {
  while (browserFingerprintCache.size > MAX_BROWSER_FINGERPRINT_CACHE_ENTRIES) {
    const oldestKey = browserFingerprintCache.keys().next().value;
    if (oldestKey === undefined) break;
    browserFingerprintCache.delete(oldestKey);
  }
}

function executeBrowserChemicalSpace(
  fingerprints: Awaited<ReturnType<typeof fingerprintBrowserChemicalSpaceRecords>>,
  options: ChemicalSpaceOptions,
) {
  const { representation, ...embeddingOptions } = options;
  return runBrowserDevNativeCompute<ChemicalSpaceResult>(
    {
      title: "browser-chemical-space",
      extension: "fingerprints",
      text: "",
    },
    "chemicalSpace",
    undefined,
    {
      options: {
        ...embeddingOptions,
        maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
      },
      records: fingerprints.map((record) => ({
        sourceRecordId: record.sourceRecordId,
        fingerprintBase64: record.fingerprintBase64,
        error: record.error,
      })),
    },
  ).then((result) => ({ ...result, representation }));
}

async function executeBrowserLearnedChemicalSpace(
  records: BrowserChemicalSpaceInputRecord[],
  represented: LearnedRepresentationResult,
  options: ChemicalSpaceOptions,
) {
  const validIds = new Set(represented.sourceRecordIds);
  const invalidIds = records
    .map((record) => record.sourceRecordId)
    .filter((sourceRecordId) => !validIds.has(sourceRecordId));
  const { representation, ...embeddingOptions } = options;
  const result = await runBrowserDevNativeCompute<ChemicalSpaceResult>(
    { title: "browser-chemical-space", extension: "representations", text: "" },
    "chemicalSpace",
    undefined,
    {
      options: {
        ...embeddingOptions,
        maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
      },
      records: [
        ...represented.sourceRecordIds.map((sourceRecordId) => ({
          sourceRecordId,
          fingerprintBase64: zeroFingerprintBase64(),
          error: null,
        })),
        ...invalidIds.map((sourceRecordId) => ({
          sourceRecordId,
          fingerprintBase64: null,
          error: "Molecular representation failed",
        })),
      ],
      knnCache: sliceKnnCache(
        represented.knnCache,
        represented.sourceRecordIds.length,
        options.neighbors,
      ),
    },
  );
  return {
    ...result,
    representation,
    representationTimeMs: represented.representationTimeMs,
    similarityGpuTimeMs: represented.similarityGpuTimeMs,
  };
}

let cachedZeroFingerprintBase64 = "";

function zeroFingerprintBase64() {
  if (!cachedZeroFingerprintBase64) {
    cachedZeroFingerprintBase64 = encodeBase64(new Uint8Array(256));
  }
  return cachedZeroFingerprintBase64;
}

function sliceKnnCache(cache: KnnCache, recordCount: number, requestedNeighbors: number): KnnCache {
  const neighbors = Math.min(requestedNeighbors, cache.neighborsPerVertex);
  if (neighbors === cache.neighborsPerVertex) return cache;
  const source = new Uint32Array(decodeBase64(cache.sourceIndicesBase64).buffer);
  const similarities = new Float32Array(decodeBase64(cache.similaritiesBase64).buffer);
  const slicedSource = new Uint32Array(recordCount * neighbors);
  const slicedSimilarities = new Float32Array(recordCount * neighbors);
  for (let row = 0; row < recordCount; row += 1) {
    const sourceStart = row * cache.neighborsPerVertex;
    const targetStart = row * neighbors;
    slicedSource.set(source.subarray(sourceStart, sourceStart + neighbors), targetStart);
    slicedSimilarities.set(
      similarities.subarray(sourceStart, sourceStart + neighbors),
      targetStart,
    );
  }
  return {
    neighborsPerVertex: neighbors,
    sourceIndicesBase64: encodeBase64(new Uint8Array(slicedSource.buffer)),
    similaritiesBase64: encodeBase64(new Uint8Array(slicedSimilarities.buffer)),
  };
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  }
  return btoa(binary);
}

function trimCache<Key, Value>(cache: Map<Key, Value>, limit: number) {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export async function runBrowserDevMetalConformer(
  source: StandaloneComputeSource,
  options: {
    variant?: ConformerVariant;
    mmffVariant?: MmffVariant;
    mode?: "single" | "ensemble";
    optimize?: boolean;
  } = {},
): Promise<ConformerGenerationResult> {
  const variant = options.variant ?? "ETKDGv3";
  const mmffVariant = options.mmffVariant ?? "MMFF94s";
  const records = standaloneExtractionRecords(source);
  const extracted = await extractStandaloneConformers(records, variant, mmffVariant);
  const operation: BrowserDevNativeComputeOperation = options.optimize
    ? "optimizeGeometry"
    : options.mode === "ensemble" ? "generateEnsemble" : "generate3d";
  const result = await runBrowserDevNativeCompute<ConformerGenerationResult & { backend?: string }>(source, operation, {
    variant,
    mmffVariant,
    records: records.map((record, index) => ({
      template: record.format === "molblock" ? record.input : null,
      conformerBase64: arrayBufferToBase64(extracted[index]?.conformer),
      mmffBase64: arrayBufferToBase64(extracted[index]?.mmff),
    })),
  });
  if (result.backend !== "nativeMetal") {
    throw new Error("Metal-only conformer workflow rejected a non-Metal result.");
  }
  return result;
}

async function runBrowserDevNativeCompute<T>(
  source: StandaloneComputeSource,
  operation: BrowserDevNativeComputeOperation,
  conformer?: Record<string, unknown>,
  chemicalSpace?: Record<string, unknown>,
  chemicalSpaceCluster?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/__burette/native-compute", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ operation, source, conformer, chemicalSpace, chemicalSpaceCluster }),
  });
  const payload = await response.json().catch(() => null) as BrowserDevNativeComputeResponse<T> & { error?: unknown } | null;
  if (!response.ok) {
    const message = typeof payload?.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : `Native compute request failed with status ${response.status}`;
    throw new Error(message);
  }
  if (!payload || payload.provider !== "nativeMetalDevBridge" || !payload.result) {
    throw new Error("Native Metal dev backend returned an invalid response.");
  }
  return payload.result;
}

function abortError() {
  const error = new Error("Chemical-space calculation was cancelled.");
  error.name = "AbortError";
  return error;
}

function standaloneExtractionRecords(source: StandaloneComputeSource) {
  const extension = source.extension.trim().replace(/^\./u, "").toLowerCase();
  if (extension === "mol") return [{ input: source.text, format: "molblock" as const }];
  if (extension === "sdf" || extension === "sd") {
    const records = source.text.split("$$$$")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((input) => ({ input, format: "molblock" as const }));
    if (records.length) return records;
  }
  if (extension === "smi" || extension === "smiles") {
    const records = source.text.split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u)[0] || "")
      .filter(Boolean)
      .map((input) => ({ input, format: "smiles" as const }));
    if (records.length) return records;
  }
  throw new Error("Native Metal conformer generation accepts MOL, SDF, or SMILES input.");
}

function extractStandaloneConformers(
  records: Array<{ input: string; format: "molblock" | "smiles" }>,
  variant: ConformerVariant,
  mmffVariant: MmffVariant,
): Promise<Array<{ conformer: ArrayBuffer; mmff: ArrayBuffer }>> {
  const worker = new Worker(new URL("../workers/conformer-extract.worker.ts", import.meta.url), {
    name: "burette-browser-metal-conformer-extraction",
    type: "module",
  });
  const requestId = `browser-metal-conformer-${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(() => reject(new Error("Native conformer preprocessing timed out."))), 120_000);
    const finish = (action: () => void) => {
      window.clearTimeout(timeout);
      worker.terminate();
      action();
    };
    worker.addEventListener("message", (event: MessageEvent<ConformerExtractionWorkerResponse>) => {
      if (event.data.requestId !== requestId || event.data.type !== "standaloneConformerResult") return;
      if (event.data.error) finish(() => reject(new Error(event.data.error)));
      else {
        const extracted = event.data.records;
        if (extracted?.length === records.length) finish(() => resolve(extracted));
        else finish(() => reject(new Error("Native conformer preprocessing returned an invalid record set.")));
      }
    });
    worker.addEventListener("error", (event) => finish(() => reject(new Error(event.message || "Native conformer preprocessing failed."))));
    const request: ConformerExtractionWorkerRequest = {
      type: "extractStandaloneConformers",
      requestId,
      variant,
      mmffVariant,
      records,
    };
    worker.postMessage(request);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer | undefined) {
  if (!buffer) throw new Error("Native conformer preprocessing returned an empty payload.");
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function browserDevComputeReportDocument(
  title: string,
  result: unknown,
): TextFileDocument {
  const content = `${JSON.stringify(result, null, 2)}\n`;
  const id = stableTextDocumentId(`browser-dev-compute:${title}:${content}`);
  return {
    id,
    path: `burette-compute-report://${id}/${title}`,
    title,
    extension: "json",
    language: "json",
    byteCount: new TextEncoder().encode(content).byteLength,
    content,
    truncated: false,
    modifiedAt: Date.now(),
  };
}
