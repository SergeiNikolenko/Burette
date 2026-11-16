import { expect, test } from 'bun:test';
import { XTB_SIGNATURE, XTB_TRAJECTORY_SIGNATURE } from '../apps/desktop/src/lib/molecular-workbench/quantum/signatures';
import { parseXtbOutput, parseXtbTrajectory } from '../apps/desktop/src/lib/molecular-workbench/quantum/xtb';
import { parseGaussianLog } from '../apps/desktop/src/lib/molecular-workbench/quantum/gaussian-log';
import { cclibReference, expectClose, expectGeometries, expectLineEndingsIgnored, expectSchema, fixtureText } from './quantum-output-fixture';

const cclib = cclibReference('xtb');
const read = (name: string) => fixtureText(`xtb/${name}`);
/** xtb's own `vibspectrum` file of the same run: mode, [symmetry], wavenumber, IR intensity. */
function vibspectrum(name: string) {
  return read(name).split('\n').filter(line => /^\s+\d+\s/u.test(line)).map(line => {
    const p = line.trim().split(/\s+/), labelled = !/^-?\d/u.test(p[1]);
    return { mode: Number(p[0]), frequency: Number(p[labelled ? 2 : 1]), intensity: Number(p[labelled ? 3 : 2]) };
  });
}

test('xtb standard output keeps the final structure, its energy, orbital window, charges and dipole', () => {
  const text = read('water-opt.out');
  expect(XTB_SIGNATURE.test(text)).toBe(true);
  const document = parseXtbOutput(text), expected = cclib['water-opt.out'];
  expectGeometries(document, expected, 1e-12);
  expect(document.frames[0].energyHartree).toBe(expected.scfenergies!.at(-1));
  expect(document.converged).toBe(true);
  expectClose(document.frames[0].charges!.find(set => set.model === 'mulliken')!.values, expected.atomcharges!.mulliken, 1e-12);
  // cclib's xtb parser stores the printed eV column scaled as if it were Hartree; after its own
  // eV→Hartree conversion the reference holds the eV column, xtb's second print of each energy.
  expectClose(document.orbitals.map(orbital => orbital.energyHartree * 27.211386245988), expected.moenergies![0], 1e-4);
  expect(document.orbitals.filter(orbital => orbital.occupancy === 2)).toHaveLength(4);
  // Components are printed in a.u.; their norm is xtb's own printed total in debye.
  expect(Math.hypot(...document.frames[0].dipoleDebye!)).toBeCloseTo(2.216, 3);
  expectSchema(document);

  const dvb = parseXtbOutput(read('cclib-dvb-opt.out')), reference = cclib['cclib-dvb-opt.out'];
  expectGeometries(dvb, reference, 1e-12);
  expect(dvb.frames[0].energyHartree).toBe(reference.scfenergies!.at(-1));
  // The printed window skips orbitals 2–12 and 37–49 (the last one, 50, is printed); source numbers are kept.
  expect(dvb.orbitals.map(orbital => orbital.index)).toEqual([0, ...Array.from({ length: 24 }, (_, k) => k + 12), 49]);
  expect(dvb.orbitals.find(orbital => orbital.index === 24)).toMatchObject({ occupancy: 2, energyHartree: -0.3738783 });
  expect(dvb.orbitals.find(orbital => orbital.index === 25)).toMatchObject({ occupancy: 0, energyHartree: -0.2629582 });
  expectClose(dvb.frames[0].charges![0].values, reference.atomcharges!.mulliken, 1e-12);
  expectSchema(dvb);

  const coord = parseXtbOutput(read('water-coord-opt.out'));
  // The Turbomole $coord final structure is in bohr: the same optimum as the XYZ run.
  expectClose(coord.atoms.flatMap(atom => [atom.x, atom.y, atom.z]), document.atoms.flatMap(atom => [atom.x, atom.y, atom.z]), 1e-6);
  expect(parseXtbOutput(read('water-gfnff-opt.out')).frames[0].energyHartree).toBe(cclib['water-gfnff-opt.out'].scfenergies!.at(-1));
});

