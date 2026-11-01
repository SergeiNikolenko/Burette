import type { PolymerOptions } from "../molecular-workbench/polymer";
import type { MolecularStructure } from "../molecular-workbench/molecular-graph";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

export type PolymerInput = Readonly<{ text: string; format: "mol" | "sdf" }>;
export type PolymerSettings = Omit<PolymerOptions, "tacticity"> & { tacticity?: "isotactic" | "syndiotactic" | "atactic" };
export type PolymerRequest = PolymerInput & Readonly<{ action: "build"; options: Readonly<PolymerOptions> }>;
export type PolymerResult = Readonly<{ sdf: string; atomCount: number; bondCount: number;
  sourceAtomIndices: readonly number[]; repeatIndices: readonly number[]; repeatAlternatives: readonly (0 | 1)[] }>;

/** Sample once at request preparation; every worker retry and publication reuses these bits. */
export function preparePolymerRequest(input: PolymerInput, settings: PolymerSettings): PolymerRequest {
  if (!Number.isInteger(settings.count) || settings.count < 1 || settings.count > 500) throw new Error("Use 1–500 repeat units.");
  const { tacticity, ...geometry } = settings;
  const resolved = tacticity === "atactic"
    ? { kind: tacticity, alternatives: Object.freeze(Array.from(crypto.getRandomValues(new Uint8Array(settings.count)), byte => (byte & 1) as 0 | 1)) }
    : tacticity ? { kind: tacticity } : undefined;
  return Object.freeze({ ...input, action: "build", options: Object.freeze({ ...geometry, ...(resolved ? { tacticity: Object.freeze(resolved) } : {}) }) });
}

/** One explicit MOL/SDF record, parsed and placed in a private cancellable worker. */
export function runPolymerTask<T extends PolymerRequest | (PolymerInput & { action: "source" })>(request: T, options: WorkerTaskOptions = {}): Promise<T["action"] extends "build" ? PolymerResult : MolecularStructure> {
  if (request.text.length > 2_000_000 || new TextEncoder().encode(request.text).length > 2_000_000) return Promise.reject(new Error("Polymer source exceeds 2 MB."));
  return runWorkerTask(() => new Worker(new URL("./polymer-worker.ts", import.meta.url), { type: "module" }), request, options);
}
