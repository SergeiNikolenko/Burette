import type { MolecularStructure, OptimizeOptions, MolecularForceField } from './chemistry';
import type { GraphEdit, GraphEditResult } from './graph-edit';
import type { EnergyForces } from './energy-forces';
import type { MolecularAtom } from './types';
import { runWorkerTask } from './worker-task';

import type { ZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";
import type { ZmatrixOptimizeOptions } from "../workbench/zmatrix-coupled-optimization";

export type ChemistryRequest =
  | { action: 'generate'; smiles: string; seed?: number }
  | { action: 'parse'; source: string; format: 'xyz' | 'mol' | 'sdf' | 'smiles' }
  | { action: 'optimize-zmatrix'; molecule: MolecularStructure; definition: ZmatrixDocument; options?: ZmatrixOptimizeOptions }
  | { action: 'optimize'; molecule: MolecularStructure; options?: OptimizeOptions }
  | { action: 'properties' | 'add-hydrogens' | 'remove-hydrogens' | 'charges'; molecule: MolecularStructure }
  | { action: 'energy'; molecule: MolecularStructure; forceField?: MolecularForceField }
  | { action: 'conformers'; molecule: MolecularStructure; options?: { count?: number; seed?: number; forceField?: MolecularForceField } }
  | { action: 'edit-graph'; molecule: MolecularStructure; edits: GraphEdit[] }
  | { action: 'energy-forces'; molecule: MolecularStructure; forceField?: MolecularForceField }
  | { action: 'frame-forces'; molecule: MolecularStructure; frames: MolecularAtom[][]; forceField?: MolecularForceField };

export type ChemistryResults = {
  generate: MolecularStructure;
  parse: MolecularStructure;
  optimize: ReturnType<typeof import('./chemistry').optimize>;
  'optimize-zmatrix': ReturnType<typeof import('../workbench/zmatrix-coupled-optimization').optimizeZmatrix>;
  energy: number;
  charges: Awaited<ReturnType<typeof import('./chemistry').getPartialCharges>>;
  properties: ReturnType<typeof import('./chemistry').getProperties>;
  'add-hydrogens': MolecularStructure;
  'remove-hydrogens': MolecularStructure;
  conformers: ReturnType<typeof import('./chemistry').searchConformers>;
  'edit-graph': GraphEditResult;
  'energy-forces': EnergyForces;
  'frame-forces': EnergyForces[];
};

/** Each job has an isolated worker. Termination cancels synchronous OCL work,
 * including minimization, without waiting for its event loop to become idle. */
export function runChemistryTask<T extends ChemistryRequest>(request: T, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ChemistryResults[T['action']]> {
  return runWorkerTask(() => new Worker(new URL('./compute-worker.ts', import.meta.url), { type: 'module' }), request, options);
}