test('xtb runs that stop early or print no geometry are reported truthfully', () => {
  const unconverged = parseXtbOutput(read('water-unconverged.out'));
  expect(unconverged.converged).toBe(false);
  expect(unconverged.frames[0].energyHartree).toBe(cclib['water-unconverged.out'].scfenergies!.at(-1));
  expect(() => parseXtbOutput(read('water-sp.out'))).toThrow(/xtbopt\.xyz/);
  expect(cclib['water-sp.out'].atomcoords).toEqual([[]]);
  expectLineEndingsIgnored(read('water-opt.out'), parseXtbOutput);
  const text = read('water-opt.out');
  expect(() => parseXtbOutput(text.replace(/(final structure:\n=+\n3\n[^\n]*\n)O/u, '$1Xx'))).toThrow();
  const last = text.lastIndexOf('2.0000           -0.6800870');
  expect(() => parseXtbOutput(`${text.slice(0, last)}3${text.slice(last + 1)}`)).toThrow();
});

test('xtbopt.log trajectories keep every optimizer step with the cycle energies xtb printed', () => {
  const text = read('water-opt-xtbopt.log');
  expect(XTB_TRAJECTORY_SIGNATURE.test(text)).toBe(true);
  const trajectory = parseXtbTrajectory(text), cycles = cclib['water-opt.out'].scfenergies!;
  expect(trajectory.frames).toHaveLength(cycles.length);
  expectClose(trajectory.frames.map(frame => frame.energyHartree!), cycles, 5e-8);
  expectClose(trajectory.atoms.flatMap(atom => [atom.x, atom.y, atom.z]), parseXtbOutput(read('water-opt.out')).atoms.flatMap(atom => [atom.x, atom.y, atom.z]), 1e-12);
  expectSchema(trajectory);
  const stopped = parseXtbTrajectory(read('water-unconverged-xtbopt.log'));
  expect(stopped.frames).toHaveLength(2);
  // A frame cut while being written is dropped; the complete ones stay.
  expect(parseXtbTrajectory(text.slice(0, text.lastIndexOf('H '))).frames).toHaveLength(cycles.length - 1);
  expect(() => parseXtbTrajectory(text.replace(/ energy: -5\.070387329309 gnorm: \S+ xtb: \S+ \S+/u, ' frame two'))).toThrow();
  expect(() => parseXtbTrajectory(text.replace(/\nH( +-?0\.0+ +0\.772)/u, '\nC$1'))).toThrow();
});

test('xtb Gaussian-format frequency output agrees with xtb\'s vibspectrum and drops placeholder columns', () => {
  for (const [g98, spectrum] of [['water-ohess-g98.out', 'water-ohess-vibspectrum'], ['cclib-dvb-ir-g98.out', 'cclib-dvb-ir-vibspectrum']]) {
    const document = parseGaussianLog(read(g98));
    expect(document.format).toBe('xtb');
    const vibrations = vibspectrum(spectrum).filter(row => Math.abs(row.frequency) > 1);
    expectClose(document.modes.map(mode => mode.frequencyCm1), vibrations.map(row => row.frequency), 0.005);
    expectClose(document.modes.map(mode => mode.intensityKmMol!), vibrations.map(row => row.intensity), 6e-5);
    // xtb prints zeros for quantities it never computed; they are not data.
    expect(document.modes.every(mode => mode.ramanActivityAngstrom4Amu === undefined && mode.forceConstantMdynAngstrom === undefined && mode.reducedMassAmu! > 0)).toBe(true);
    expect(document.modes.every(mode => mode.displacements!.length === document.atoms.length)).toBe(true);
  }
  // The g98 geometry is the converged structure of the same run (printed to 6 decimals).
  const water = parseGaussianLog(read('water-ohess-g98.out')), optimum = parseXtbOutput(read('water-ohess.out'));
  expectClose(water.atoms.flatMap(atom => [atom.x, atom.y, atom.z]), optimum.atoms.flatMap(atom => [atom.x, atom.y, atom.z]), 1e-5);
  expectSchema(water);
});
