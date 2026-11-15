import type { PolymerOptions } from "../molecular-workbench/polymer";
import type { FragmentSource } from "../molecular-workbench/fragment-source";
import type { MolecularStructure } from "../molecular-workbench/molecular-graph";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";

/** Neutral chain-end caps; each replaces the terminal leaving hydrogen of the first head or final tail. */
export const POLYMER_END_GROUPS = {
  hydrogen: null,
  methyl: { source: "smiles", smiles: "*C" },
  hydroxyl: { source: "smiles", smiles: "*O" },
  phenyl: { source: "library", id: "aromatics/phenyl" },
  "tert-butyl": { source: "library", id: "alkanes/t-butyl" },
} as const satisfies Record<string, FragmentSource | null>;
export type PolymerEndGroup = keyof typeof POLYMER_END_GROUPS;
export type PolymerEnds = Readonly<{ head: PolymerEndGroup; tail: PolymerEndGroup }>;
/** Optional MMFF94 relaxation of the complete chain, within the 256-atom browser chemistry budget. */
export const POLYMER_RELAXATION_ATOMS = 256;

export type PolymerInput = Readonly<{ text: string; format: "mol" | "sdf" }>;
export type PolymerSettings = Omit<PolymerOptions, "tacticity"> & { tacticity?: "isotactic" | "syndiotactic" | "atactic"; ends?: PolymerEnds; relax?: boolean };
export type PolymerRequest = PolymerInput & Readonly<{ action: "build"; options: Readonly<PolymerOptions>; ends?: PolymerEnds; relax?: boolean }>;
export type PolymerRelaxation = Readonly<{ forceField: "MMFF94"; initialEnergy: number; energy: number; unit: "kcal/mol"; converged: boolean }>;
export type PolymerResult = Readonly<{ sdf: string; atomCount: number; bondCount: number;
  /** Repeat-unit source row and zero-based repeat of each output atom; -1 for end-group atoms. */
  sourceAtomIndices: readonly number[]; repeatIndices: readonly number[]; repeatAlternatives: readonly (0 | 1)[]; relaxation?: PolymerRelaxation }>;

/** Sample once at request preparation; every worker retry and publication reuses these bits. */
export function preparePolymerRequest(input: PolymerInput, settings: PolymerSettings): PolymerRequest {
  if (!Number.isInteger(settings.count) || settings.count < 1 || settings.count > 500) throw new Error("Use 1–500 repeat units.");
  const { tacticity, ends, relax, ...geometry } = settings;
  const resolved = tacticity === "atactic"
    ? { kind: tacticity, alternatives: Object.freeze(Array.from(crypto.getRandomValues(new Uint8Array(settings.count)), byte => (byte & 1) as 0 | 1)) }
    : tacticity ? { kind: tacticity } : undefined;
  return Object.freeze({ ...input, action: "build", options: Object.freeze({ ...geometry, ...(resolved ? { tacticity: Object.freeze(resolved) } : {}) }),
    ...(ends && (ends.head !== "hydrogen" || ends.tail !== "hydrogen") ? { ends: Object.freeze({ ...ends }) } : {}), ...(relax ? { relax: true } : {}) });
}

/** One explicit MOL/SDF record, parsed and placed in a private cancellable worker. */
export function runPolymerTask<T extends PolymerRequest | (PolymerInput & { action: "source" })>(request: T, options: WorkerTaskOptions = {}): Promise<T["action"] extends "build" ? PolymerResult : MolecularStructure> {
  if (request.text.length > 2_000_000 || new TextEncoder().encode(request.text).length > 2_000_000) return Promise.reject(new Error("Polymer source exceeds 2 MB."));
  return runWorkerTask(() => new Worker(new URL("./polymer-worker.ts", import.meta.url), { type: "module" }), request, { timeoutMs: 300_000, ...options });
}
