import {expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {parseScientificFile} from "../apps/desktop/src/lib/molecular-workbench/quantum";

const gaussian = readFileSync(new URL('./fixtures/quantum/gaussian-water-optimization.log', import.meta.url), 'utf8');
const gradient = readFileSync(new URL('./fixtures/quantum/qcschema-water-gradient.json', import.meta.url), 'utf8');
const read = (value: unknown) => parseScientificFile('result.qcschema', JSON.stringify(value));
const result = () => JSON.parse(gradient);
const block = gaussian.match(/\s*Standard orientation:[\s\S]*?\n -{5,}\n(?= SCF Done)/)![0];

test('independent Gaussian 16 optimization keeps printed angstrom coordinates, SCF energies and final-only modes', () => {
  const doc = parseScientificFile('water.log', gaussian);
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
  const doc = parseScientificFile('water.log', imaginary + block);
  expect(doc.modes).toEqual([]);
  expect(doc.frames.at(-2)!.modes![0]).toMatchObject({ frequencyCm1: -1668.2293, forceConstantMdynAngstrom: -1.7741 });
  const inputOnly = block.replace('Standard orientation:', 'Input orientation:');
  expect(parseScientificFile('water.log', inputOnly).atoms).toHaveLength(3);
  expect(parseScientificFile('water.log', gaussian + inputOnly).frames).toHaveLength(6);
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
  for (const text of changes) expect(() => parseScientificFile('bad.log', text)).toThrow();
  expect(() => parseScientificFile('bad.log', 'Entering Gaussian System\n SCF Done:  E(RHF) = -1 A.U.')).toThrow('geometry');
});

test('MolSSI gradient reference keeps atom order, converts bohr to angstrom and negative gradient to forces', () => {
  const doc = parseScientificFile('water.json', gradient);
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
  expect(() => parseScientificFile('x.qcschema', gradient.slice(0, -5))).toThrow('JSON');
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

test('quantum readers reject binary and over-limit input and over-limit trajectories', () => {
  expect(() => parseScientificFile('x.qcschema', gradient + '\0')).toThrow();
  expect(() => parseScientificFile('x.log', 'x'.repeat(16 * 1024 * 1024 + 1))).toThrow('16 MiB');
  expect(() => parseScientificFile('x.log', 'Entering Gaussian System\n' + block.repeat(2001))).toThrow('limit');
  const d = optimization(); d.trajectory = Array(2001).fill(d.trajectory[0]); d.energies = Array(2001).fill(d.energies[0]);
  expect(() => read(d)).toThrow('bounded');
});
