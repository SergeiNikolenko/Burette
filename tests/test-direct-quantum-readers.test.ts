import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseGaussianLog } from '../apps/desktop/src/lib/molecular-workbench/quantum/gaussian-log';
import { parseQcschema } from '../apps/desktop/src/lib/molecular-workbench/quantum/qcschema';
import { parseExtendedFrame, trajectoryMetadata } from '../apps/desktop/src/lib/molecular-workbench/trajectory-metadata';

const gaussian = readFileSync(new URL('./fixtures/quantum/gaussian-water-optimization.log', import.meta.url), 'utf8');
const gradient = readFileSync(new URL('./fixtures/quantum/qcschema-water-gradient.json', import.meta.url), 'utf8');
const read = (value: unknown) => parseQcschema(JSON.stringify(value));
const result = () => JSON.parse(gradient);
const block = gaussian.match(/\s*Standard orientation:[\s\S]*?\n -{5,}\n(?= SCF Done)/)![0];

test('independent Gaussian 16 optimization keeps printed angstrom coordinates, SCF energies and final-only modes', () => {
  const doc = parseGaussianLog(gaussian);
  expect(doc.format).toBe('gaussian-log');
  expect(doc.frames).toHaveLength(5);
  expect(doc.frames.map(f => f.energyHartree)).toEqual([-76.3329398833, -76.3404588388, -76.340665699, undefined, -76.340665699]);
  expect(doc.atoms).toBe(doc.frames.at(-1)!.atoms);
  expect(doc.atoms[1]).toEqual({ element: 'H', x: -0, y: .755981, z: -.475764 });
  expect(doc.frames.slice(0, -1).every(f => f.modes === undefined)).toBe(true);
  expect(doc.modes.map(m => [m.frequencyCm1, m.intensityKmMol, m.displacements?.length])).toEqual([[1668.2293, 89.6988, 3], [3866.1598, 8.4803, 3], [3976.5311, 44.2991, 3]]);
  expect(doc.converged).toBe(true);
  expect(doc.orbitals).toEqual([]);
});

test('Gaussian imaginary frequencies retain signed force constants and modes never move to a later geometry', () => {
  const imaginary = gaussian.replace('1668.2293', '-1668.2293').replace('1.7741', '-1.7741');
  const doc = parseGaussianLog(imaginary + block);
  expect(doc.modes).toEqual([]);
  expect(doc.frames.at(-2)!.modes![0]).toMatchObject({ frequencyCm1: -1668.2293, forceConstantMdynAngstrom: -1.7741 });
  const inputOnly = block.replace('Standard orientation:', 'Input orientation:');
  expect(parseGaussianLog(inputOnly).atoms).toHaveLength(3);
  expect(parseGaussianLog(gaussian + inputOnly).frames).toHaveLength(6);
});

test('Gaussian rejects incomplete coordinates, changing atom order, invalid values and truncated normal coordinates', () => {
  const changes = [
    gaussian.slice(0, gaussian.indexOf('0.136622') + 3),
    gaussian.replace('0.136622', 'NaN'),
    gaussian.replace('0.136622', '1E999'),
    gaussian.replace('      1          8', '      1          0'),
    gaussian.replace(/(Standard orientation:[\s\S]*?)(      2          1)/, '$1      2          6'),
    gaussian.slice(0, gaussian.lastIndexOf('     3   1')),
    gaussian.replace('89.6988', '-89.6988'),
    gaussian.replace('    -0.00  -0.00  -0.07', '    -0.00  -0.00'),
  ];
  for (const text of changes) expect(() => parseGaussianLog(text)).toThrow();
  expect(() => parseGaussianLog('Entering Gaussian System\n SCF Done:  E(RHF) = -1 A.U.')).toThrow('geometry');
});

test('MolSSI gradient reference keeps atom order, converts bohr to angstrom and negative gradient to forces', () => {
  const doc = parseQcschema(gradient);
  expect(doc.format).toBe('qcschema');
  expect(doc.atoms.map(a => a.element)).toEqual(['O', 'H', 'H']);
  expect(doc.atoms[0].z).toBeCloseTo(-.06851624661707532, 14);
  expect(doc.frames[0].energyHartree).toBe(-76.02141836717794);
  expect(doc.frames[0].forcesKcalMolAngstrom![0][2]).toBeCloseTo(70.65778843696584, 10);
  expect(doc.frames[0].forcesKcalMolAngstrom!.map(f => f[2]).reduce((a,b) => a+b, 0)).toBeCloseTo(0, 9);
});

