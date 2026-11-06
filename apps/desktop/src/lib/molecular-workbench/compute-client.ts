import type { MolecularStructure, OptimizeOptions, OptimizationProgress, MolecularForceField, ProtonationResult } from './chemistry';
export type { ProtonationResult } from './chemistry';
export type { ProtonationChange, ProtonationGroup } from './protonation';
import type { GraphEdit, GraphEditResult } from './graph-edit';
import type { EnergyForces } from './energy-forces';
import type { MolecularAtom } from './types';
import { runWorkerTask, type WorkerTaskOptions } from './worker-task';

import type { ZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";
import type { ZmatrixOptimizeOptions } from "../workbench/zmatrix-coupled-problem";

export type ChemistryRequest =
  | { action: 'generate'; smiles: string; seed?: number }
  | { action: 'parse'; source: string; format: 'xyz' | 'mol' | 'sdf' | 'smiles' }
  | { action: 'optimize-zmatrix'; molecule: MolecularStructure; definition: ZmatrixDocument; options?: ZmatrixOptimizeOptions }
  | { action: 'optimize'; molecule: MolecularStructure; options?: OptimizeOptions }
  | { action: 'prepare-3d'; molecule: MolecularStructure; options?: Parameters<typeof import('./chemistry').prepare3d>[1] }
  | { action: 'properties' | 'add-hydrogens' | 'remove-hydrogens' | 'charges'; molecule: MolecularStructure }
  | { action: 'protonate'; molecule: MolecularStructure; pH: number }
  | { action: 'energy'; molecule: MolecularStructure; forceField?: MolecularForceField }
  | { action: 'conformers'; molecule: MolecularStructure; options?: { count?: number; seed?: number; forceField?: MolecularForceField } }
  | { action: 'edit-graph'; molecule: MolecularStructure; edits: GraphEdit[] }
  | { action: 'energy-forces'; molecule: MolecularStructure; forceField?: MolecularForceField }
  | { action: 'frame-forces'; molecule: MolecularStructure; frames: MolecularAtom[][]; forceField?: MolecularForceField }
  | { action: 'record-forces'; reference: string; records: string[]; firstIndex: number; forceField?: MolecularForceField };

export type ChemistryResults = {
  generate: MolecularStructure;
  parse: MolecularStructure;
  optimize: ReturnType<typeof import('./chemistry').optimize>;
  'prepare-3d': ReturnType<typeof import('./chemistry').prepare3d>;
  'optimize-zmatrix': ReturnType<typeof import('../workbench/zmatrix-coupled-optimization').optimizeZmatrix>;
  energy: number;
  charges: Awaited<ReturnType<typeof import('./chemistry').getPartialCharges>>;
  properties: ReturnType<typeof import('./chemistry').getProperties>;
  'add-hydrogens': MolecularStructure;
  'remove-hydrogens': MolecularStructure;
  protonate: ProtonationResult;
  conformers: ReturnType<typeof import('./chemistry').searchConformers>;
  'edit-graph': GraphEditResult;
  'energy-forces': EnergyForces;
  'frame-forces': EnergyForces[];
  'record-forces': (EnergyForces & { atoms: MolecularAtom[] })[];
};

/** Each job has an isolated worker. Termination cancels synchronous OCL work,
 * including minimization, without waiting for its event loop to become idle. Optimizations
 * report their latest step through `onProgress`. */
export function runChemistryTask<T extends ChemistryRequest>(request: T, options: WorkerTaskOptions<OptimizationProgress> = {}): Promise<ChemistryResults[T['action']]> {
  return runWorkerTask(() => new Worker(new URL('./compute-worker.ts', import.meta.url), { type: 'module' }), request, options);
}
