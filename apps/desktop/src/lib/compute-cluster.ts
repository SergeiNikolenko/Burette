import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./tauri";

const FINGERPRINT_WORKER_TIMEOUT_MS = 120_000;
const MAX_PREPARED_CHEMICAL_SPACE_JOBS = 4;
const REPRESENT_POLL_INTERVAL_MS = 500;
const preparedChemicalSpaceJobs = new Map<string, Promise<PreparedChemicalSpace>>();

type PreparedChemicalSpace = {
  job: ComputeJob;
  // The fingerprint chunks stream every molecular input through the frontend
  // anyway, so the prepared job doubles as the record source for the learned
  // model worker without a second collection read.
  records: BrowserChemicalSpaceInputRecord[];
};

export type FingerprintInputFormat = "smiles" | "molblock" | "unsupportedIdcode";

export type FingerprintInputRecord = {
  ordinal: number;
  sourceRecordId: number;
  moleculeContentSha256: string;
  format: FingerprintInputFormat;
  input: string;
};

export type FingerprintInputChunk = {
  sessionId: string;
  jobId: string;
  startOrdinal: number;
  completedRecords: number;
  totalRecords: number;
  settings: {
    rdkitVersion: string;
    radius: number;
    bitCount: number;
    useChirality: boolean;
    useFeatures: boolean;
    sanitize: boolean;
  };
  records: FingerprintInputRecord[];
};

export type FingerprintOutputRecord = {
  ordinal: number;
  sourceRecordId: number;
  moleculeContentSha256: string;
  fingerprintBase64: string | null;
  error: string | null;
};

export type FingerprintChunkResult = {
  sessionId: string;
  jobId: string;
  startOrdinal: number;
  records: FingerprintOutputRecord[];
};

type ComputeStage = {
  stageId: string;
  state: string;
  effectiveBackend: string;
  gpuTimeMs?: number | null;
  hostTimeMs?: number | null;
};

type ComputeJob = {
  jobId: string;
  revision: number;
  state: string;
  stages: ComputeStage[];
};

type FingerprintExecutionStep = {
  job: ComputeJob;
  fingerprintChunk: FingerprintInputChunk | null;
  readyForCompute: boolean;
};

type ClusterExecutionStep = {
  job: ComputeJob;
  successfulRecords: number;
  failedRecords: number;
  clusterCount: number;
  readyForPublish: boolean;
};

type ClusterPublicationStep = {
  job: ComputeJob;
  artifactId: string;
  artifactManifestSha256: string;
  gridApplied: boolean;
  gridWarning: string | null;
  reportPath: string;
};

type FingerprintWorkerRequest = {
  type: "fingerprintChunk";
  requestId: string;
  chunk: FingerprintInputChunk;
};

type FingerprintWorkerResponse = {
  type: "fingerprintChunkResult";
  requestId: string;
  result?: FingerprintChunkResult;
  error?: string;
};

export type ClusterProgress = {
  phase: "queued" | "fingerprints" | "similarity" | "publishing";
  completedRecords?: number;
  totalRecords?: number;
  job: ComputeJob;
};

export type ChemicalSpaceOptions = {
  representation: ChemicalSpaceRepresentation;
  method: ChemicalSpaceMethod;
  dimensions: 2 | 3;
  neighbors: number;
  epochs: number;
  minDist: number;
  spread: number;
  learningRate: number;
  negativeSampleRate: number;
  randomSeed: number;
};

export type ChemicalSpaceRepresentation =
  | "morgan"
  | "chemberta"
  | "molformer"
  | "unimol2-84m"
  | "unimol-v1";

export type ChemicalSpaceMethod =
  | "umap"
  | "tmap"
  | "tsne"
  | "pacmap"
  | "localmap"
  | "trimap"
  | "dreams"
  | "cne"
  | "mmae";

