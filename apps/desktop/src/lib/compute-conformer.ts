export type ConformerVariant = "DG" | "KDG" | "ETDG" | "ETDGv2" | "ETKDG" | "ETKDGv2" | "ETKDGv3" | "srETKDGv3";
export type MmffVariant = "MMFF94" | "MMFF94s";
export type ConformerInitialization = "generated" | "inputGeometry";
export type ConformerInputFormat = "molblock" | "smiles" | "unsupportedIdcode";

export type ConformerInputRecord = {
  ordinal: number;
  sourceRecordId: number;
  moleculeContentSha256: string;
  format: ConformerInputFormat;
  input: string | null;
};

export type ConformerInputChunk = {
  sessionId: string;
  startOrdinal: number;
  completedRecords: number;
  totalRecords: number;
  variant: ConformerVariant;
  mmffVariant: MmffVariant;
  maximumResultBytes: number;
  records: ConformerInputRecord[];
};

export type ConformerExtractionWorkerRequest = {
  type: "extractConformerChunk";
  requestId: string;
  chunk: ConformerInputChunk;
};

export type ConformerExtractionWorkerResponse = {
  type: "conformerChunkResult";
  requestId: string;
  result?: ArrayBuffer;
  error?: string;
};

export type ConformerComputeJob = {
  jobId: string;
  revision: number;
  state: string;
  stages?: Array<{ effectiveBackend?: string }>;
};

export type ConformerSubmissionStep = {
  sessionId: string;
  conformerChunk: ConformerInputChunk | null;
  job: ConformerComputeJob | null;
  readyForExecution: boolean;
};

export type ConformerDistanceExecutionStep = {
  job: ConformerComputeJob;
  conformerCount: number;
  failedSourceRecords: number;
  readyForStereo: boolean;
};

export type ConformerStereoExecutionStep = {
  job: ConformerComputeJob;
  conformerCount: number;
  passedCount: number;
  failedCount: number;
  readyForValidation: boolean;
};

export type ConformerReferenceValidationStep = {
  job: ConformerComputeJob;
  conformerCount: number;
  passedCount: number;
  failedCount: number;
  readyForPublication: boolean;
};

export type ConformerPublicationStep = {
  job: ConformerComputeJob;
  artifactId: string;
  artifactManifestSha256: string;
  gridApplied: boolean;
  gridWarning: string | null;
  primaryOpenPath: string;
  reportPath: string;
};

export type ConformerWorkflowPhase = "extracting" | "embedding" | "stereo" | "validation" | "publishing";

export type ConformerWorkflowResult = ConformerPublicationStep & {
  conformerCount: number;
  passedCount: number;
  failedCount: number;
  backend: "nativeMetal" | "referenceCpu";
};

export type ConformerWorkflowOptions = {
  variant: ConformerVariant;
  initialization: ConformerInitialization;
  mmffVariant: MmffVariant;
  conformersPerMolecule: number;
};

export function executeConformerDistance(job: ConformerComputeJob) {
  return invoke<ConformerDistanceExecutionStep>("compute_execute_conformer_distance", {
    jobId: job.jobId,
    expectedRevision: job.revision,
  });
}

export function executeConformerStereo(job: ConformerComputeJob) {
  return invoke<ConformerStereoExecutionStep>("compute_execute_conformer_stereo", {
    jobId: job.jobId,
    expectedRevision: job.revision,
  });
}

export function validateConformerReference(job: ConformerComputeJob) {
  return invoke<ConformerReferenceValidationStep>("compute_validate_conformer_reference", {
    jobId: job.jobId,
    expectedRevision: job.revision,
  });
}

export function publishConformer(job: ConformerComputeJob) {
  return invoke<ConformerPublicationStep>("compute_publish_conformer", {
    jobId: job.jobId,
    expectedRevision: job.revision,
  });
}

