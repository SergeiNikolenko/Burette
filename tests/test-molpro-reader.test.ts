import { expect, test } from 'bun:test';
import { MOLPRO_SIGNATURE } from '../apps/desktop/src/lib/molecular-workbench/quantum/signatures';
import { parseMolproLog } from '../apps/desktop/src/lib/molecular-workbench/quantum/molpro-log';
import type { MolecularAtom } from '../apps/desktop/src/lib/molecular-workbench/types';
import type { ScientificDocument } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
import { cclibReference, expectClose, expectLineEndingsIgnored, expectSchema, fixtureText, harmonicFrequencies } from './quantum-output-fixture';

const reference = cclibReference('molpro');
const read = (name: string) => parseMolproLog(fixtureText(`molpro/${name}`));
const distance = (a: MolecularAtom, b: MolecularAtom) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const expectFirstGeometry = (atoms: MolecularAtom[], coordinates: number[][]) => atoms.forEach((atom, a) => expectClose([atom.x, atom.y, atom.z], coordinates[a], 1e-8));
const frontier = (document: ScientificDocument, spin: 'alpha' | 'beta') => {
  const channel = document.orbitals.filter(orbital => orbital.spin === spin);
  const occupied = channel.filter(orbital => orbital.occupancy > 0);
  return { count: channel.length, occupied: occupied.length, occupancies: [...new Set(occupied.map(orbital => orbital.occupancy))], homo: occupied.at(-1)?.energyHartree, lumo: channel[occupied.length]?.energyHartree };
};

test('Molpro 2012 single points match cclib: orbitals in energy order, spin channels, charges, dipoles', () => {
  for (const name of ['cclib-dvb_sphf.out', 'cclib-dvb_sphf_un.out', 'cclib-h2o_mp2.out', 'cclib-h2o_ccsd.out']) {
    const text = fixtureText(`molpro/${name}`), expected = reference[name];
    expect(MOLPRO_SIGNATURE.test(text.slice(0, 64 * 1024))).toBe(true);
    const document = parseMolproLog(text);
    expect(document.frames).toHaveLength(1);
    expectFirstGeometry(document.atoms, expected.atomcoords![0]);
    // cclib reads no compact `Orbital energies:` list (the h2o jobs); see the compact-list test.
    expect(document.orbitals.length > 0).toBe(true);
    expected.moenergies?.forEach((energies, s) => {
      const channel = document.orbitals.filter(orbital => orbital.spin === (s ? 'beta' : 'alpha'));
      expectClose(channel.map(orbital => orbital.energyHartree), [...energies].sort((a, b) => a - b), 5e-5); // printed to 1e-4 Eh
      expect(channel.filter(orbital => orbital.occupancy > 0)).toHaveLength(expected.homos![s] + 1);
    });
    if (expected.atomcharges) expectClose(document.frames[0].charges![0].values, expected.atomcharges.mulliken, 1e-9);
    expectClose(document.frames[0].dipoleDebye!, expected.dipole_debye!, 1e-8);
    expectSchema(document);
  }
  expect(read('cclib-h2o_mp2.out').frames[0].energyHartree).toBe(reference['cclib-h2o_mp2.out'].mpenergies![0][0]);
  expect(read('cclib-h2o_ccsd.out').frames[0].energyHartree).toBe(reference['cclib-h2o_ccsd.out'].ccenergies![0]);
  // Text logs list coefficients over symmetry-adapted functions; they are not read as a basis.
  expect(read('cclib-dvb_sphf.out').orbitals.every(orbital => orbital.coefficients.length === 0)).toBe(true);
});

test('Molpro 2018 UHF ALPHA/BETA spin tables keep both channels with numeric occupations', () => {
  const document = read('cclib-2018-dvb_sphf_un.out');
  expect(document.frames).toHaveLength(1);
  // Printed HOMO 35.1 -0.474853 (alpha) and LUMO -35.1 -0.142159 (beta); the tables print five decimals.
  expect([frontier(document, 'alpha'), frontier(document, 'beta')]).toEqual([
    { count: 60, occupied: 35, occupancies: [1], homo: -0.47485, lumo: -0.04747 },
    { count: 60, occupied: 34, occupancies: [1], homo: -0.48467, lumo: -0.14216 },
  ]);
  expectSchema(document);
});