export type ChemicalSpaceResult = {
  sourceRecordIds: number[];
  positions: Array<[number, number, number]>;
  treeEdges: Array<[number, number]>;
  neighborEdges: Array<[number, number]>;
  neighborSimilarities: number[];
  dimensions: 2 | 3;
  method: ChemicalSpaceMethod;
  representation: ChemicalSpaceRepresentation;
  neighbors: number;
  successfulRecords: number;
  failedRecords: number;
  backend: "nativeMetal";
  tanimotoGpuTimeMs: number;
  representationTimeMs?: number;
  similarityGpuTimeMs?: number;
  embeddingGpuTimeMs: number;
  layoutHostTimeMs: number;
  hostTimeMs: number;
};

export type ChemicalSpaceClusterResult = {
  sourceRecordIds: number[];
  clusterIds: number[];
  representativeSourceRecordIds: number[];
  clusterCount: number;
  similarityGpuTimeMs: number;
};

export type ChemicalSpaceProgress = {
  phase: "queued" | "fingerprints" | "representations" | "embedding" | "study";
  completedRecords?: number;
  totalRecords?: number;
  percent?: number;
  representationStage?: "preparing" | "loading" | "model" | "similarity";
  completedFrames?: number;
  totalFrames?: number;
};

export type BrowserChemicalSpaceInputRecord = Pick<
  FingerprintInputRecord,
  "sourceRecordId" | "moleculeContentSha256" | "format" | "input"
>;

export type ClusterFilteredScope = {
  kind: "filtered";
  query: { kind: "text"; text: string };
  columnFilters: Array<{
    id: string;
    filterType: "text" | "number";
    text?: string;
    min?: number;
    max?: number;
  }>;
  descriptorFilters: Array<{ id: string; min?: number; max?: number }>;
  analysisFilters: Array<{ runId: string; valueId: string; min?: number; max?: number }>;
};

export type ClusterWorkflowResult = ClusterPublicationStep & {
  backend: "nativeMetal" | "referenceCpu";
  clusterCount: number;
  successfulRecords: number;
  failedRecords: number;
};

export type ClusterRepresentativeExportResult = {
  bundlePath: string;
  reportPath: string;
  tablePath: string;
  structurePaths: string[];
  representativeCount: number;
  sdfRecordCount: number;
  smilesRecordCount: number;
  tableOnlyRecordCount: number;
  reportSha256: string;
};

export type SimilaritySearchMatch = {
  rank: number;
  sourceRecordId: number;
  intersection: number;
  union: number;
  similarity: number;
};

export type SimilaritySearchResult = {
  runId: string;
  sourceJobId: string;
  sourceArtifactId: string;
  querySourceIndex: number;
  libraryRecordCount: number;
  validRecordCount: number;
  qualifiedMatchCount: number;
  matches: SimilaritySearchMatch[];
  backend: "nativeMetal" | "referenceCpu";
  fallbackReason: string | null;
  gpuTimeMs: number | null;
  hostTimeMs: number;
  gridApplied: boolean;
  gridWarning: string | null;
};

export async function exportClusterRepresentatives(
  jobId: string,
  outputDirectory: string,
  collectionName: string,
): Promise<ClusterRepresentativeExportResult> {
  return invoke<ClusterRepresentativeExportResult>("compute_export_cluster_representatives", {
    jobId,
    outputDirectory,
    collectionName,
  });
}

export async function findSimilarMolecules(
  jobId: string,
  querySourceIndex: number,
  cutoff: number,
  topK = 50,
): Promise<SimilaritySearchResult> {
  return invoke<SimilaritySearchResult>("compute_find_similar", {
    jobId,
    request: {
      querySourceIndex,
      topK,
      minimumSimilarity: similarityCutoff(cutoff),
    },
  });
}