function optimization() {
  const initial = result().molecule;
  const step = result();
  step.molecule.geometry[2] += .1;
  const final = structuredClone(step.molecule);
  final.geometry[2] += .1;
  return { schema_name: 'qcschema_optimization_output', schema_version: 1, success: true,
    initial_molecule: initial, final_molecule: final, trajectory: [step], energies: [-76.02141836717794] };
}

test('QCSchema optimization retains initial, step and final geometries without transferring gradients or energies', () => {
  const input = optimization();
  const doc = read(input);
  expect(doc.frames).toHaveLength(3);
  expect(doc.frames.map(f => [f.energyHartree, f.forcesKcalMolAngstrom?.length])).toEqual([[undefined, undefined], [-76.02141836717794, 3], [undefined, undefined]]);
  expect(doc.atoms).toBe(doc.frames[2].atoms);
  expect(doc.converged).toBe(true);
  input.initial_molecule = structuredClone(input.trajectory[0].molecule);
  input.final_molecule = structuredClone(input.initial_molecule);
  expect(read(input).frames).toHaveLength(1);
});

test('QCSchema molecule and energy results read explicit values without inventing modes or orbitals', () => {
  expect(read(result().molecule).frames).toHaveLength(1);
  const energy = result(); energy.driver = 'energy'; energy.return_result = energy.properties.return_energy;
  expect(read(energy).frames[0].energyHartree).toBe(energy.return_result);
  expect(read(energy).modes).toEqual([]);
});

test('QCSchema rejects malformed JSON, dimensions, units, ghost atoms, unsupported versions and inconsistent energies', () => {
  expect(() => parseQcschema(gradient.slice(0, -5))).toThrow('JSON');
  const edits: Array<(d: ReturnType<typeof result>) => void> = [
    (d) => { d.molecule.geometry.pop(); }, (d) => { d.molecule.geometry[0] = '0'; },
    (d) => { d.molecule.geometry[0] = 1e300; }, (d) => { d.molecule.real = [true, false, true]; },
    (d) => { d.molecule.atomic_numbers = [1, 8, 1]; }, (d) => { d.molecule.units = 'angstrom'; },
    (d) => { d.schema_version = 2; }, (d) => { d.success = false; },
    (d) => { d.return_result.pop(); }, (d) => { d.driver = 'hessian'; },
    (d) => { d.molecule.masses = [-1, 1, 1]; },
    (d) => { d.driver = 'energy'; d.return_result = -70; },
  ];
  for (const edit of edits) { const d = result(); edit(d); expect(() => read(d)).toThrow(); }
  for (const field of ['symbols', 'masses', 'energies'] as const) {
    const d = optimization();
    if (field === 'symbols') d.final_molecule.symbols.reverse();
    if (field === 'masses') d.final_molecule.masses = [16, 2, 1];
    if (field === 'energies') d.energies[0] = 1;
    expect(() => read(d)).toThrow();
  }
});

test('direct readers reject malformed JSON and over-limit explicit trajectories', () => {
  expect(() => parseQcschema(gradient + '\0')).toThrow();
  expect(() => parseGaussianLog('Entering Gaussian System\n' + block.repeat(2001))).toThrow('limit');
  const d = optimization(); d.trajectory = Array(2001).fill(d.trajectory[0]); d.energies = Array(2001).fill(d.energies[0]);
  expect(() => read(d)).toThrow('bounded');
  d.trajectory.pop(); d.energies.pop();
  expect(() => read(d)).toThrow('browser limit'); // Retained initial/final frames count too.
});

