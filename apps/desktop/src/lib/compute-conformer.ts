export type ConformerVariant = "DG" | "KDG" | "ETDG" | "ETDGv2" | "ETKDG" | "ETKDGv2" | "ETKDGv3" | "srETKDGv3";
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
};

export type ConformerSubmissionStep = {
  sessionId: string;
  conformerChunk: ConformerInputChunk | null;
  job: ConformerComputeJob | null;
  readyForExecution: boolean;
};

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
