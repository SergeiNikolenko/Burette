import type { CoordinationGeometry, MetalComplexGraph, MetalComplexOptions } from "../molecular-workbench/metal-complex";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

/** Site indices are 0-based positions in `COORDINATION_GEOMETRIES[geometry].sites`; every site holds exactly one donor. */
export type MetalComplexBuildRequest = MetalComplexOptions & Readonly<{ format: "sdf" | "mol" }>;
export type MetalComplexBuildResult = Readonly<{
  text: string; format: "sdf" | "mol"; name: string; atomCount: number;
  /** Covalent plus coordination bonds, as written to the file. */
  bondCount: number; formula: string; charge: number; coordinationNumber: number; geometry: CoordinationGeometry; graph: MetalComplexGraph;
}>;

/** Keeps placement, clash search and serialization off the UI thread. */
export function runMetalComplexTask(request: MetalComplexBuildRequest, options: WorkerTaskOptions = {}): Promise<MetalComplexBuildResult> {
  if (!Array.isArray(request.ligands) || request.ligands.length > 8) return Promise.reject(new Error("Use at most 8 ligands."));
  return runWorkerTask<MetalComplexBuildResult>(() => new Worker(new URL("./metal-complex-worker.ts", import.meta.url), { type: "module" }), request, options);
}
