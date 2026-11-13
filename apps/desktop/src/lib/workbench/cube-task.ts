import type { MolecularAtom } from "../molecular-workbench/types";
import type { ScalarGrid } from "../molecular-workbench/scientific-types";
import { runWorkerTask, type WorkerTaskOptions } from "../molecular-workbench/worker-task";
export type CubeRequest = { grids: ScalarGrid[]; atoms: MolecularAtom[] };

/**
 * Bound the cloned payload; canonical validation and formatting stay off the UI thread.
 * Several grids become one multi-field Cube for the scene (a surface and the field colouring it).
 */
export function serializeCube(grid: ScalarGrid | readonly ScalarGrid[], atoms: MolecularAtom[], options: WorkerTaskOptions = {}): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(new DOMException("Cube export cancelled.", "AbortError"));
  const grids: readonly ScalarGrid[] = Array.isArray(grid) ? grid : [grid as ScalarGrid];
  if (!atoms.length || atoms.length > 10000 || !grids.length || grids.length > 2 || grids.some(item => item.values.length > 1000000
    || item.dimensions.length !== 3 || item.origin.length !== 3 || item.axes.length !== 3 || item.axes.some(axis => axis.length !== 3))) return Promise.reject(new Error("Cube input exceeds browser limits."));
  const request: CubeRequest = { grids: grids.map(item => ({ dimensions: item.dimensions, origin: item.origin, axes: item.axes, values: new Float32Array(item.values) })),
    atoms: atoms.map(({ element, x, y, z }) => ({ element, x, y, z })) };
  return runWorkerTask(() => new Worker(new URL("./cube-worker.ts", import.meta.url), { type: "module" }), request, options);
}