export async function cancelComputeJob(jobId: string): Promise<boolean> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const job = await invoke<ComputeJob>("compute_get_job", { jobId });
    if (["succeeded", "succeededWithFailures", "failed", "cancelled"].includes(job.state)) {
      return job.state === "cancelled";
    }
    try {
      await invoke("compute_cancel_job", {
        jobId,
        expectedRevision: job.revision,
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Compute cancellation did not reach a durable stage boundary.");
}

export async function runClusterWorkflow(
  documentId: string,
  sourceIndexes: number[],
  cutoff: number,
  onProgress: (progress: ClusterProgress) => void,
  filteredScope: ClusterFilteredScope | null = null,
  signal?: AbortSignal,
): Promise<ClusterWorkflowResult> {
  throwIfAborted(signal);
  const normalizedIndexes = [...new Set(sourceIndexes)]
    .filter((index) => Number.isSafeInteger(index) && index >= 0)
    .sort((left, right) => left - right);
  const cutoffFraction = similarityCutoff(cutoff);
  const request = clusterPreparationRequest(
    documentId,
    normalizedIndexes,
    cutoffFraction,
    filteredScope,
    "gpuPreferred",
  );

  let job: ComputeJob | null = null;
  const worker = new FingerprintWorkerClient();
  try {
    job = await invoke<ComputeJob>("compute_submit_job", { request });
    onProgress({ phase: "queued", job });
    throwIfAborted(signal);
    let fingerprintStep = await invoke<FingerprintExecutionStep>("compute_begin_cluster_execution", {
      jobId: job.jobId,
      expectedRevision: job.revision,
    });
    job = fingerprintStep.job;
    throwIfAborted(signal);
    while (fingerprintStep.fingerprintChunk) {
      const chunk = fingerprintStep.fingerprintChunk;
      onProgress({
        phase: "fingerprints",
        completedRecords: chunk.completedRecords,
        totalRecords: chunk.totalRecords,
        job,
      });
      const result = await worker.fingerprint(chunk, signal);
      throwIfAborted(signal);
      fingerprintStep = await invoke<FingerprintExecutionStep>("compute_submit_fingerprint_chunk", { result });
      job = fingerprintStep.job;
      throwIfAborted(signal);
    }
    if (!fingerprintStep.readyForCompute) {
      throw new Error("The fingerprint stage completed without a compute-ready result.");
    }

    onProgress({ phase: "similarity", job });
    const execution = await invoke<ClusterExecutionStep>("compute_execute_cluster", {
      jobId: job.jobId,
      expectedRevision: job.revision,
    });
    job = execution.job;
    throwIfAborted(signal);
    if (!execution.readyForPublish) {
      throw new Error("The clustering stage completed without a publishable result.");
    }

    onProgress({ phase: "publishing", job });
    const publication = await invoke<ClusterPublicationStep>("compute_publish_cluster", {
      jobId: job.jobId,
      expectedRevision: job.revision,
    });
    throwIfAborted(signal);
    const numericStage = publication.job.stages.find(
      (stage) => stage.stageId === "tanimotoNeighbors",
    );
    const backend = numericStage?.effectiveBackend === "nativeMetal" ? "nativeMetal" : "referenceCpu";
    return {
      ...publication,
      backend,
      clusterCount: execution.clusterCount,
      successfulRecords: execution.successfulRecords,
      failedRecords: execution.failedRecords,
    };
  } catch (error) {
    if (job && !["succeeded", "succeededWithFailures", "failed", "cancelled"].includes(job.state)) {
      await cancelComputeJob(job.jobId).catch(() => undefined);
    }
    throw error;
  } finally {
    worker.dispose();
  }
}

export async function runChemicalSpaceWorkflow(
  documentId: string,
  options: ChemicalSpaceOptions,
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
  scopeSourceIds: number[] | null = null,
): Promise<ChemicalSpaceResult> {
  if (options.representation !== "morgan") {
    await ensureModelRuntimeInstalled();
    const { records } = await getPreparedChemicalSpaceJob(
      documentId,
      onProgress,
      signal,
      scopeSourceIds,
    );
    throwIfAborted(signal);
    const represented = await representChemicalSpace(
      records,
      options.representation,
      onProgress,
      signal,
    );
    throwIfAborted(signal);
    onProgress({ phase: "embedding" });
    return executeLearnedChemicalSpace(records, represented, options);
  }
  const { job } = await getPreparedChemicalSpaceJob(documentId, onProgress, signal, scopeSourceIds);
  throwIfAborted(signal);
  onProgress({ phase: "embedding" });
  return executePreparedChemicalSpace(job, options);
}

export async function runChemicalSpaceClusteringWorkflow(
  documentId: string,
  cutoff: number,
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
  scopeSourceIds: number[] | null = null,
): Promise<ChemicalSpaceClusterResult> {
  const { job } = await getPreparedChemicalSpaceJob(documentId, onProgress, signal, scopeSourceIds);
  throwIfAborted(signal);
  onProgress({ phase: "embedding" });
  return invoke<ChemicalSpaceClusterResult>("compute_cluster_chemical_space", {
    jobId: job.jobId,
    expectedRevision: job.revision,
    request: {
      cutoff,
      maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
    },
  });
}

export async function runChemicalSpaceStudyWorkflow(
  documentId: string,
  frames: ChemicalSpaceOptions[],
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
  scopeSourceIds: number[] | null = null,
): Promise<ChemicalSpaceResult[]> {
  if (frames.length < 2 || frames.length > 24) {
    throw new Error("A parameter study requires between 2 and 24 frames.");
  }
  const representation = frames[0].representation;
  if (frames.some((frame) => frame.representation !== representation)) {
    throw new Error("A parameter study must use one molecular representation.");
  }
  if (representation !== "morgan") {
    await ensureModelRuntimeInstalled();
    const { records } = await getPreparedChemicalSpaceJob(
      documentId,
      onProgress,
      signal,
      scopeSourceIds,
    );
    throwIfAborted(signal);
    const represented = await representChemicalSpace(records, representation, onProgress, signal);
    const results: ChemicalSpaceResult[] = [];
    for (let index = 0; index < frames.length; index += 1) {
      throwIfAborted(signal);
      onProgress({ phase: "study", completedFrames: index, totalFrames: frames.length });
      results.push(await executeLearnedChemicalSpace(records, represented, frames[index]));
    }
    onProgress({ phase: "study", completedFrames: frames.length, totalFrames: frames.length });
    return results;
  }
  const { job } = await getPreparedChemicalSpaceJob(documentId, onProgress, signal, scopeSourceIds);
  const results: ChemicalSpaceResult[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    throwIfAborted(signal);
    onProgress({
      phase: "study",
      completedFrames: index,
      totalFrames: frames.length,
    });
    results.push(await executePreparedChemicalSpace(job, frames[index]));
  }
  onProgress({
    phase: "study",
    completedFrames: frames.length,
    totalFrames: frames.length,
  });
  return results;
}

export function invalidateChemicalSpaceFingerprintCache(documentId: string) {
  const scopePrefix = `${documentId}::scope:`;
  for (const key of [...preparedChemicalSpaceJobs.keys()]) {
    if (key !== documentId && !key.startsWith(scopePrefix)) continue;
    const pending = preparedChemicalSpaceJobs.get(key);
    preparedChemicalSpaceJobs.delete(key);
    if (pending) {
      void pending
        .then((prepared) => cancelComputeJob(prepared.job.jobId))
        .catch(() => undefined);
    }
  }
}

// A stable fingerprint of a scope's membership, used to key prepared jobs and
// completed embeddings per filtered subset.
export function chemicalSpaceScopeSignature(sourceIds: number[]): string {
  let hash = 2166136261 >>> 0;
  for (const id of sourceIds) {
    hash = Math.imul(hash ^ id, 16777619) >>> 0;
  }
  return `${sourceIds.length}-${hash.toString(16)}`;
}

function normalizedScope(scopeSourceIds: number[] | null | undefined): number[] | null {
  if (!scopeSourceIds || scopeSourceIds.length === 0) return null;
  return [...new Set(scopeSourceIds)]
    .filter((index) => Number.isSafeInteger(index) && index >= 0)
    .sort((left, right) => left - right);
}

export async function fingerprintBrowserChemicalSpaceRecords(
  records: BrowserChemicalSpaceInputRecord[],
  onProgress: (completedRecords: number, totalRecords: number) => void,
  signal?: AbortSignal,
): Promise<FingerprintOutputRecord[]> {
  if (records.length < 2 || records.length > 20_000) {
    throw new Error("Browser chemical space requires between 2 and 20000 molecular records.");
  }
  const worker = new FingerprintWorkerClient();
  const sessionId = `browser-chemical-space-${crypto.randomUUID()}`;
  const output: FingerprintOutputRecord[] = [];
  try {
    for (let start = 0; start < records.length; start += 256) {
      throwIfAborted(signal);
      const chunkRecords = records.slice(start, start + 256).map((record, offset) => ({
        ...record,
        ordinal: start + offset,
      }));
      onProgress(start, records.length);
      const result = await worker.fingerprint({
        sessionId,
        jobId: sessionId,
        startOrdinal: start,
        completedRecords: start,
        totalRecords: records.length,
        settings: {
          rdkitVersion: "2025.03.4",
          radius: 2,
          bitCount: 2_048,
          useChirality: true,
          useFeatures: false,
          sanitize: true,
        },
        records: chunkRecords,
      }, signal);
      output.push(...result.records);
    }
    onProgress(records.length, records.length);
    return output;
  } finally {
    worker.dispose();
  }
}

async function prepareChemicalSpaceJob(
  request: ReturnType<typeof clusterPreparationRequest>,
  worker: FingerprintWorkerClient,
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
): Promise<PreparedChemicalSpace> {
  throwIfAborted(signal);
  let job = await invoke<ComputeJob>("compute_submit_job", { request });
  onProgress({ phase: "queued" });
  let fingerprintStep = await invoke<FingerprintExecutionStep>("compute_begin_cluster_execution", {
    jobId: job.jobId,
    expectedRevision: job.revision,
  });
  job = fingerprintStep.job;
  const records: BrowserChemicalSpaceInputRecord[] = [];
  while (fingerprintStep.fingerprintChunk) {
    throwIfAborted(signal);
    const chunk = fingerprintStep.fingerprintChunk;
    onProgress({
      phase: "fingerprints",
      completedRecords: chunk.completedRecords,
      totalRecords: chunk.totalRecords,
    });
    for (const record of chunk.records) {
      records.push({
        sourceRecordId: record.sourceRecordId,
        moleculeContentSha256: record.moleculeContentSha256,
        format: record.format,
        input: record.input,
      });
    }
    const result = await worker.fingerprint(chunk, signal);
    fingerprintStep = await invoke<FingerprintExecutionStep>("compute_submit_fingerprint_chunk", { result });
    job = fingerprintStep.job;
  }
  if (!fingerprintStep.readyForCompute) {
    throw new Error("The fingerprint stage completed without a compute-ready result.");
  }
  return { job, records };
}

async function getPreparedChemicalSpaceJob(
  documentId: string,
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
  scopeSourceIds: number[] | null = null,
) {
  const scope = normalizedScope(scopeSourceIds);
  const cacheKey = scope
    ? `${documentId}::scope:${chemicalSpaceScopeSignature(scope)}`
    : documentId;
  const cached = preparedChemicalSpaceJobs.get(cacheKey);
  if (cached) {
    preparedChemicalSpaceJobs.delete(cacheKey);
    preparedChemicalSpaceJobs.set(cacheKey, cached);
    return cached;
  }
  const request = clusterPreparationRequest(
    documentId,
    scope ?? [],
    { numerator: 0, denominator: 1 },
    null,
    "gpuRequired",
  );
  const pending = prepareChemicalSpaceJobForDocument(request, onProgress, signal);
  preparedChemicalSpaceJobs.set(cacheKey, pending);
  trimPreparedChemicalSpaceJobs();
  void pending.catch(() => {
    if (preparedChemicalSpaceJobs.get(cacheKey) === pending) {
      preparedChemicalSpaceJobs.delete(cacheKey);
    }
  });
  return pending;
}

async function prepareChemicalSpaceJobForDocument(
  request: ReturnType<typeof clusterPreparationRequest>,
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
) {
  const worker = new FingerprintWorkerClient();
  try {
    return await prepareChemicalSpaceJob(request, worker, onProgress, signal);
  } finally {
    worker.dispose();
  }
}

function trimPreparedChemicalSpaceJobs() {
  while (preparedChemicalSpaceJobs.size > MAX_PREPARED_CHEMICAL_SPACE_JOBS) {
    const oldestKey = preparedChemicalSpaceJobs.keys().next().value;
    if (oldestKey === undefined) break;
    const pending = preparedChemicalSpaceJobs.get(oldestKey);
    preparedChemicalSpaceJobs.delete(oldestKey);
    if (pending) {
      void pending
        .then((prepared) => cancelComputeJob(prepared.job.jobId))
        .catch(() => undefined);
    }
  }
}

function executePreparedChemicalSpace(job: ComputeJob, options: ChemicalSpaceOptions) {
  const { representation, ...request } = options;
  return invoke<ChemicalSpaceResult>("compute_execute_chemical_space", {
    jobId: job.jobId,
    expectedRevision: job.revision,
    request: {
      ...request,
      maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
    },
  }).then((result) => ({ ...result, representation }));
}

export type ChemicalSpaceKnnCache = {
  neighborsPerVertex: number;
  sourceIndicesBase64: string;
  similaritiesBase64: string;
};

export type LearnedRepresentation = {
  engine: Exclude<ChemicalSpaceRepresentation, "morgan">;
  backend: "metalMps";
  sourceRecordIds: number[];
  failedRecords: number;
  dimensions: number;
  representationTimeMs: number;
  similarityGpuTimeMs: number;
  knnCache: ChemicalSpaceKnnCache;
};

export type ChemicalSpaceModelRuntimeStatus = {
  installed: boolean;
  pythonPath: string | null;
  source: "override" | "managed" | "dev" | null;
  installerAvailable: boolean;
  installHint: string;
  installSizeHint: string;
  weightsNote: string;
  installPhase: "idle" | "installing" | "completed" | "failed" | "cancelled";
  installLine: string | null;
  installError: string | null;
};

type RepresentProgress = {
  stage?: ChemicalSpaceProgress["representationStage"];
  completedRecords?: number;
  totalRecords?: number;
  percent?: number;
};

type RepresentJobStatus = {
  running: boolean;
  progress: RepresentProgress | null;
  result: LearnedRepresentation | null;
  error: string | null;
};

// The desktop app answers these through Tauri commands, browser dev through
// its vite middleware — both speak the same status shape so the panel renders
// one install flow everywhere.
export async function fetchChemicalSpaceModelRuntimeStatus(): Promise<ChemicalSpaceModelRuntimeStatus> {
  if (isTauriRuntime()) {
    return invoke<ChemicalSpaceModelRuntimeStatus>("chemical_space_model_runtime_status");
  }
  const response = await fetch("/__burette/chemical-space-model-runtime", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`The model runtime status request failed with status ${response.status}.`);
  }
  return await response.json() as ChemicalSpaceModelRuntimeStatus;
}

export async function startChemicalSpaceModelRuntimeInstall(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("chemical_space_model_runtime_install");
    return;
  }
  const response = await fetch("/__burette/chemical-space-model-runtime/install", {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`The model runtime installation failed to start (status ${response.status}).`);
  }
}

