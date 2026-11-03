import type { PeptideGeometryOptions } from "../molecular-workbench/peptide-geometry";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

export type PeptideBuildRequest = { sequence: string; codes: "one" | "three"; options: PeptideGeometryOptions };
/** `graph` repeats the mmCIF atoms (row order, Å), formal charges and Kekulé bonds. */
export type PeptideBuildResult = {
  cif: string; sequence: string; atomCount: number; residueCount: number; charge: number;
  graph: { atoms: { element: string; x: number; y: number; z: number; charge: number }[]; bonds: { a: number; b: number; order: 1 | 2 | 3 }[] };
};

/** Keeps template placement and full-graph serialization off the UI thread. */
export function runPeptideTask(request: PeptideBuildRequest, options: WorkerTaskOptions = {}): Promise<PeptideBuildResult> {
  if (request.sequence.length > 1024 || (Array.isArray(request.options.chirality) && request.options.chirality.length > 64))
    return Promise.reject(new Error("Use at most 64 amino-acid codes."));
  return runWorkerTask<PeptideBuildResult>(() => new Worker(new URL("./peptide-worker.ts", import.meta.url), { type: "module" }), request, options);
}
