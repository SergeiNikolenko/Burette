import { expect, test } from 'bun:test';
import { parseOrcaProperty } from '../apps/desktop/src/lib/molecular-workbench/quantum/orca-property';
import { ORCA_PROPERTY_SIGNATURE } from '../apps/desktop/src/lib/molecular-workbench/quantum/signatures';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import { cclibReference, expectClose, expectGeometries, expectLineEndingsIgnored, expectSchema, fixtureText, harmonicFrequencies } from './quantum-output-fixture';

// cclib reads the ORCA output printed by the same run as each property file.
const reference = cclibReference('orca-property');
const text = (name: string) => fixtureText(`orca-property/${name}`);
const read = (name: string) => parseOrcaProperty(text(name));
const output = (name: string) => reference[name.replace(/[._]property\.txt$/, '.out')];

test('ORCA 6 optimization geometries, final energies, SCF charges and dipoles match the printed output', () => {
  for (const name of ['maa-apa-opt.property.txt', 'maa-apa-freq.property.txt', 'radicalpy-nh2.property.txt']) {
    const document = read(name), expected = output(name);
    expect(ORCA_PROPERTY_SIGNATURE.test(text(name))).toBe(true);
    expectGeometries(document, expected, 1.5e-6); // the output prints angstrom to six decimals
    // FINAL SINGLE POINT ENERGY, dispersion included, for every geometry.
    expectClose(document.frames.map(frame => frame.energyHartree!), expected.scfenergies!, 1e-9);
    const last = document.frames.at(-1)!;
    expectClose(last.charges!.find(set => set.model === 'mulliken')!.values, expected.atomcharges!.mulliken, 1e-6);
    expectClose(last.charges!.find(set => set.model === 'lowdin')!.values, expected.atomcharges!.lowdin, 1e-6);
    expectClose(last.dipoleDebye!, expected.dipole_debye!, 1e-6);
    expect(document.converged).toBeUndefined();
    expectSchema(document);
  }
  // Each optimizer step has its gradient; the converged geometry is only reprinted.
  expect(read('maa-apa-opt.property.txt').frames.map(frame => frame.forcesKcalMolAngstrom?.length)).toEqual([14, 14, 14, 14, 14, 14, undefined]);
});

test('an ORCA 6 numerical frequency run keeps its Hessian and every mode, rigid motions included', () => {
  const document = read('maa-apa-freq.property.txt'), expected = output('maa-apa-freq.property.txt');
  const frame = document.frames[0], hessian = frame.hessian!;
  expect([hessian.dimension, hessian.source, hessian.massesAmu]).toEqual([42, 'orca-property', undefined]);
  expect(document.modes.map(mode => mode.index)).toEqual([...Array(42).keys()]);
  expect(document.modes.slice(0, 6).every(mode => mode.frequencyCm1 === 0)).toBe(true);
  expectClose(document.modes.slice(6).map(mode => mode.frequencyCm1), expected.vibfreqs!, 0.005); // printed to 0.01 cm⁻¹
  document.modes.slice(6).forEach((mode, m) => expectClose(mode.displacements!.flat(), expected.vibdisps![m].flat(), 5e-7));
  // ORCA's thermochemistry states the total mass of standard atomic weights (C 12.011, H 1.008, N 14.007).
  const masses = frame.atoms.map(atom => ({ C: 12.011, H: 1.008, N: 14.007 })[atom.element as 'C' | 'H' | 'N']);
  expect(masses.reduce((sum, mass) => sum + mass, 0)).toBeCloseTo(Number(text('maa-apa-freq.property.txt').match(/&totalMass \[&Type "Double"\]\s+(\S+)/)![1]), 9);
  const frequencies = harmonicFrequencies({ ...hessian, massesAmu: masses });
  // Unprojected eigenvalues: rotations mix into the softest modes of a numerical Hessian.
  expectClose(frequencies.slice(-30), expected.vibfreqs!.slice(-30), 1);
});

