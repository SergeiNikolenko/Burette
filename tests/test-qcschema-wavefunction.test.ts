import { expect, test } from 'bun:test';
import { parseQcschema } from '../apps/desktop/src/lib/molecular-workbench/quantum/qcschema';
import { evaluateOrbital } from '../apps/desktop/src/lib/molecular-workbench/gaussian';
import type { Vec3 } from '../apps/desktop/src/lib/molecular-workbench/types';
import { expectClose, expectSchema, fixtureText, harmonicFrequencies } from './quantum-output-fixture';

type OrbitalReference = { pointsAngstrom: Vec3[]; densityError?: number; spins: { orthonormalityError: number; orbitals: Record<string, number[]> }[] };
const orbitalReference: Record<string, OrbitalReference> = JSON.parse(fixtureText('qcschema/orbital-reference.json'));
const hessianReference: Record<string, { energyHartree: number; hessian: number[]; frequenciesCm1: number[] }> = JSON.parse(fixtureText('qcschema/hessian-reference.json'));
const text = (name: string) => fixtureText(`qcschema/${name}`);
const read = (name: string) => parseQcschema(text(name));

test('Psi4 wavefunctions in spherical and Cartesian bases match PySCF orbital values', () => {
  for (const name of ['water-hf-ccpvdz-wavefunction.json', 'water-hf-631gs-wavefunction.json', 'hydroxyl-uhf-wavefunction.json']) {
    const document = read(name), values = orbitalReference[name];
    expect(values.densityError ?? 0).toBeLessThan(1e-4); // the file is a converged SCF of its own molecule and basis
    const data = JSON.parse(text(name));
    const spins = values.spins.length === 2 ? ['alpha', 'beta'] as const : ['alpha'] as const;
    spins.forEach((spin, s) => {
      const offset = document.orbitals.findIndex(orbital => orbital.spin === spin);
      const channel = document.orbitals.filter(orbital => orbital.spin === spin);
      expect(values.spins[s].orthonormalityError).toBeLessThan(1e-10);
      expect(channel.map(orbital => orbital.energyHartree)).toEqual(data.wavefunction[data.wavefunction[`eigenvalues_${spin[0]}`]]);
      const electrons = data.properties[`calcinfo_n${spin}`];
      expect(channel.filter(orbital => orbital.occupancy > 0)).toHaveLength(spins.length === 2 ? electrons : data.properties.calcinfo_nalpha);
      for (const [number, samples] of Object.entries(values.spins[s].orbitals)) {
        values.pointsAngstrom.forEach((point, p) => expect(Math.abs(evaluateOrbital(document, offset + Number(number), point) - samples[p])).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(samples[p]))));
      }
    });
    expect(document.orbitals.every(orbital => orbital.coefficients.length === data.wavefunction.basis.nbf)).toBe(true);
    expectSchema(document);
  }
  expect(read('water-hf-631gs-wavefunction.json').basis!.filter(shell => shell.kind === 'd').every(shell => !shell.spherical)).toBe(true);
  expect(read('water-hf-ccpvdz-wavefunction.json').basis!.filter(shell => shell.kind === 'd').every(shell => shell.spherical)).toBe(true);
  expect(read('hydroxyl-uhf-wavefunction.json').orbitals.map(orbital => orbital.occupancy).filter(Boolean)).toEqual(Array(9).fill(1));
});