export async function runConformerWorkflow(
  documentId: string,
  sourceIndexes: number[],
  onProgress: (phase: ConformerWorkflowPhase, job: ConformerComputeJob) => void,
  options: ConformerWorkflowOptions = {
    variant: "ETKDGv3",
    initialization: "generated",
    mmffVariant: "MMFF94s",
    conformersPerMolecule: 16,
  },
): Promise<ConformerWorkflowResult> {
  const normalizedIndexes = [...new Set(sourceIndexes)]
    .filter((index) => Number.isSafeInteger(index) && index >= 0)
    .sort((left, right) => left - right);
  if (!documentId.trim() || normalizedIndexes.length === 0) {
    throw new Error("Native conformer generation requires a Grid document and selected molecules.");
  }
  const request = {
    schemaVersion: "burrete.compute-job.v1",
    workflowTemplate: "conformer.v1",
    source: {
      documentId,
      scope: { kind: "selected", sourceIndexes: normalizedIndexes },
    },
    parameters: {
      variant: options.variant,
      initialization: options.initialization,
      mmffVariant: options.mmffVariant,
      conformersPerMolecule: options.conformersPerMolecule,
      maxAttemptsPerConformer: 32,
    },
    executionPolicy: {
      backendPolicy: "gpuPreferred",
      schedulingPolicy: "throughput",
    },
    limits: {
      maxMemoryBytes: 4 * 1_024 * 1_024 * 1_024,
      maxDispatchMs: 250,
      maxConformersPerBatch: 2_048,
    },
  };
  let job: ConformerComputeJob | null = null;
  try {
    job = await prepareConformerJob(request, (step) => {
      if (step.job) job = step.job;
      if (job) onProgress("extracting", job);
    });
    onProgress("embedding", job);
    const distance = await executeConformerDistance(job);
    job = distance.job;
    onProgress("stereo", job);
    const stereo = await executeConformerStereo(job);
    job = stereo.job;
    onProgress("validation", job);
    const validation = await validateConformerReference(job);
    job = validation.job;
    onProgress("publishing", job);
    const publication = await publishConformer(job);
    const numericStages = publication.job.stages ?? [];
    return {
      ...publication,
      conformerCount: stereo.conformerCount,
      passedCount: validation.passedCount,
      failedCount: validation.failedCount,
      backend: numericStages.some((stage) => stage.effectiveBackend === "nativeMetal")
        ? "nativeMetal"
        : "referenceCpu",
    };
  } catch (error) {
    if (job && !["succeeded", "succeededWithFailures", "failed", "cancelled"].includes(job.state)) {
      await invoke("compute_cancel_job", {
        jobId: job.jobId,
        expectedRevision: job.revision,
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function prepareConformerJob(
  request: Record<string, unknown>,
  onProgress: (step: ConformerSubmissionStep) => void,
) {
  const worker = new ConformerExtractionWorkerClient();
  try {
    let step = await invoke<ConformerSubmissionStep>("compute_begin_conformer_submission", { request });
    onProgress(step);
    while (step.conformerChunk) {
      const envelope = await worker.extract(step.conformerChunk);
      step = await invoke<ConformerSubmissionStep>("compute_submit_conformer_chunk", envelope);
      onProgress(step);
    }
    if (!step.readyForExecution || !step.job) {
      throw new Error("Conformer extraction completed without a durable compute-ready job.");
    }
    return step.job;
  } finally {
    worker.dispose();
  }
}

class ConformerExtractionWorkerClient {
  private readonly worker = new Worker(new URL("../workers/conformer-extract.worker.ts", import.meta.url), {
    name: "burrete-conformer-extraction",
    type: "module",
  });
  private nextRequestId = 0;

  extract(chunk: ConformerInputChunk): Promise<Uint8Array> {
    const requestId = `conformer-extraction-${++this.nextRequestId}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("RDKit conformer extraction worker timed out."));
      }, EXTRACTION_TIMEOUT_MS);
      const onMessage = (event: MessageEvent<ConformerExtractionWorkerResponse>) => {
        if (event.data?.requestId !== requestId) return;
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else if (event.data.result) resolve(new Uint8Array(event.data.result));
        else reject(new Error("RDKit conformer extraction worker returned an empty result."));
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "RDKit conformer extraction worker crashed."));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      const workerRequest: ConformerExtractionWorkerRequest = {
        type: "extractConformerChunk",
        requestId,
        chunk,
      };
      this.worker.postMessage(workerRequest);
    });
  }

  dispose() {
    this.worker.terminate();
  }
}
import { invoke } from "@tauri-apps/api/core";

const EXTRACTION_TIMEOUT_MS = 120_000;