export async function cancelChemicalSpaceModelRuntimeInstall(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("chemical_space_model_runtime_cancel_install");
    return;
  }
  await fetch("/__burette/chemical-space-model-runtime/cancel-install", { method: "POST" })
    .catch(() => undefined);
}

async function ensureModelRuntimeInstalled(): Promise<void> {
  const status = await fetchChemicalSpaceModelRuntimeStatus();
  if (!status.installed) {
    throw representationUnavailableError(MODEL_RUNTIME_MISSING_MESSAGE);
  }
}

async function representChemicalSpace(
  records: BrowserChemicalSpaceInputRecord[],
  engine: Exclude<ChemicalSpaceRepresentation, "morgan">,
  onProgress: (progress: ChemicalSpaceProgress) => void,
  signal?: AbortSignal,
): Promise<LearnedRepresentation> {
  const requestId = `represent-${crypto.randomUUID()}`;
  onProgress({ phase: "representations", completedRecords: 0, totalRecords: records.length });
  await invoke("chemical_space_represent_start", {
    requestId,
    engine,
    records: records.map((record) => ({
      sourceRecordId: record.sourceRecordId,
      format: record.format,
      input: record.input,
    })),
  });
  while (true) {
    if (signal?.aborted) {
      await invoke("chemical_space_represent_cancel", { requestId }).catch(() => undefined);
      throwIfAborted(signal);
    }
    const status = await invoke<RepresentJobStatus>("chemical_space_represent_status", {
      requestId,
    });
    if (status.progress) {
      onProgress({
        phase: "representations",
        representationStage: status.progress.stage,
        completedRecords: status.progress.completedRecords,
        totalRecords: status.progress.totalRecords,
        percent: status.progress.percent,
      });
    }
    if (!status.running) {
      if (status.error) throw new Error(status.error);
      const result = status.result;
      if (!result) throw new Error("The model worker returned no result.");
      if (result.backend !== "metalMps" || result.engine !== engine) {
        throw new Error("The model worker returned an unattested result.");
      }
      return result;
    }
    await delay(REPRESENT_POLL_INTERVAL_MS);
  }
}

