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

export function runStandaloneConformerWorkflow(
  source: StandaloneComputeSource,
  onProgress: Parameters<typeof runConformerWorkflow>[2],
  options: {
    variant?: ConformerVariant;
    initialization?: ConformerInitialization;
    mmffVariant?: MmffVariant;
    conformersPerMolecule?: number;
  } = {},
): Promise<ConformerWorkflowResult> {
  return withInlineSource(source, ({ documentId, sourceIndexes }) => runConformerWorkflow(
    documentId,
    sourceIndexes,
    onProgress,
    {
      variant: options.variant ?? "ETKDGv3",
      initialization: options.initialization ?? "generated",
      mmffVariant: options.mmffVariant ?? "MMFF94s",
      conformersPerMolecule: options.conformersPerMolecule ?? 1,
    },
  ));
}

export function runStandaloneSemiempirical(
  source: StandaloneComputeSource,
  method = "RM1",
): Promise<StandaloneSemiempiricalResult> {
  return withInlineSource(source, ({ documentId, sourceIndexes }) => invoke<StandaloneSemiempiricalResult>(
    "compute_evaluate_grid_semiempirical",
    { request: { documentId, sourceIndexes, method } },
  ));
}

export function runStandaloneAlignment(
  source: StandaloneComputeSource,
): Promise<StandaloneAlignmentResult> {
  return withInlineSource(source, ({ documentId, sourceIndexes }) => {
    if (sourceIndexes.length < 2) {
      throw new Error("Alignment requires an SDF ensemble with at least two poses.");
    }
    return invoke<StandaloneAlignmentResult>("compute_align_grid_poses", {
      request: {
        documentId,
        sourceIndexes,
        maxMemoryBytes: 2 * 1_024 * 1_024 * 1_024,
      },
    });
  });
}