test('a Hessian result keeps Hartree/bohr² and the molecule masses, giving PySCF frequencies', () => {
  const document = read('water-hf-hessian.json'), expected = hessianReference['water-hf-hessian.json'];
  const frame = document.frames[0], hessian = frame.hessian!;
  expect(frame.energyHartree).toBe(JSON.parse(text('water-hf-hessian.json')).properties.return_energy);
  // Psi4 density-fits the integrals; PySCF does not.
  expect(Math.abs(frame.energyHartree! - expected.energyHartree)).toBeLessThan(1e-4);
  expect(hessian.massesAmu).toEqual([15.99491461957, 1.00782503223, 1.00782503223]);
  expectClose(Array.from(hessian.values), expected.hessian, 2e-4);
  // Off a stationary point rotations do not separate in the unprojected Hessian; PySCF projects them.
  expectClose(harmonicFrequencies(hessian).slice(-3), expected.frequenciesCm1, 1);
  const nested = JSON.parse(text('water-hf-hessian.json'));
  nested.return_result = Array.from({ length: 9 }, (_, row) => nested.return_result.slice(row * 9, row * 9 + 9));
  expect(parseQcschema(JSON.stringify(nested)).frames[0].hessian).toEqual(hessian);
  expectSchema(document);
});

test('an optimization that kept only the final gradient still owns every energy truthfully', () => {
  const all = read('water-optimization-trajectory-all.json'), final = read('water-optimization-trajectory-final.json');
  // optking's final geometry is one update past the last gradient, so it is a frame without an energy.
  const energies = JSON.parse(text('water-optimization-trajectory-all.json')).energies;
  expect(all.frames.map(frame => frame.energyHartree)).toEqual([...energies, undefined]);
  expect(final.frames.map(frame => frame.energyHartree)).toEqual([energies[0], energies.at(-1), undefined]);
  const coordinates = (frame: typeof all.frames[number]) => frame.atoms.flatMap(atom => [atom.x, atom.y, atom.z]);
  for (const index of [0, -2, -1]) expectClose(coordinates(final.frames.at(index)!), coordinates(all.frames.at(index)!), 1e-12);
  expect(final.frames[0].forcesKcalMolAngstrom).toBeUndefined();
  expect(final.frames[1].forcesKcalMolAngstrom).toEqual(all.frames[4].forcesKcalMolAngstrom);
  expect(final.converged).toBe(true);
  const none = JSON.parse(text('water-optimization-trajectory-final.json'));
  none.protocols.trajectory = 'none'; none.trajectory = [];
  expect(parseQcschema(JSON.stringify(none)).frames.map(frame => frame.energyHartree)).toEqual([energies[0], undefined]);
});

test('malformed wavefunctions, Hessians and trajectory protocols are refused rather than guessed', () => {
  const wavefunction = JSON.parse(text('water-hf-ccpvdz-wavefunction.json'));
  const hessian = JSON.parse(text('water-hf-hessian.json'));
  const optimization = JSON.parse(text('water-optimization-trajectory-final.json'));
  const shell = (d: typeof wavefunction) => d.wavefunction.basis.center_data[d.wavefunction.basis.atom_map[0]].electron_shells;
  const broken: Array<[typeof wavefunction, (d: typeof wavefunction) => void]> = [
    [wavefunction, d => { d.wavefunction.scf_orbitals_a.pop(); }],
    [wavefunction, d => { d.wavefunction.scf_eigenvalues_a.pop(); }],
    [wavefunction, d => { d.wavefunction.basis.nbf += 1; }],
    [wavefunction, d => { d.wavefunction.basis.atom_map.pop(); }],
    [wavefunction, d => { shell(d)[0].exponents[0] = -1; }],
    [wavefunction, d => { shell(d)[0].harmonic_type = 'pure'; }],
    [wavefunction, d => { shell(d)[0].angular_momentum = [9]; }],
    [wavefunction, d => { delete d.wavefunction.restricted; }],
    [wavefunction, d => { delete d.properties.calcinfo_nalpha; }],
    [hessian, d => { d.return_result.pop(); }],
    [hessian, d => { d.return_result[4] = 'NaN'; }],
    [optimization, d => { d.protocols.trajectory = 'sometimes'; }],
    [optimization, d => { d.trajectory.push(d.trajectory[0]); }],
    [optimization, d => { d.energies[4] += 1e-3; }],
  ];
  for (const [base, edit] of broken) { const d = structuredClone(base); edit(d); expect(() => parseQcschema(JSON.stringify(d))).toThrow(); }
});