function executeLearnedChemicalSpace(
  records: BrowserChemicalSpaceInputRecord[],
  represented: LearnedRepresentation,
  options: ChemicalSpaceOptions,
): Promise<ChemicalSpaceResult> {
  const { representation, ...request } = options;
  const failedRecords = Math.max(0, records.length - represented.sourceRecordIds.length);
  return invoke<ChemicalSpaceResult>("compute_execute_learned_chemical_space", {
    request: {
      ...request,
      maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
    },
    sourceRecordIds: represented.sourceRecordIds,
    failedRecords,
    knnCache: sliceKnnCache(
      represented.knnCache,
      represented.sourceRecordIds.length,
      options.neighbors,
    ),
  }).then((result) => ({
    ...result,
    representation,
    representationTimeMs: represented.representationTimeMs,
    similarityGpuTimeMs: represented.similarityGpuTimeMs,
  }));
}

export function sliceKnnCache(
  cache: ChemicalSpaceKnnCache,
  recordCount: number,
  requestedNeighbors: number,
): ChemicalSpaceKnnCache {
  const neighbors = Math.min(requestedNeighbors, cache.neighborsPerVertex);
  if (neighbors === cache.neighborsPerVertex) return cache;
  const source = new Uint32Array(decodeKnnBase64(cache.sourceIndicesBase64).buffer);
  const similarities = new Float32Array(decodeKnnBase64(cache.similaritiesBase64).buffer);
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
    sourceIndicesBase64: encodeKnnBase64(new Uint8Array(slicedSource.buffer)),
    similaritiesBase64: encodeKnnBase64(new Uint8Array(slicedSimilarities.buffer)),
  };
}