test('a compact Orbital energies list takes its occupations from the closed-shell Final occupancy per symmetry', () => {
  // Printed HOMO/LUMO lines; Molpro lists every occupied orbital and two virtuals per symmetry.
  expect(frontier(read('cclib-h2o_ccsd.out'), 'alpha')).toEqual({ count: 7, occupied: 5, occupancies: [2], homo: -0.491854, lumo: 0.181733 });
  expect(frontier(read('cclib-dvb_ir.out'), 'alpha')).toEqual({ count: 43, occupied: 35, occupancies: [2], homo: -0.149423, lumo: 0.041017 });
  const trp = read('cclib-2018-Trp_polar.out');
  expect([frontier(trp, 'alpha'), frontier(trp, 'beta').count]).toEqual([{ count: 56, occupied: 54, occupancies: [2], homo: -0.225669, lumo: 0.247577 }, 0]);
  expectSchema(trp);
  const text = fixtureText('molpro/cclib-dvb_ir.out');
  expect(() => parseMolproLog(text.replace(' Final occupancy:  15   2  15   3', ' Final occupancy:  18   0  14   3'))).toThrow(/omit occupied/);
  // Counts that do not hold the 35+35 electrons, or an open-shell SCF, give no occupations to guess from.
  expect(parseMolproLog(text.replace(' Final occupancy:  15   2  15   3', ' Final occupancy:  15   5  15   3')).orbitals).toHaveLength(0);
  expect(parseMolproLog(text.replace(' NUMBER OF ELECTRONS:      35+   35-', ' NUMBER OF ELECTRONS:      36+   34-')).orbitals).toHaveLength(0);
  expect(() => parseMolproLog(text.replace('         1.2          2.2', '         1.2          3.2'))).toThrow(/label/);
});

test('an optimization keeps the input and the optimized geometry, not the unprinted steps', () => {
  const document = read('cclib-dvb_gopt.out'), expected = reference['cclib-dvb_gopt.out'];
  expect(document.frames).toHaveLength(2);
  expectFirstGeometry(document.frames[0].atoms, expected.atomcoords![0]);
  expectClose(document.frames.map(frame => frame.energyHartree!), expected.scfenergies!, 1e-10);
  expect(document.converged).toBe(true);
  // The optimized geometry reproduces the optimized Z-matrix variables Molpro printed.
  const atoms = document.atoms;
  expectClose([distance(atoms[0], atoms[6]), distance(atoms[6], atoms[12]), distance(atoms[5], atoms[8])], [1.48046994, 1.34019828, 1.09711297], 2e-8);
  expectClose(document.orbitals.map(orbital => orbital.energyHartree), [...expected.moenergies![0]].sort((a, b) => a - b), 5e-5);
  expectClose(document.frames[1].charges![0].values, expected.atomcharges!.mulliken, 1e-9);
  expectSchema(document);
});

test('frequencies keep symmetry labels, IR and a Hessian that reproduces them', () => {
  const document = read('cclib-dvb_ir.out'), expected = reference['cclib-dvb_ir.out'];
  expectFirstGeometry(document.atoms, expected.atomcoords![0]);
  expectClose(document.modes.map(mode => mode.frequencyCm1), expected.vibfreqs!, 1e-9);
  expectClose(document.modes.map(mode => mode.intensityKmMol!), expected.vibirs!, 1e-9);
  expect(document.modes.map(mode => mode.symmetry)).toEqual(expected.vibsyms);
  document.modes.forEach((mode, m) => expectClose(mode.displacements!.flat(), expected.vibdisps![m].flat(), 1e-12));
  const hessian = document.frames[0].hessian!;
  expect([hessian.source, hessian.massesAmu!.slice(7, 9)]).toEqual(['molpro-log', [12.011, 1.00794]]);
  // cclib keeps the force-constant lower triangle (Hartree/bohr²) row by row.
  let offset = 0;
  for (let row = 0; row < 60; row++) for (let column = 0; column <= row; column++) {
    expect(Math.abs(hessian.values[row * 60 + column] - (expected.hessian as unknown as number[])[offset++])).toBeLessThan(1e-12);
  }
  expect(offset).toBe(1830);
  expectClose(harmonicFrequencies(hessian).slice(6), document.modes.map(mode => mode.frequencyCm1).sort((a, b) => a - b), 0.5);
  expectSchema(document);
});

test('malformed Molpro tables are refused rather than guessed', () => {
  const text = fixtureText('molpro/cclib-dvb_ir.out');
  expectLineEndingsIgnored(text, parseMolproLog);
  const broken = [
    text.replace('   1  C       6.00', '   2  C       6.00'),
    text.replace(' Wavenumbers [cm-1]           50.29 ', ' Wavenumbers [cm-1]           5x.29 '),
    text.replace('           CY1             -0.00000     0.00000', '           CY2             -0.00000     0.00000'),
    text.replace('           CY1           0.0038721   0.7252394', '           CY1           0.0038721'),
  ];
  for (const variant of broken) expect(() => parseMolproLog(variant)).toThrow();
  expect(() => parseMolproLog(' ***  PROGRAM SYSTEM MOLPRO  ***\n')).toThrow(/geometry/);
});
