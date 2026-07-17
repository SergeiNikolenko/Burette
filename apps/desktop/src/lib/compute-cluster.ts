import { invoke } from "@tauri-apps/api/core";

const FINGERPRINT_WORKER_TIMEOUT_MS = 120_000;

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
  const request = {
    schemaVersion: "burrete.compute-job.v1",
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
      backendPolicy: "gpuPreferred",
      schedulingPolicy: "throughput",
    },
    limits: {
      maxEdges: 100_000_000,
      maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
      maxDispatchMs: 250,
    },
  };

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
      name: "burrete-cluster-fingerprints",
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
