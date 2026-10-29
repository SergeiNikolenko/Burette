import { describe, expect, test } from 'bun:test';
import { addHydrogens, generateFromSmiles, getEnergy, getProperties, optimize, parseMolecule, removeHydrogens, searchConformers } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
import { runChemistryTask } from '../apps/desktop/src/lib/molecular-workbench/compute-client';

describe('browser molecular chemistry', () => {
  test('SMILES creates real 3D ethanol, properties and MMFF energy decreases without changing graph', () => {
    const molecule = generateFromSmiles('CCO');
    expect(molecule.atoms).toHaveLength(9);
    expect(new Set(molecule.atoms.map(a => a.z.toFixed(2))).size).toBeGreaterThan(1);
    expect(getProperties(molecule)).toMatchObject({ formula: 'C2H6O', atomCount: 9, bondCount: 8, hydrogenBondDonors: 1, hydrogenBondAcceptors: 1, charge: 0 });
    expect(getProperties(molecule).molecularWeight).toBeCloseTo(46.069, 2);
    const result = optimize(molecule);
    expect(result.unit).toBe('kcal/mol');
    expect(result.energy).toBeLessThan(result.initialEnergy - 1);
    expect(result.molecule.bonds).toEqual(molecule.bonds);
    expect(result.molecule.atoms.map(a => a.element)).toEqual(molecule.atoms.map(a => a.element));
    expect(getEnergy(molecule)).toBeCloseTo(result.initialEnergy, 8);
  });
  test('explicit graph survives SDF roundtrip; adding and removing hydrogens preserves heavy coordinates', async () => {
    const original = generateFromSmiles('CC=O');
    const parsed = parseMolecule(original.molfile + '\n$$$$\n', 'sdf');
    expect(parsed.bonds).toEqual(original.bonds);
    const heavy = removeHydrogens(original);
    expect(heavy.atoms).toEqual(original.atoms.filter(a => a.element !== 'H'));
    expect(() => getEnergy(heavy)).toThrow('explicit hydrogens');
    const restored = await addHydrogens(heavy);
    expect(restored.atoms.filter(a => a.element !== 'H')).toEqual(heavy.atoms);
    expect(getProperties(restored).formula).toBe('C2H4O');
    expect(Number.isFinite(getEnergy(restored))).toBe(true);
    expect(() => parseMolecule(original.molfile + '\n$$$$\n' + original.molfile, 'sdf')).toThrow('one SDF');
  });
  test('XYZ water is supported but unknown or ambiguous bond orders are not silently guessed', () => {
    const water = parseMolecule('3\nwater\nO 0 0 0\nH .95 0 0\nH -.23 .93 0', 'xyz');
    expect(water).toMatchObject({ graphSource: 'perceived', graphComplete: true });
    expect(optimize(water).energy).toBeLessThan(getEnergy(water));
    const co = parseMolecule('2\nCO\nC 0 0 0\nO 1.13 0 0', 'xyz');
    expect(co.graphComplete).toBe(false);
    expect(() => optimize(co)).toThrow('bond orders');
    expect(() => generateFromSmiles('not smiles')).toThrow();
  });
  test('frozen coordinates remain exact and geometric restraints report real residuals', () => {
    const water = parseMolecule('3\nwater\nO 0 0 0\nH .95 0 0\nH -.23 .93 0', 'xyz');
    const result = optimize(water, { maxIterations: 25, constraints: [{ kind: 'freeze', atoms: [0] }, { kind: 'distance', atoms: [0, 1], target: 1.1 }, { kind: 'angle', atoms: [1, 0, 2], target: 108 }] });
    expect(result.molecule.atoms[0]).toEqual(water.atoms[0]);
    expect(result.constraintResiduals.map(r => r.unit)).toEqual(['angstrom', 'degrees']);
    const before = Math.abs(.95 - 1.1);
    expect(Math.abs(result.constraintResiduals[0].error)).toBeLessThan(before);
    expect(Number.isFinite(result.energy)).toBe(true);
    expect(() => optimize(water, { constraints: [{ kind: 'angle', atoms: [0, 1, 2], target: 180 }] })).toThrow('valid range');
    expect(() => optimize(water, { constraints: [{ kind: 'freeze', atoms: [99] }] })).toThrow('indices');
  });
  test('XYZ atom order and frozen atom identity survive OCL hydrogen reordering', () => {
    const water = parseMolecule('3\nwater\nH .95 0 0\nO 0 0 0\nH -.23 .93 0', 'xyz');
    expect(water.atoms.map(a => a.element)).toEqual(['H', 'O', 'H']);
    const result = optimize(water, { constraints: [{ kind: 'freeze', atoms: [0] }], maxIterations: 10 });
    expect(result.molecule.atoms[0]).toEqual(water.atoms[0]);
    expect(result.molecule.atoms.map(a => a.element)).toEqual(['H', 'O', 'H']);
    expect(result.molecule.bonds).toEqual(water.bonds);
    expect(result.energy).toBeLessThan(result.initialEnergy);
  });
  test('hydrogen addition and conformer search preserve interleaved source atom indices', async () => {
    const water = parseMolecule('3\nwater\nH .95 0 0\nO 0 0 0\nH -.23 .93 0', 'xyz');
    const saturated = await addHydrogens(water);
    expect(saturated.atoms).toEqual(water.atoms);
    expect(saturated.bonds).toEqual(water.bonds);
    const conformer = searchConformers(water, { count: 1 })[0].molecule;
    expect(conformer.atoms.map(a => a.element)).toEqual(['H', 'O', 'H']);
    expect(conformer.bonds).toEqual(water.bonds);
    expect(Number.isFinite(getEnergy(conformer))).toBe(true);

    // Remove one explicit H from the molfile to leave a valid implicit valence,
    // while keeping the remaining H before O in the external source order.
    const partialMolfile = water.molfile
      .replace('COUNTS 3 2', 'COUNTS 2 1')
      .replace(/^M  V30 3 H .*\n/m, '')
      .replace(/^M  V30 2 1 1 3\n/m, '');
    const partial = { ...parseMolecule(partialMolfile, 'mol'), atoms: water.atoms.slice(0, 2), atomMap: [1, 0] };
    const expanded = await addHydrogens(partial);
    expect(expanded.atoms.slice(0, 2)).toEqual(partial.atoms);
    expect(expanded.atoms.map(a => a.element)).toEqual(['H', 'O', 'H']);
    expect(Number.isFinite(getEnergy(expanded))).toBe(true);
    const generated = searchConformers(partial, { count: 1 })[0].molecule;
    expect(generated.atoms.map(a => a.element)).toEqual(['H', 'O', 'H']);
    expect(Number.isFinite(getEnergy(generated))).toBe(true);
  });
  test('conformer search produces real sorted energies and conserved atom identities', () => {
    const molecule = generateFromSmiles('CCCC');
    const results = searchConformers(molecule, { count: 3, seed: 7 });
    expect(results.length).toBeGreaterThan(0);
    for (let i = 0; i < results.length; i++) {
      expect(results[i].molecule.atoms.map(a => a.element)).toEqual(molecule.atoms.map(a => a.element));
      expect(results[i].energy).toBeCloseTo(getEnergy(results[i].molecule), 6);
      if (i) expect(results[i].energy).toBeGreaterThanOrEqual(results[i - 1].energy);
    }
  });
  test('worker executes chemistry and cancellation terminates pending work', async () => {
    const molecule = await runChemistryTask({ action: 'generate', smiles: 'O' });
    expect(molecule.atoms).toHaveLength(3);
    expect((await runChemistryTask({ action: 'properties', molecule })).formula).toBe('H2O');
    const controller = new AbortController();
    const pending = runChemistryTask({ action: 'conformers', molecule: generateFromSmiles('CCCCCCCC'), options: { count: 32 } }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