const extended = 'Properties=species:S:1:pos:R:3:vel:R:3:force:R:3 velocity_unit=angstrom/fs force_unit=eV/angstrom time=20 fs temperature=300 K energy=-27.211386245988 eV';
const rows = ['H 0 0 0 .01 0 0 .1 0 0', 'H .74 0 0 -.01 0 0 -.1 0 0'];
test('explicit XYZ metadata retains row order and converts declared vector and scalar units', () => {
  const f = parseExtendedFrame(extended, rows)!;
  expect(f.atoms.map(a => [a.element, a.x])).toEqual([['H', 0], ['H', .74]]);
  expect(f.energyHartree).toBeCloseTo(-1, 12);
  expect([f.timePs, f.temperatureKelvin]).toEqual([.02, 300]);
  expect(f.velocitiesAngstromPerPs).toEqual([[10,0,0],[-10,0,0]]);
  expect(f.forcesKcalMolAngstrom![0][0]).toBeCloseTo(2.30605478306, 10);
  expect(() => parseExtendedFrame(extended.replace('velocity_unit=angstrom/fs', ''), rows)).toThrow('velocity_unit');
  expect(() => parseExtendedFrame(extended.replace('temperature=300', 'temperature=-300'), rows)).toThrow('negative');
});
test('unitless XYZ comments do not invent vectors, energy, time or temperature', () => {
  expect(trajectoryMetadata('energy=-1 time=20 temperature=300')).toEqual({});
  expect(parseExtendedFrame('no property declaration', ['He 0 0 0'])).toBeNull();
  expect(() => trajectoryMetadata('time=1e308 ns')).toThrow('range');
  expect(() => parseExtendedFrame(extended, [rows[0].replace('.01', '1e308'), rows[1]])).toThrow('range');
});
test('direct readers bound atom counts, explicit column dimensions and finite numbers', () => {
  const d = result(); d.molecule.symbols = Array(10_001).fill('H'); d.molecule.geometry = Array(30_003).fill(0);
  expect(() => read(d)).toThrow('atom limit');
  expect(() => parseExtendedFrame(extended, [rows[0].slice(0, -2)])).toThrow('property declaration');
  expect(() => parseExtendedFrame(extended.replace('pos:R:3', 'pos:R:65'), rows)).toThrow('columns');
  const wide = 'Properties=' + Array.from({ length: 5 }, (_, i) => `field${i}:R:64`).join(':');
  expect(() => parseExtendedFrame(wide, [])).toThrow('columns');
  expect(() => parseGaussianLog(gaussian.replace('0.136622', '1000001'))).toThrow('coordinates');
  expect(parseGaussianLog(gaussian.replace('0.136622', '1.36622D-1')).frames[0].atoms[0].z).toBe(.136622);
});

test('QCSchema retained-value bounds apply even within the dispatcher text cap', () => {
  const molecule = { schema_name: 'qcschema_molecule', schema_version: 2, symbols: Array(10_000).fill('H'), geometry: Array(30_000).fill(0) };
  const step = { schema_name: 'qcschema_output', schema_version: 1, success: true, driver: 'properties', molecule, return_result: {} };
  const text = JSON.stringify({ schema_name: 'qcschema_optimization_output', schema_version: 1, success: true, initial_molecule: molecule, final_molecule: molecule, trajectory: Array(67).fill(step), energies: Array(67).fill(0) });
  expect(Buffer.byteLength(text)).toBeLessThan(16 * 1024 * 1024);
  expect(() => parseQcschema(text)).toThrow('browser limit');
});

test('QCSchema duplicated gradients agree in ordered finite dimensions', () => {
  const d = result(), baseline = read(d);
  for (const reported of [undefined, null, [...d.return_result]]) {
    d.properties.return_gradient = reported; expect(read(d)).toEqual(baseline);
  }
  for (const reported of [d.return_result.slice(1), d.return_result.map((v: number, i: number) => i === 2 ? v + 1 : v), ['bad', ...d.return_result.slice(1)]]) {
    d.properties.return_gradient = reported; expect(() => read(d)).toThrow();
  }
});
test('QCSchema properties results require their dictionary', () => {
  const d = result(); d.driver = 'properties'; d.return_result = {};
  expect(read(d).frames).toHaveLength(1);
  for (const invalid of [undefined, null, 17, [], 'not properties']) { d.return_result = invalid; expect(() => read(d)).toThrow(); }
});
test('Extended XYZ whitespace and quoted keys preserve every declared vector and scalar', () => {
  const expected = parseExtendedFrame(extended, rows)!;
  for (const comment of [extended.replace(/Properties=(\S+)/, 'Properties = "$1"'), extended.replace(/(velocity_unit|force_unit)=(\S+)/g, '$1 = "$2"'), extended.replace(/=/g, '\t=\t'), extended.replace('Properties=', '"Properties" = ')]) {
    const frame = parseExtendedFrame(comment, rows)!;
    expect({ ...frame, comment: expected.comment }).toEqual({ ...expected, comment: expected.comment });
  }
});
test('quoted and escaped notes cannot supply keys, physical quantities or units', () => {
  const declaration = 'Properties=species:S:1:pos:R:3:vel:R:3';
  for (const note of ['note="old Properties=broken velocity_unit=angstrom/fs energy=-1 Eh"', String.raw`note="old Properties=broken \\windows \"velocity_unit=angstrom/fs\" energy=-1 Eh"`, '"description Properties=broken velocity_unit=angstrom/fs energy=-1 Eh"']) {
    const comment = `${declaration} ${note} velocity_unit=angstrom/ps energy="-2 Eh"`;
    const frame = parseExtendedFrame(comment, ['H 0 0 0 1 0 0'])!;
    expect([frame.velocitiesAngstromPerPs, frame.energyHartree]).toEqual([[[1,0,0]], -2]);
    expect(parseExtendedFrame(`${note} ${declaration} velocity_unit="angstrom\\/ps"`, ['H 0 0 0 1 0 0'])!.velocitiesAngstromPerPs).toEqual([[1,0,0]]);
  }
});
