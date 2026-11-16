import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from '../apps/desktop/node_modules/fflate';
import { decodeScienceSession, encodeScienceSession, validateScientificDocument } from '../apps/desktop/src/lib/science-session/codec';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import { serializeXyz } from '../apps/desktop/src/lib/molecular-workbench/xyz';
import { readFileSync } from 'node:fs';
import { fixtureText } from './quantum-output-fixture';

// One real output per reader feature: per-geometry Hessians, charges and dipoles (NWChem),
// basis and MO coefficients (GAMESS, Gaussian, QCSchema), unrestricted orbitals, frame
// gradients, ORCA property-file modes and the fields of a multi-dataset Cube.
const FIXTURES = [
  'nwchem/water-opt-freq.out', 'psi4/water-opt-freq.out', 'xtb/water-ohess.out', 'gamess/cclib-dvb_sp.out', 'qchem/cclib-water_mp2.out',
  'molpro/cclib-dvb_ir.out', 'gaussian/cclib-dvb_sp.out', 'qcschema/hydroxyl-uhf-wavefunction.json', 'qcschema/water-hf-hessian.json',
  'orca-property/maa-apa-freq.property.txt', 'orca-property/maa-apa-opt.property.txt',
];

// JSON has no negative zero; typed arrays keep it.
const unsignedZero = (value: unknown): unknown => typeof value === 'number' ? value || 0 : Array.isArray(value) ? value.map(unsignedZero)
  : value && typeof value === 'object' && !ArrayBuffer.isView(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unsignedZero(item)])) : value;

test('scene files keep every reader\'s scientific document exactly', async () => {
  const cube = readFileSync(new URL('./fixtures/oblique-angstrom-3fields.cube', import.meta.url), 'utf8');
  for (const path of [...FIXTURES, 'oblique-angstrom-3fields.cube']) {
    const science = parseScientificFile(path.split('/').at(-1)!, path.endsWith('.cube') ? cube : fixtureText(path));
    const text = serializeXyz(science.atoms, 'final');
    const encoded = await encodeScienceSession({ documentUuid: crypto.randomUUID(), source: { extension: 'xyz', text }, atomIds: null,
      binding: { structureRef: 's', modelRef: 'm', trajectoryRef: 't', frameIndex: 0, frameCount: 1, atomCount: science.atoms.length }, science, original: null });
    const archive = zipSync({ 'state.json': strToU8('{"entries":[]}'), 'assets.json': strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, name: asset.name }]))),
      ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) });
    const decoded = await decodeScienceSession(archive);
    expect({ path, science: decoded!.science }).toEqual({ path, science: unsignedZero(science) });
  }
});

test('grid datasets must share the first field\'s grid and the grid budget', () => {
  const science = parseScientificFile('fields.cube', readFileSync(new URL('./fixtures/oblique-angstrom-3fields.cube', import.meta.url), 'utf8'));
  const source = [{ elements: science.atoms.map(atom => atom.element), positions: Float64Array.from(science.atoms.flatMap(atom => [atom.x, atom.y, atom.z])) }];
  expect(validateScientificDocument(science, source)).toBe(science);
  const variants: Array<(d: typeof science) => void> = [
    d => { d.gridDatasets![1].grid = { ...d.gridDatasets![1].grid, origin: [0, 0, 0] }; },
    d => { d.gridDatasets![0].grid = d.gridDatasets![1].grid; },
    d => { d.gridDatasets = d.gridDatasets!.slice(0, 1); },
    d => { d.gridDatasets![2].label = ''; },
    d => { d.gridDatasets![2].orbitalNumber = 0; },
    d => { delete d.grid; },
    d => { d.gridDatasets = Array(30_000).fill(d.gridDatasets![0]); }, // 36 values each
  ];
  for (const edit of variants) { const d = { ...science, gridDatasets: science.gridDatasets!.map(item => ({ ...item })) }; edit(d); expect(() => validateScientificDocument(d, source)).toThrow(); }
});
