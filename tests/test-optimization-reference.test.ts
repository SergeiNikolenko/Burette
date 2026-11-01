import { beforeAll, describe, expect, test } from 'bun:test';
import inputs from './fixtures/forcefield/rdkit-reference.json';
import reference from './fixtures/optimization/rdkit-optimization-reference.json';
import { getEnergy, optimize, parseMolecule, type GeometryConstraint, type OptimizationMethod } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
import { evaluateEnergyForces } from '../apps/desktop/src/lib/molecular-workbench/energy-forces';
import { runChemistryTask } from '../apps/desktop/src/lib/molecular-workbench/compute-client';
import { prepareUffWasm } from '../apps/desktop/src/lib/molecular-workbench/uff-wasm';

// Every expected number below comes from Python RDKit (generate-rdkit-optimization-reference.py).
type Model = 'MMFF94' | 'MMFF94s' | 'UFF';
beforeAll(() => prepareUffWasm());
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

  test('toolkit BFGS reaches the RDKit MMFF94 and MMFF94s minima, including a linear nitrile', () => {
    for (const { smiles } of reference.records) for (const model of ['MMFF94', 'MMFF94s'] as const) {
      const result = optimize(record(smiles).input, { forceField: model, method: 'bfgs', maxIterations: 1000 });
      expect([result.method, result.gradient, result.frameSampling, result.converged, result.iterations]).toEqual(['bfgs', 'toolkit', 'endpoints', true, null]);
      expect(Math.abs(result.energy - minimum(smiles, model))).toBeLessThan(1e-4);
      expect(result.frames.map(frame => frame.energy)).toEqual([result.initialEnergy, result.energy]);
    }
  });

  test('every UFF method reaches the RDKit UFF minimum or reports that it stopped short', () => {
    for (const { smiles } of reference.records) for (const method of ['lbfgs', 'fire', 'abc-fire', 'hybrid'] as const) {
      const result = optimize(record(smiles).input, { forceField: 'UFF', method, maxIterations: 1000 });
      expect([result.method, result.gradient, result.frameSampling]).toEqual([method, 'analytic', 'steps']);
      if (method === 'lbfgs' || method === 'hybrid') expect(result.converged).toBe(true);
      if (result.converged) expect(Math.abs(result.energy - minimum(smiles, 'UFF'))).toBeLessThan(1e-4);
      else expect([result.stopReason, result.energy >= minimum(smiles, 'UFF') - 1e-6]).toEqual(['iterations', true]);
    }
  });

  test('numerical MMFF methods reach the same minima, survive non-finite linear trial points and record every step', () => {
    const cases: [string, Model, OptimizationMethod][] = [['CCO', 'MMFF94', 'lbfgs'], ['CCO', 'MMFF94s', 'fire'], ['CCO', 'MMFF94', 'abc-fire'], ['CCO', 'MMFF94', 'hybrid'], ['O', 'MMFF94', 'fire'], ['CC#N', 'MMFF94', 'lbfgs']];
    for (const [smiles, model, method] of cases) {
      const { input } = record(smiles), result = optimize(input, { forceField: model, method, maxIterations: 1000 });
      expect([result.method, result.gradient, result.converged, result.stopReason]).toEqual([method, 'central-difference', true, 'converged']);
      expect(Math.abs(result.energy - minimum(smiles, model))).toBeLessThan(1e-4);
      expect(result.frames[0].atoms).toEqual(input.atoms);
      expect(result.frames.at(-1)!.atoms).toEqual(result.molecule.atoms);
      expect(result.frames.length).toBeGreaterThanOrEqual(result.iterations! + 1);
      for (const frame of [result.frames[1], result.frames.at(-1)!]) expect(frame.energy).toBeCloseTo(getEnergy({ ...input, atoms: frame.atoms }, model), 8);
      if (method === 'lbfgs') result.frames.slice(1).forEach((frame, i) => expect(frame.energy).toBeLessThanOrEqual(result.frames[i].energy + 1e-9));
    }
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
      expect(Math.abs(stationary.initialEnergy - models[model].energy)).toBeLessThan(1e-6);
      expect(stationary.initialEnergy - stationary.energy).toBeLessThan(1e-6);
    }
  }, 60_000);

  test('undefined objectives and unavailable method choices are refused before any step, without substitution', async () => {
    const nitrile = record('CC#N').input, water = record('O').input;
    const refusals: [typeof nitrile, Parameters<typeof optimize>[1], RegExp][] = [
      [nitrile, { constraints: [{ kind: 'angle', atoms: [0, 1, 2] }] }, /C1–C2–N3 angle is linear/],
      [nitrile, { constraints: [{ kind: 'dihedral', atoms: [3, 0, 1, 2] }] }, /torsion is undefined because C1–C2–N3 is collinear/],
      [water, { forceField: 'UFF', method: 'bfgs' }, /BFGS is the MMFF94 toolkit minimizer/],
      [water, { method: 'bfgs', constraints: [{ kind: 'freeze', atoms: [0] }] }, /BFGS cannot hold frozen atoms/],
      [water, { method: 'lbfgs', maxIterations: 0 }, /1–1000/],
      [water, { constraints: [{ kind: 'distance', atoms: [0, 0] }] }, /invalid atom indices/],
    ];
    for (const [molecule, options, message] of refusals) {
      expect(() => optimize(molecule, options)).toThrow(message);
      await expect(runChemistryTask({ action: 'optimize', molecule, options })).rejects.toThrow(message);
    }
    const waters = parseMolecule(`66\nwaters\n${Array.from({ length: 22 }, (_, i) => `O ${i * 6} 0 0\nH ${i * 6 + .95} 0 0\nH ${i * 6 - .23} .93 0`).join('\n')}\n`, 'xyz');
    for (const method of ['lbfgs', 'fire', 'abc-fire', 'hybrid'] as const) expect(() => optimize(waters, { method })).toThrow(/up to 64 atoms; this structure has 66/);
    expect(() => optimize(waters, { forceField: 'UFF' })).toThrow(/UFF optimization supports up to 64 atoms/);
    expect(optimize(waters, { method: 'bfgs', maxIterations: 1000 }).method).toBe('bfgs');
    // A constrained request without a method uses the documented L-BFGS default and says so.
    expect(optimize(water, { constraints: [{ kind: 'freeze', atoms: [1] }] }).method).toBe('lbfgs');
  });

});
