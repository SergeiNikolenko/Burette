import { addHydrogens, adjustHydrogensForPh, generateFromSmiles, getEnergy, getPartialCharges, getProperties, optimize, parseMolecule, prepare3d, removeHydrogens, searchConformers, type OptimizationProgress } from './chemistry';
import { prepareUffWasm } from './uff-wasm';
import { optimizeZmatrix } from '../workbench/zmatrix-coupled-optimization';
import type { ChemistryRequest } from './compute-client';
import { evaluateEnergyForces, evaluateFrameBatch, evaluateRecordBatch } from './energy-forces';
import { runGraphOperation } from './graph-operations';

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<ChemistryRequest>) => void; postMessage: (message: unknown) => void };
// Minimizers accept hundreds of steps per second; the status needs a few updates per second.
const PROGRESS_INTERVAL_MS = 100;
let progressPosted = 0;
const progress = (step: OptimizationProgress) => {
  const now = Date.now();
  if (now - progressPosted < PROGRESS_INTERVAL_MS) return;
  progressPosted = now;
  scope.postMessage({ progress: step });
};
scope.onmessage = async ({ data }) => {
  try {
    const forceField = 'forceField' in data ? data.forceField : 'options' in data ? data.options?.forceField : undefined;
    // UFF always needs the RDKit module; optimizations also take MMFF terms from it.
    if (forceField === 'UFF' || data.action === 'optimize' || data.action === 'optimize-zmatrix' || data.action === 'prepare-3d') await prepareUffWasm();
    let result: unknown;
    switch (data.action) {
      case 'generate': result = generateFromSmiles(data.smiles, data.seed); break;
      case 'parse': result = data.format === 'smiles' ? parseMolecule(data.source, data.format) : runGraphOperation({ ...data, format: data.format }); break;
      case 'optimize-zmatrix': result = optimizeZmatrix(data.molecule, data.definition, data.options, progress); break;
      case 'optimize': result = optimize(data.molecule, data.options, progress); break;
      case 'prepare-3d': result = prepare3d(data.molecule, data.options); break;
      case 'energy': result = getEnergy(data.molecule, data.forceField); break;
      case 'charges': result = await getPartialCharges(data.molecule); break;
      case 'properties': result = getProperties(data.molecule); break;
      case 'add-hydrogens': result = await addHydrogens(data.molecule); break;
      case 'remove-hydrogens': result = removeHydrogens(data.molecule); break;
      case 'protonate': result = await adjustHydrogensForPh(data.molecule, data.pH); break;
      case 'conformers': result = searchConformers(data.molecule, data.options); break;
      case 'edit-graph': result = runGraphOperation(data); break;
      case 'energy-forces': result = evaluateEnergyForces(data.molecule, data.forceField); break;
      case 'frame-forces': result = evaluateFrameBatch(data.molecule, data.frames, data.forceField); break;
      case 'record-forces': result = evaluateRecordBatch(data.reference, data.records, data.firstIndex, data.forceField); break;
      default: throw new Error('Unknown chemistry operation.');
    }
    scope.postMessage({ ok: true, result });
  } catch (error) { scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
