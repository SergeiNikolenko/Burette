import { beforeAll, describe, expect, test } from 'bun:test';
import initRDKitModule, { type MainModule as RDKitModule } from '@rdkit/rdkit';
import { Molecule } from 'openchemlib';
import inputs from './fixtures/forcefield/rdkit-reference.json';
import reference from './fixtures/optimization/rdkit-optimization-reference.json';
import { createEnergyEvaluator, createOptimizationEvaluator, generateFromSmiles, getEnergy, optimize, parseMolecule, prepare3d, searchConformers, type GeometryConstraint, type OptimizationMethod } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
import { runGraphOperation } from '../apps/desktop/src/lib/molecular-workbench/graph-operations';
import { evaluateEnergyForces } from '../apps/desktop/src/lib/molecular-workbench/energy-forces';
import { optimizeCartesian } from '../apps/desktop/src/lib/molecular-workbench/optimization';
import { runChemistryTask } from '../apps/desktop/src/lib/molecular-workbench/compute-client';
import { prepareUffWasm } from '../apps/desktop/src/lib/molecular-workbench/uff-wasm';
import { atomsFromZmatrixDocument, parseZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { optimizeZmatrix } from '../apps/desktop/src/lib/workbench/zmatrix-coupled-optimization';

// Every expected number below comes from Python RDKit (generate-rdkit-optimization-reference.py).
type Model = 'MMFF94' | 'MMFF94s' | 'UFF';
let rdkit: RDKitModule;
beforeAll(async () => { rdkit = await initRDKitModule(); await prepareUffWasm(); });
const record = (smiles: string) => {
  const index = reference.records.findIndex(item => item.smiles === smiles);
  return { input: parseMolecule(inputs.records[index].molfile, 'mol'), expected: reference.records[index] };
};
const minimum = (smiles: string, model: Model) => record(smiles).expected.models[model].minimum.energy;

describe('optimization against independent RDKit references', () => {
  test('force-field gradients at fixed coordinates match RDKit analytic gradients in source order', () => {
    for (const { smiles } of reference.records) for (const model of ['MMFF94', 'MMFF94s', 'UFF'] as const) {
      const { input, expected } = record(smiles), result = evaluateEnergyForces(input, model);
      expect(result.method).toBe(model === 'UFF' ? 'analytic' : 'central-difference');
      expect(Math.abs(result.energy - expected.models[model].energy)).toBeLessThan(1e-7);
      result.forces.flat().forEach((force, i) => expect(Math.abs(-force - expected.models[model].gradient[i])).toBeLessThan(model === 'UFF' ? 1e-7 : 2e-4));
    }
  });

  test('the analytic MMFF surface used for optimization matches RDKit energies and analytic gradients', () => {
    for (const { smiles } of reference.records) for (const model of ['MMFF94', 'MMFF94s'] as const) {
      const { input, expected } = record(smiles), evaluator = createOptimizationEvaluator(input, model);
      try {
        expect(Math.abs(evaluator.energy(input.atoms) - expected.models[model].energy)).toBeLessThan(1e-4);
        evaluator.gradient!(input.atoms).flat().forEach((value, i) => expect(Math.abs(value - expected.models[model].gradient[i])).toBeLessThan(2e-4));
      } finally { evaluator.dispose(); }
    }
  });

  test('analytic force fields preserve the external atom order after a graph reorder', () => {
    const { input, expected } = record('CC(=O)NC');
    const order = input.atoms.map((_, i) => input.atoms.length - i - 1);
    const reordered = runGraphOperation({ action: 'edit-graph', molecule: input, edits: [{ kind: 'reorder-atoms', order }] });
    for (const model of ['MMFF94', 'MMFF94s', 'UFF'] as const) {
      const evaluator = createOptimizationEvaluator(reordered, model);
      try {
        expect(Math.abs(evaluator.energy(reordered.atoms) - expected.models[model].energy)).toBeLessThan(1e-4);
        expect(evaluator.gradient).toBeDefined();
        evaluator.gradient!(reordered.atoms).forEach((gradient, i) => gradient.forEach((value, axis) => {
          expect(Math.abs(value - expected.models[model].gradient[3 * order[i] + axis])).toBeLessThan(2e-4);
        }));
      } finally { evaluator.dispose(); }
    }
  });

  test('BFGS reaches the RDKit MMFF94, MMFF94s and UFF minima on the analytic surface, including a linear nitrile, and records every step', () => {
    for (const { smiles } of reference.records) for (const model of ['MMFF94', 'MMFF94s', 'UFF'] as const) {
      const { input } = record(smiles), result = optimize(input, { forceField: model, method: 'bfgs', maxIterations: 1000 });
      expect([result.method, result.gradient, result.frameSampling, result.converged, result.stopReason]).toEqual(['bfgs', 'analytic', 'steps', true, 'converged']);
      expect(Math.abs(result.energy - minimum(smiles, model))).toBeLessThan(1e-4);
      expect(result.frames[0].atoms).toEqual(input.atoms);
      expect(result.frames.at(-1)!.atoms).toEqual(result.molecule.atoms);
      expect(result.frames.length).toBeGreaterThanOrEqual(result.iterations + 1);
      result.frames.slice(1).forEach((frame, i) => expect(frame.energy).toBeLessThanOrEqual(result.frames[i].energy + 1e-9));
    }
  });

  test('every UFF method reaches the RDKit UFF minimum or reports that it stopped short', () => {
    for (const { smiles } of reference.records) for (const method of ['bfgs', 'lbfgs', 'fire', 'abc-fire', 'hybrid'] as const) {
      const result = optimize(record(smiles).input, { forceField: 'UFF', method, maxIterations: 1000 });
      expect([result.method, result.gradient, result.frameSampling]).toEqual([method, 'analytic', 'steps']);
      if (method !== 'fire' && method !== 'abc-fire') expect(result.converged).toBe(true);
      if (result.converged) expect(Math.abs(result.energy - minimum(smiles, 'UFF'))).toBeLessThan(1e-4);
      else expect([result.stopReason, result.energy >= minimum(smiles, 'UFF') - 1e-6]).toEqual(['iterations', true]);
    }
  });

  test('MMFF methods reach the same minima on the analytic surface, survive non-finite linear trial points and record every step', () => {
    const cases: [string, Model, OptimizationMethod][] = [['CCO', 'MMFF94', 'lbfgs'], ['CCO', 'MMFF94s', 'fire'], ['CCO', 'MMFF94', 'abc-fire'], ['CCO', 'MMFF94', 'hybrid'], ['O', 'MMFF94', 'fire'], ['CC#N', 'MMFF94', 'lbfgs']];
    for (const [smiles, model, method] of cases) {
      const { input } = record(smiles), result = optimize(input, { forceField: model, method, maxIterations: 1000 });
      expect([result.method, result.gradient, result.converged, result.stopReason]).toEqual([method, 'analytic', true, 'converged']);
      expect(Math.abs(result.energy - minimum(smiles, model))).toBeLessThan(1e-4);
      expect(result.frames[0].atoms).toEqual(input.atoms);
      expect(result.frames.at(-1)!.atoms).toEqual(result.molecule.atoms);
      expect(result.frames.length).toBeGreaterThanOrEqual(result.iterations + 1);
      // The analytic surface uses the extracted f32 parameters; OpenChemLib's energy agrees within 1e-4.
      for (const frame of [result.frames[0], result.frames[1], result.frames.at(-1)!]) expect(Math.abs(frame.energy - getEnergy({ ...input, atoms: frame.atoms }, model))).toBeLessThan(1e-4);
      if (method === 'lbfgs') result.frames.slice(1).forEach((frame, i) => expect(frame.energy).toBeLessThanOrEqual(result.frames[i].energy + 1e-9));
    }
    // Without the analytic surface, OpenChemLib's energy is differenced and reaches the same minimum.
    const { input } = record('CCO'), evaluator = createEnergyEvaluator(input, 'MMFF94');
    try {
      const fallback = optimizeCartesian(input, evaluator, 'bfgs', 'MMFF94', { maxIterations: 1000 });
      expect([fallback.gradient, fallback.converged]).toEqual(['central-difference', true]);
      expect(Math.abs(fallback.energy - minimum('CCO', 'MMFF94'))).toBeLessThan(1e-4);
    } finally { evaluator.dispose(); }
  }, 60_000);

  test('frozen atoms and harmonic distance, angle and torsion restraints match the RDKit constrained minimum', () => {
    const { input } = record('CCO'), { restraints, models } = reference.constrained;
    for (const model of ['MMFF94', 'MMFF94s', 'UFF'] as const) {
      const result = optimize(input, { forceField: model, method: 'lbfgs', maxIterations: 1000, constraints: restraints as GeometryConstraint[] });
      expect(result.molecule.atoms[0]).toEqual(input.atoms[0]);
      expect(result.frozenAtoms).toEqual([0]);
      expect(Math.abs(result.energy - models[model].energy)).toBeLessThan(2e-4);
      expect(result.constraintResiduals.map(item => [item.kind, item.atoms, item.unit])).toEqual(restraints.slice(1).map(item => [item.kind, item.atoms, item.kind === 'distance' ? 'angstrom' : 'degrees']));
      result.constraintResiduals.forEach((item, i) => {
        expect(Math.abs(item.error - models[model].residuals[i])).toBeLessThan(item.unit === 'angstrom' ? 1e-4 : 2e-3);
      });
      expect([result.converged, result.stopReason]).toEqual([true, 'converged']);
      // Started at RDKit's constrained minimum, the same objective is already stationary.
      const atRdkit = { ...input, atoms: input.atoms.map((atom, i) => ({ element: atom.element, x: models[model].coordinates[i][0], y: models[model].coordinates[i][1], z: models[model].coordinates[i][2] })) };
      const stationary = optimize(atRdkit, { forceField: model, method: 'lbfgs', maxIterations: 1000, constraints: restraints as GeometryConstraint[] });
      expect(Math.abs(stationary.initialEnergy - models[model].energy)).toBeLessThan(1e-4);
      expect(stationary.initialEnergy - stationary.energy).toBeLessThan(1e-6);
    }
  }, 60_000);

  test('undefined objectives and unavailable method choices are refused before any step, without substitution', async () => {
    const nitrile = record('CC#N').input, water = record('O').input;
    const refusals: [typeof nitrile, Parameters<typeof optimize>[1], RegExp][] = [
      [nitrile, { constraints: [{ kind: 'angle', atoms: [0, 1, 2] }] }, /C1–C2–N3 angle is linear/],
      [nitrile, { constraints: [{ kind: 'dihedral', atoms: [3, 0, 1, 2] }] }, /torsion is undefined because C1–C2–N3 is collinear/],
      [water, { method: 'lbfgs', maxIterations: 0 }, /1–1000/],
      [water, { constraints: [{ kind: 'distance', atoms: [0, 0] }] }, /invalid atom indices/],
    ];
    for (const [molecule, options, message] of refusals) {
      expect(() => optimize(molecule, options)).toThrow(message);
      await expect(runChemistryTask({ action: 'optimize', molecule, options })).rejects.toThrow(message);
    }
    const waters = parseMolecule(`66\nwaters\n${Array.from({ length: 22 }, (_, i) => `O ${i * 6} 0 0\nH ${i * 6 + .95} 0 0\nH ${i * 6 - .23} .93 0`).join('\n')}\n`, 'xyz');
    // UFF's analytic gradient carries every method past the 64-atom differencing bound. The extracted
    // MMFF terms omit the water–water interactions OpenChemLib includes, so MMFF would difference and refuses.
    for (const method of ['bfgs', 'lbfgs', 'fire', 'abc-fire', 'hybrid'] as const) {
      expect(optimize(waters, { forceField: 'UFF', method, maxIterations: 20 })).toMatchObject({ method, forceField: 'UFF', gradient: 'analytic' });
      expect(() => optimize(waters, { method })).toThrow(/MMFF94 has no analytic gradient for this structure \(separate fragments interact.*up to 64 atoms and it has 66/);
    }
    const pair = parseMolecule('6\ntwo waters\nO 0 0 0\nH .95 0 0\nH -.23 .93 0\nO 3 0 0\nH 3.95 0 0\nH 2.77 .93 0\n', 'xyz');
    expect(optimize(pair, { method: 'bfgs', maxIterations: 1000 })).toMatchObject({ gradient: 'central-difference', converged: true });
    // BFGS holds frozen atoms like every other method.
    expect(optimize(water, { method: 'bfgs', constraints: [{ kind: 'freeze', atoms: [0] }] })).toMatchObject({ method: 'bfgs', converged: true, frozenAtoms: [0] });
    // A constrained request without a method uses the documented L-BFGS default and says so.
    expect(optimize(water, { constraints: [{ kind: 'freeze', atoms: [1] }] }).method).toBe('lbfgs');
  });

  test('conformer search returns distinct converged minima that each match an RDKit minimum', () => {
    for (const smiles of ['CCCC', 'CCCCC'] as const) for (const model of ['MMFF94', 'UFF'] as const) {
      const minima = reference.conformerMinima[smiles][model], molecule = generateFromSmiles(smiles);
      const search = searchConformers(molecule, { count: 32, seed: 5, forceField: model });
      expect([search.forceField, search.seed, search.generated]).toEqual([model, 5, search.conformers.length + search.duplicates]);
      expect(search.conformers.length).toBeLessThanOrEqual(minima.length);
      expect(Math.abs(search.conformers[0].energy - minima[0])).toBeLessThan(2e-3);
      for (const conformer of search.conformers) {
        expect(conformer.converged).toBe(true);
        expect(Math.min(...minima.map(value => Math.abs(value - conformer.energy)))).toBeLessThan(2e-3);
        expect(conformer.relativeEnergy).toBeCloseTo(conformer.energy - search.conformers[0].energy, 10);
        expect(conformer.molecule.atoms.map(atom => atom.element)).toEqual(molecule.atoms.map(atom => atom.element));
        expect(conformer.molecule.bonds).toEqual(molecule.bonds);
      }
    }
  });

  test('automatic 3D preparation embeds flat depictions, keeps their stereochemistry and refuses 3D input', () => {
    for (const flat of reference.flatInputs) {
      // OpenChemLib inverts cis-2-butene from seeds 3 and 4; the identity check moves on to seed 5.
      const input = parseMolecule(flat.molfile, 'mol'), result = prepare3d(input, { forceField: 'MMFF94', seed: 3 });
      expect(result.preparation).toEqual(flat.smiles === 'C/C=C\\C' ? { addedHydrogens: flat.hydrogens, seed: 5, attempts: 3 } : { addedHydrogens: flat.hydrogens, seed: 3, attempts: 1 });
      expect(result.molecule.atoms).toHaveLength(flat.heavyAtoms + flat.hydrogens);
      expect(result.molecule.atoms.slice(0, flat.heavyAtoms).map(atom => atom.element)).toEqual(input.atoms.map(atom => atom.element));
      expect(new Set(result.molecule.atoms.slice(flat.heavyAtoms).map(atom => atom.element))).toEqual(new Set(['H']));
      expect(result.molecule.atoms.some(atom => Math.abs(atom.z) > 0.1)).toBe(true);
      expect([result.method, result.converged]).toEqual(['bfgs', true]);
      const reread = rdkit.get_mol(result.molecule.molfile, JSON.stringify({ removeHs: true }))!;
      try { expect(reread.get_smiles()).toBe(flat.smiles); } finally { reread.delete(); }
      expect(() => prepare3d(result.molecule)).toThrow(/already has 3D coordinates/);
    }
    const benzene = prepare3d(parseMolecule(reference.flatInputs[0].molfile, 'mol'));
    expect(Math.abs(benzene.energy - minimum('c1ccccc1', 'MMFF94'))).toBeLessThan(1e-3);
    // Flat triacontane: 30 carbons become 92 atoms once hydrogens are added.
    const chain = Array.from({ length: 30 }, (_, i) => `${(i * 1.3).toFixed(4).padStart(10)}${(i % 2 * .75).toFixed(4).padStart(10)}    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0`);
    const bonds = Array.from({ length: 29 }, (_, i) => `${String(i + 1).padStart(3)}${String(i + 2).padStart(3)}  1  0`);
    const large = parseMolecule(`\n  flat\n\n 30 29  0  0  0  0  0  0  0  0999 V2000\n${[...chain, ...bonds].join('\n')}\nM  END\n`, 'mol');
    for (const forceField of ['MMFF94', 'UFF'] as const) {
      const prepared = prepare3d(large, { forceField });
      expect([prepared.molecule.atoms.length, prepared.method, prepared.gradient, prepared.energy < prepared.initialEnergy]).toEqual([92, forceField === 'UFF' ? 'lbfgs' : 'bfgs', 'analytic', true]);
    }
  });

  for (const producer of ['RDKit', 'OCL']) {
    test.each(['CC(N)C(=O)O', 'CC=CC', 'CC(O)CC(C)O', 'C[C@H](O)CC(C)O', 'C/C=C/CC=CC'])(`3D preparation preserves ${producer} unspecified stereo for %s`, (smiles) => {
      const reference = rdkit.get_mol(smiles)!;
      try {
        const molfile = producer === 'RDKit' ? reference.get_molblock() : Molecule.fromSmiles(smiles).toMolfile();
        const input = parseMolecule(molfile, 'mol');
        const original = JSON.stringify(input);
        const result = prepare3d(input, { seed: 3 });
        expect(JSON.stringify(input)).toBe(original);
        expect(Number.isFinite(result.energy)).toBe(true);
        expect(result.molecule.atoms.some(atom => Math.abs(atom.z) > 0.1)).toBe(true);
        const reopened = rdkit.get_mol(result.molecule.molfile, JSON.stringify({ removeHs: true }))!;
        try { expect(reopened.get_smiles()).toBe(reference.get_smiles()); } finally { reopened.delete(); }
        const sourceStereo = Molecule.fromMolfile(molfile), resultStereo = Molecule.fromMolfile(result.molecule.molfile);
        sourceStereo.ensureHelperArrays(Molecule.cHelperCIP);
        resultStereo.ensureHelperArrays(Molecule.cHelperCIP);
        for (let i = 0; i < sourceStereo.getAllAtoms(); i++) {
          if (sourceStereo.getAtomCIPParity(i) === Molecule.cAtomCIPParityNone) continue;
          expect([resultStereo.getAtomCIPParity(i), resultStereo.getAtomESRType(i), resultStereo.getAtomESRGroup(i)])
            .toEqual([sourceStereo.getAtomCIPParity(i), sourceStereo.getAtomESRType(i), sourceStereo.getAtomESRGroup(i)]);
        }
      } finally { reference.delete(); }
    });
  }

  test('Z-matrix optimization with both O–H bonds and both angles on shared variables reaches the RDKit water minimum', () => {
    // Water's minimum is symmetric, so two shared variables span it exactly.
    const definition = parseZmatrixDocument('O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 1.15\nA = 50\n');
    const atoms = atomsFromZmatrixDocument(definition).map(({ element, position: [x, y, z] }) => ({ element, x, y, z }));
    const molecule = parseMolecule(`3\nwater\n${atoms.map(a => `${a.element} ${a.x} ${a.y} ${a.z}`).join('\n')}\n`, 'xyz');
    const target = record('O').expected.models.MMFF94.minimum.coordinates as number[][];
    const rdkitBond = Math.hypot(...target[1].map((v, i) => v - target[0][i]));
    for (const method of ['bfgs', 'lbfgs', 'fire', 'abc-fire', 'hybrid'] as const) {
      const result = optimizeZmatrix(molecule, definition, { method, maxIterations: 1000 });
      expect([result.converged, result.method]).toEqual([true, method]);
      expect(Math.abs(result.energy - minimum('O', 'MMFF94'))).toBeLessThan(1e-5);
      const [o, h1, h2] = result.molecule.atoms, bond = (h: typeof o) => Math.hypot(h.x - o.x, h.y - o.y, h.z - o.z);
      expect(Math.abs(bond(h1) - rdkitBond)).toBeLessThan(1e-3);
      expect(bond(h1)).toBeCloseTo(bond(h2), 9);
    }
  });
});