export function decodeKnnBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeKnnBase64(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  }
  return btoa(binary);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function clusterPreparationRequest(
  documentId: string,
  normalizedIndexes: number[],
  cutoffFraction: { numerator: number; denominator: number },
  filteredScope: ClusterFilteredScope | null,
  backendPolicy: "gpuPreferred" | "gpuRequired",
) {
  return {
    schemaVersion: "burette.compute-job.v1",
    workflowTemplate: "cluster.v1",
    source: {
      documentId,
      scope: normalizedIndexes.length > 0
        ? { kind: "selected", sourceIndexes: normalizedIndexes }
        : filteredScope ?? { kind: "all" },
    },
    parameters: {
      fingerprint: {
        algorithm: "rdkitMorganBit.v1",
        rdkitVersion: "2025.03.4",
        radius: 2,
        bitCount: 2_048,
        useChirality: true,
        useFeatures: false,
        sanitize: true,
        inputOrder: "sourceRecord",
      },
      similarity: { cutoff: cutoffFraction },
      representativePolicy: "butinaMaxNeighbors.v1",
    },
    executionPolicy: {
      backendPolicy,
      schedulingPolicy: "throughput",
    },
    limits: {
      maxEdges: 100_000_000,
      maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
      maxDispatchMs: 250,
    },
  };
}

