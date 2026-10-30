import type { MolecularAtom } from "../molecular-workbench/types";
import type { ScalarGrid } from "../molecular-workbench/scientific-types";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";
export type CubeRequest = { grid: ScalarGrid; atoms: MolecularAtom[] };

/** Bound the cloned payload; canonical validation and formatting stay off the UI thread. */
export function serializeCube(grid: ScalarGrid, atoms: MolecularAtom[], options: WorkerTaskOptions = {}): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(new DOMException("Cube export cancelled.", "AbortError"));
  if (!atoms.length || atoms.length > 10000 || grid.values.length > 1000000
    || grid.dimensions.length !== 3 || grid.origin.length !== 3 || grid.axes.length !== 3 || grid.axes.some(axis => axis.length !== 3)) return Promise.reject(new Error("Cube input exceeds browser limits."));
  const request: CubeRequest = { grid: { dimensions: grid.dimensions, origin: grid.origin, axes: grid.axes, values: new Float32Array(grid.values) },
    atoms: atoms.map(({ element, x, y, z }) => ({ element, x, y, z })) };
  return runWorkerTask(() => new Worker(new URL("./cube-worker.ts", import.meta.url), { type: "module" }), request, options);
}
