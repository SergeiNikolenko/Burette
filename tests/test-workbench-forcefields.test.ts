import { beforeAll, describe, expect, test } from 'bun:test';
import initRDKitModule, { type MainModule as RDKitModule } from '@rdkit/rdkit';
import references from './fixtures/forcefield/rdkit-reference.json';
import { getEnergy, getPartialCharges, optimize, parseMolecule, removeHydrogens, type MolecularForceField } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
import { calculateGasteigerWasm, prepareUffWasm } from '../apps/desktop/src/lib/molecular-workbench/uff-wasm';
import { evaluateEnergyForces } from '../apps/desktop/src/lib/molecular-workbench/energy-forces';
import { runChemistryTask } from '../apps/desktop/src/lib/molecular-workbench/compute-client';

let rdkit: RDKitModule;
beforeAll(async () => { rdkit = await initRDKitModule(); await prepareUffWasm(); });

describe('browser force fields and partial charges', () => {
  test('MMFF94, MMFF94s and UFF match independent Python RDKit energies at fixed coordinates', () => {
    for (const record of references.records) {
      const molecule = parseMolecule(record.molfile, 'mol');
      for (const model of ['MMFF94', 'MMFF94s', 'UFF'] as const) expect(getEnergy(molecule, model)).toBeCloseTo(record.energies[model], 8);
    }
    const amide = parseMolecule(references.records[1].molfile, 'mol');
    expect(Math.abs(getEnergy(amide, 'MMFF94') - getEnergy(amide, 'MMFF94s'))).toBeGreaterThan(.5);
    expect(() => getEnergy(amide, 'unsupported' as MolecularForceField)).toThrow('Unsupported');
  });

  test('selected field is used by optimization, finite-difference forces, and worker transport', async () => {
    const molecule = parseMolecule(references.records[1].molfile, 'mol');
    for (const forceField of ['MMFF94s', 'UFF'] as const) {
      const initialEnergy = references.records[1].energies[forceField];
      for (const method of [undefined, 'lbfgs', 'fire'] as const) {
        const result = optimize(molecule, { forceField, method, maxIterations: 3, constraints: [{ kind: 'freeze', atoms: [0] }] });
        expect(result.forceField).toBe(forceField);
        expect(result.initialEnergy).toBeCloseTo(initialEnergy, 8);
        expect(result.energy).toBeCloseTo(getEnergy(result.molecule, forceField), 6);
        expect(result.molecule.atoms[0]).toEqual(molecule.atoms[0]);
        expect(result.molecule.bonds).toEqual(molecule.bonds);
      }
      expect(evaluateEnergyForces(molecule, forceField).energy).toBeCloseTo(initialEnergy, 8);
      expect(await runChemistryTask({ action: 'energy', molecule, forceField })).toBeCloseTo(initialEnergy, 8);
      const free = optimize(molecule, { forceField, maxIterations: 250 });
      expect(free.energy).toBeLessThan(free.initialEnergy);
      expect(free.energy).toBeCloseTo(getEnergy(free.molecule, forceField), 6);
      const limited = optimize(molecule, { forceField, maxIterations: 1 });
      expect(limited.energy).toBeCloseTo(getEnergy(limited.molecule, forceField), 6);
      expect(limited.converged).toBe(false);
    }
  });

  test('Gasteiger matches independent RDKit for neutral, charged, conjugated and radical graphs', async () => {
    for (const record of [...references.records, ...references.chargeRecords]) {
      const result = await getPartialCharges(parseMolecule(record.molfile, "mol"));
      expect(result).toMatchObject({ model: 'Gasteiger', unit: 'e', iterations: 12 });
      expect(result.charges.length).toBe(record.charges.length);
      result.charges.forEach((charge, i) => expect(charge).toBeCloseTo(record.charges[i], 12));
      expect(result.charges.reduce((a, b) => a + b, 0)).toBeCloseTo(record.charges.reduce((a, b) => a + b, 0), 12);
    }
  });

  test('partial charge atom mapping preserves interleaved source hydrogens', async () => {
    const water = parseMolecule('3\nwater\nH .95 0 0\nO 0 0 0\nH -.23 .93 0', 'xyz');
    const result = await getPartialCharges(water);
    expect(result.charges[0]).toBeGreaterThan(0);
    expect(result.charges[1]).toBeLessThan(0);
    expect(result.charges[2]).toBeCloseTo(result.charges[0], 12);
    const forces = evaluateEnergyForces(water, 'UFF');
    expect(forces.method).toBe('analytic');
    for (let i = 0; i < water.atoms.length; i++) {
      const atoms = water.atoms.map(atom => ({ ...atom })), h = 1e-5;
      atoms[i].x += h; const plus = getEnergy({ ...water, atoms }, 'UFF');
      atoms[i].x -= 2 * h; const minus = getEnergy({ ...water, atoms }, 'UFF');
      expect(forces.forces[i][0]).toBeCloseTo(-(plus - minus) / (2 * h), 5);
    }
    await expect(getPartialCharges({ ...water, atomMap: [0, 0, 1] })).rejects.toThrow("mapping");
  });

  test('missing charge parameters and implicit H fail explicitly', async () => {
    const water = parseMolecule(references.records[2].molfile, 'mol');
    await expect(getPartialCharges(removeHydrogens(water))).rejects.toThrow('explicit hydrogens');
    const xenon = rdkit.get_mol('[Xe]', '{}')!;
    try { expect(() => calculateGasteigerWasm(xenon.get_molblock())).toThrow(); }
    finally { xenon.delete(); }
  });
});