// Learned representations run through the managed Python model runtime. When
// it is missing, the panel turns this into a dedicated state with an install
// path and a way back to Morgan instead of a dead-end Retry, so the error
// carries a stable name for that classification.
export const REPRESENTATION_UNAVAILABLE_ERROR_NAME = "RepresentationUnavailableError";
const MODEL_RUNTIME_MISSING_MESSAGE =
  "The learned-model runtime is not installed.";

export function representationUnavailableError(message: string): Error {
  const error = new Error(message);
  error.name = REPRESENTATION_UNAVAILABLE_ERROR_NAME;
  return error;
}

export function isRepresentationUnavailableError(cause: unknown): boolean {
  if (cause instanceof Error && cause.name === REPRESENTATION_UNAVAILABLE_ERROR_NAME) return true;
  return computeErrorMessage(cause).toLowerCase().includes("model runtime is not installed");
}

export function computeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error || "Native clustering failed.");
}

function similarityCutoff(value: number) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.7;
  return { numerator: Math.round(normalized * 1_000), denominator: 1_000 };
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("Clustering cancelled by the user.");
  error.name = "AbortError";
  throw error;
}

class FingerprintWorkerClient {
  private readonly worker: Worker;
  private nextRequestId = 0;

  constructor() {
    this.worker = new Worker(new URL("../workers/cluster-fingerprint.worker.ts", import.meta.url), {
      name: "burette-cluster-fingerprints",
      type: "module",
    });
  }

  fingerprint(chunk: FingerprintInputChunk, signal?: AbortSignal): Promise<FingerprintChunkResult> {
    const requestId = `fingerprint-${++this.nextRequestId}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("RDKit fingerprint worker timed out."));
      }, FINGERPRINT_WORKER_TIMEOUT_MS);
      const onMessage = (event: MessageEvent<FingerprintWorkerResponse>) => {
        if (event.data?.requestId !== requestId) return;
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else if (event.data.result) resolve(event.data.result);
        else reject(new Error("RDKit fingerprint worker returned an empty result."));
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "RDKit fingerprint worker crashed."));
      };
      const onAbort = () => {
        cleanup();
        const error = new Error("Clustering cancelled by the user.");
        error.name = "AbortError";
        reject(error);
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      const request: FingerprintWorkerRequest = { type: "fingerprintChunk", requestId, chunk };
      this.worker.postMessage(request);
    });
  }

  dispose() {
    this.worker.terminate();
  }
}
