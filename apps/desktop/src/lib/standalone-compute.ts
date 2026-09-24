import { runAnalysisWorkflow } from "./compute-analysis";
import { publishConformerJob } from "./conformer-job-events";
import type { ConformerJob } from "../types";

import { invoke } from "@tauri-apps/api/core";

import {
  runConformerWorkflow,
  type ConformerInitialization,
  type ConformerVariant,
  type ConformerWorkflowResult,
  type MmffVariant,
} from "./compute-conformer";

type InlineComputeSourceRegistration = {
  documentId: string;
  sourceIndexes: number[];
  recordCount: number;
};

export type StandaloneComputeSource = {
  title: string;
  extension: string;
  text: string;
};

export type MolecularComputeOperation =
  | "generate3d"
  | "generateEnsemble"
  | "optimizeGeometry"
  | "semiempiricalRm1"
  | "alignPoses";

export type StandaloneSemiempiricalResult = {
  reportPath: string | null;
  method: string;
  rows: Array<{ converged: boolean }>;
  hostTimeMs: number;
  gpuTimeMs: number;
  backend: string;
  gridApplied: boolean;
};

export type StandaloneAlignmentResult = {
  reportPath: string | null;
  title: string;
  alignedSdf: string;
  scores: Array<{ rmsd: number; combinedSimilarity: number }>;
  gpuTimeMs: number;
  backend: string;
  gridApplied: boolean;
};

async function withInlineSource<T>(
  source: StandaloneComputeSource,
  operation: (registration: InlineComputeSourceRegistration) => Promise<T>,
) {
  const extension = source.extension.trim().replace(/^\./u, "").toLowerCase();
  const normalizedSource = extension === "mol"
    ? { ...source, extension: "sdf", text: `${source.text.trimEnd()}\n$$$$\n` }
    : source;
  const registration = await invoke<InlineComputeSourceRegistration>("compute_register_inline_source", {
    request: normalizedSource,
  });
  try {
    return await operation(registration);
  } finally {
    await invoke("grid_close_runtime", { documentId: registration.documentId }).catch(() => undefined);
  }
}

export async function runStandaloneConformerWorkflow(
  source: StandaloneComputeSource,
  onProgress: Parameters<typeof runConformerWorkflow>[2],
  options: {
    variant?: ConformerVariant;
    initialization?: ConformerInitialization;
    mmffVariant?: MmffVariant;
    conformersPerMolecule?: number;
    job?: ConformerJob;
  } = {},
): Promise<ConformerWorkflowResult> {
  let job: ConformerJob = options.job ?? {
    id: crypto.randomUUID(),
    title: options.initialization === "inputGeometry" ? "Optimize geometry" : "Generate 3D",
    operation: options.initialization === "inputGeometry" ? "grid-optimize" : "grid-generate",
    inputTitle: source.title,
    status: "running",
    startedAt: Date.now(),
    progress: "Preparing molecular constraints…",
    backend: "nativeMetal",
    cancelable: false,
  };
  const update = (patch: Partial<ConformerJob>) => {
    job = { ...job, ...patch };
    publishConformerJob(job);
  };
  update({});
  try {
    const result = await withInlineSource(source, ({ documentId, sourceIndexes }) => runConformerWorkflow(
      documentId,
      sourceIndexes,
      (phase, snapshot) => {
        const labels = {
          extracting: "Preparing molecular constraints…",
          embedding: "Building and optimizing geometry…",
          stereo: "Validating stereochemistry…",
          validation: "Checking reference parity…",
          publishing: "Saving conformers…",
        };
        update({ durableJobId: snapshot.jobId, cancelable: true, progress: labels[phase] });
        onProgress(phase, snapshot);
      },
      {
        backendPolicy: "gpuRequired",
        variant: options.variant ?? "ETKDGv3",
        initialization: options.initialization ?? "generated",
        mmffVariant: options.mmffVariant ?? "MMFF94s",
        conformersPerMolecule: options.conformersPerMolecule ?? 1,
      },
    ));
    update({
      backend: result.backend,
      status: !result.passedCount ? "failed" : result.failedCount || result.failedSourceRecords ? "recovered" : "success",
      cancelable: false,
      completedAt: Date.now(),
      progress: `${result.passedCount} validated conformers; ${result.failedCount} failed${result.failedSourceRecords ? `; ${result.failedSourceRecords} input molecules failed` : ""}`,
      primaryOpenPath: result.primaryOpenPath,
      reportPath: result.reportPath,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = error instanceof Error && error.name === "AbortError";
    update({ status: cancelled ? "cancelled" : "failed", completedAt: Date.now(), cancelable: false, progress: cancelled ? "Generation cancelled" : "Generation failed", error: message });
    throw error;
  }
}

export function runStandaloneSemiempirical(
  source: StandaloneComputeSource,
  method = "RM1",
): Promise<StandaloneSemiempiricalResult> {
  return withInlineSource(source, ({ documentId, sourceIndexes }) => runAnalysisWorkflow<StandaloneSemiempiricalResult>(
    "compute_evaluate_grid_semiempirical",
    { documentId, sourceIndexes, method }, source.title,
  ));
}

export function runStandaloneAlignment(
  source: StandaloneComputeSource,
): Promise<StandaloneAlignmentResult> {
  return withInlineSource(source, ({ documentId, sourceIndexes }) => {
    if (sourceIndexes.length < 2) {
      throw new Error("Alignment requires an SDF ensemble with at least two poses.");
    }
    return runAnalysisWorkflow<StandaloneAlignmentResult>("compute_align_grid_poses", {
        documentId,
        sourceIndexes,
        maxMemoryBytes: 2 * 1_024 * 1_024 * 1_024,
    }, source.title);
  });
}