test('ORCA 5 property lists give the same history, Mayer charges, dispersion-corrected energies and modes', () => {
  const co2 = read('pyepfd-co2-opt-freq_property.txt'), expected = output('pyepfd-co2-opt-freq_property.txt');
  expect(ORCA_PROPERTY_SIGNATURE.test(text('pyepfd-co2-opt-freq_property.txt'))).toBe(true);
  expectGeometries(co2, expected, 1.5e-6);
  expectClose(co2.frames.map(frame => frame.energyHartree!), expected.scfenergies!, 1e-8); // the ORCA 5 output prints eight decimals
  expectClose(co2.frames.at(-1)!.charges![0].values, expected.atomcharges!.mulliken, 1e-4); // four decimals in the Mayer table
  expectClose(co2.frames.at(-1)!.dipoleDebye!, expected.dipole_debye!, 1e-5);
  expect(co2.modes).toHaveLength(9);
  expectClose(co2.modes.slice(5).map(mode => mode.frequencyCm1), expected.vibfreqs!, 0.005);
  co2.modes.slice(5).forEach((mode, m) => expectClose(mode.displacements!.flat(), expected.vibdisps![m].flat(), 1e-6));
  expect(co2.frames.slice(0, -1).every(frame => frame.modes === undefined)).toBe(true);
  expectSchema(co2);

  // ORCA's own trajectory comments state each step's final single-point energy (SCF + D3BJ).
  const silene = read('si2h4-opt-freq_property.txt');
  const trajectory = [...text('si2h4-opt-freq_trj.xyz').matchAll(/E (-?\d+\.\d+)/g)].map(match => Number(match[1]));
  expectClose(silene.frames.map(frame => frame.energyHartree!), trajectory, 1e-9);
  expect(silene.frames.at(-1)!.modes).toHaveLength(18);
});

test('the dispatcher routes property files by name and by content', () => {
  const name = 'maa-apa-freq.property.txt', expected = read(name);
  expect(parseScientificFile(name, text(name))).toEqual(expected);
  expect(parseScientificFile('renamed.txt', text(name))).toEqual(expected);
  expect(parseScientificFile('job_property.txt', text('pyepfd-co2-opt-freq_property.txt'))).toEqual(read('pyepfd-co2-opt-freq_property.txt'));
});

test('malformed and incomplete property files are refused rather than guessed', () => {
  const six = text('maa-apa-opt.property.txt'), five = text('pyepfd-co2-opt-freq_property.txt');
  expectLineEndingsIgnored(six, parseOrcaProperty);
  expectLineEndingsIgnored(five, parseOrcaProperty);
  const broken = [
    six.slice(0, six.lastIndexOf('$End')),
    six.replace('&Units "Bohr"', '&Units "Angstrom"'),
    six.replace('&GeometryIndex 2', '&GeometryIndex 9'),
    six.replace(/(&CartesianCoordinates[^\n]*\n\s+N\s+)\S+/, '$1nan'),
    six.replace('&AtomicCharges [&Type "ArrayOfDoubles", &Dim (14,1)]', '&AtomicCharges [&Type "ArrayOfDoubles", &Dim (13,1)]'),
    text('maa-apa-freq.property.txt').replace(/(&FREQ \[&Type "ArrayOfDoubles", &Units "cm\^-1", &Dim \()42/, '$141'),
    five.replace('Geometry Index:     2', 'Geometry Index:     7'),
    five.replace(/(Number of Rows: 9 Number of Columns: )9/, '$18'),
    five.replace(/\n\s+7\s+1370\.977201/, ''),
  ];
  for (const variant of broken) expect(() => parseOrcaProperty(variant)).toThrow();
  const failed = six.replace('"NORMAL TERMINATION"', '"ERROR TERMINATION"');
  expect(parseOrcaProperty(failed).converged).toBe(false);
});
