import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import * as ocl from 'openchemlib';

const scope: Record<string, any> = {};
vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/molecule-preview-ocl.js', import.meta.url), 'utf8'), { window: scope, TextEncoder });
const render = (source: string, hydrogens = true, engine: any = ocl) => scope.BuretteMoleculePreviewOcl.render(source, hydrogens, 400, engine) as string;
function drawing(svg: string) { return new (new Window()).DOMParser().parseFromString(svg, 'image/svg+xml').documentElement; }
const atomRows = (svg: string) => [...drawing(svg).querySelectorAll('.buret-preview-atom')].map(atom => ({
  source: Number(atom.getAttribute('data-source-atom-index')), position: atom.getAttribute('data-source-position')!.split(',').map(Number),
  point: [Number(atom.getAttribute('cx')), Number(atom.getAttribute('cy'))],
})).sort((a, b) => a.source - b.source);
function nitro(ids = [10, 30, 90, 1000, 2000], label = 'CHG=8') {
  return ['Gapped nitromethane', 'Burette  3D', '', '  0  0  0     0  0            999 V3000', 'M  V30 BEGIN CTAB',
    'M  V30 COUNTS 5 3 0 0 0', 'M  V30 BEGIN ATOM', `M  V30 ${ids[0]} C 8.123456 3.5 -2 0 LABEL="${label}" -`,
    'M  V30 CHG=0', `M  V30 ${ids[1]} N 9.5 3.5 -2 0 CHG=1`, `M  V30 ${ids[2]} O 10.2 4.6 -2 0 CHG=-1`,
    `M  V30 ${ids[3]} O 10.2 2.4 -2 0`, `M  V30 ${ids[4]} F 13 3.5 -2 0`, 'M  V30 END ATOM', 'M  V30 BEGIN BOND',
    `M  V30 500 1 ${ids[0]} ${ids[1]}`, `M  V30 900 1 ${ids[1]} ${ids[2]}`, `M  V30 1700 2 ${ids[1]} ${ids[3]}`,
    'M  V30 END BOND', 'M  V30 END CTAB', 'M  END', '> <COMMENT>', 'CHG=99 is foreign data', '', '$$$$', ''].join('\n');
}
function capture() {
  let molecule: ocl.Molecule, before: ReturnType<typeof state>;
  const state = (m: ocl.Molecule) => ({
    atoms: Array.from({ length: m.getAllAtoms() }, (_, i) => [m.getAtomLabel(i), m.getAtomCharge(i), m.getAtomMass(i), m.getAtomCustomLabel(i)]),
    bonds: Array.from({ length: m.getAllBonds() }, (_, i) => [m.getBondAtom(0, i), m.getBondAtom(1, i), m.getBondOrder(i)]),
  });
  const engine = { Molecule: { cHelperCIP: ocl.Molecule.cHelperCIP, fromMolfileWithAtomMap(source: string) {
    const result = ocl.Molecule.fromMolfileWithAtomMap(source); molecule = result.molecule; before = state(molecule); return result;
  } } };
  return { engine, get molecule() { return molecule; }, unchanged: () => expect(state(molecule)).toEqual(before) };
}

test('real OCL depicts quoted-equals V3000, preserving charged graph, arbitrary source positions and gapped/permuted IDs', () => {
  for (const ids of [[10, 30, 90, 1000, 2000], [3, 1, 7, 2, 6]]) {
    const source = nitro(ids), bytes = Buffer.from(source), probe = capture(), svg = render(source, true, probe.engine);
    expect(svg).toContain('<svg'); probe.unchanged(); expect(Buffer.from(source)).toEqual(bytes);
    expect(Array.from({ length: 5 }, (_, i) => probe.molecule.getAtomCharge(i))).toEqual([0, 1, -1, 0, 0]);
    const atoms = atomRows(svg);
    expect(atoms.map(({ source, position }) => ({ source, position }))).toEqual([
      { source: 0, position: [8.123456, 3.5, -2] }, { source: 1, position: [9.5, 3.5, -2] },
      { source: 2, position: [10.2, 4.6, -2] }, { source: 3, position: [10.2, 2.4, -2] }, { source: 4, position: [13, 3.5, -2] },
    ]);
    expect(atoms.every(atom => atom.point.every(value => Number.isFinite(value) && value >= 0 && value <= 400))).toBe(true);
    expect(drawing(svg).querySelectorAll('path.bond-2.atom-1.atom-3')).toHaveLength(1);
    expect(drawing(svg).querySelectorAll('line[stroke="var(--depiction-carbon)"]')).not.toHaveLength(0);
  }
});

test('explicit H before heavy atoms remains source-addressable after OCL reordering and both H display modes', () => {
  const source = ['H first', 'Burette  3D', '', '  0  0  0     0  0            999 V3000', 'M  V30 BEGIN CTAB',
    'M  V30 COUNTS 4 3 0 0 0', 'M  V30 BEGIN ATOM', 'M  V30 40 H 1.25 -2.5 3.75 0', 'M  V30 10 O 4 5 -6 0',
    'M  V30 30 C 7 -8 9 0', 'M  V30 20 H -10 11 12 0', 'M  V30 END ATOM', 'M  V30 BEGIN BOND',
    'M  V30 1 1 40 10', 'M  V30 2 1 10 30', 'M  V30 3 1 30 20', 'M  V30 END BOND', 'M  V30 END CTAB', 'M  END', '$$$$'].join('\n');
  const probe = capture(), shown = atomRows(render(source, true, probe.engine)), hidden = atomRows(render(source, false));
  expect(Array.from({ length: 4 }, (_, i) => [probe.molecule.getAtomLabel(i), probe.molecule.getAtomMapNo(i) - 1])).toEqual([['C', 2], ['O', 1], ['H', 0], ['H', 3]]);
  expect(shown.map(({ source, position }) => ({ source, position }))).toEqual([
    { source: 0, position: [1.25, -2.5, 3.75] }, { source: 1, position: [4, 5, -6] },
    { source: 2, position: [7, -8, 9] }, { source: 3, position: [-10, 11, 12] },
  ]);
  expect(hidden.map(({ source, position }) => ({ source, position }))).toEqual(shown.slice(1, 3).map(({ source, position }) => ({ source, position })));
  expect(atomRows(render(source))).toEqual(shown);
});

test('a disposable stereo depiction retains aliases, charges and stereochemical identity, with safe theme-compatible SVG', () => {
  const original = ocl.Molecule.fromSmiles('C[C@H](O)C(=O)[O-]');
  original.setAtomCustomLabel(0, 'R=1 <script>alert(1)</script>');
  const source = original.toMolfile({ includeCustomAtomLabelsAsALines: true }), id = original.getIDCode(), probe = capture();
  const svg = render(source, true, probe.engine), dom = drawing(svg);
  probe.unchanged(); expect(probe.molecule.getIDCode()).toBe(id); expect(original.getIDCode()).toBe(id);
  expect(dom.querySelectorAll('script, foreignObject, image, [onclick], [onload]')).toHaveLength(0);
  expect(dom.textContent).toContain('R=1 <script>alert(1)</script>');
  expect(svg).toContain('var(--depiction-carbon)'); expect(svg).toContain('var(--depiction-oxygen)');
  expect(svg).not.toMatch(/rgb\(0,\s*0,\s*0\)/u); expect(svg).not.toContain('fill="white"');
  expect(dom.querySelectorAll('polygon, line[stroke="var(--depiction-carbon)"]')).not.toHaveLength(0);
  expect(atomRows(svg)).toHaveLength(original.getAllAtoms());
});

test('malformed, multiple-record and oversized inputs reject before any partial depiction or unsafe allocation', () => {
  let calls = 0;
  const neverParse = { Molecule: { fromMolfileWithAtomMap() { calls++; throw new Error('must not allocate'); } } };
  for (const source of [nitro().replace('COUNTS 5 3', 'COUNTS 513 3'), nitro().replace('COUNTS 5 3', 'COUNTS 1000000000 3'),
    nitro() + nitro(), 'x'.repeat(2_000_001), nitro().replace('8.123456', 'NaN'), nitro().replace('8.123456', '1e99'),
    nitro().replace('M  V30 30 N', 'M  V30 10 N'), nitro().replace('M  END', '')]) expect(() => render(source, true, neverParse)).toThrow();
  expect(calls).toBe(0);
  for (const source of ['not a molecule', nitro().replace('500 1 10 30', '500 1 10 999'), nitro().replace('M  V30 END ATOM', 'M  V30 END BOND')]) {
    expect(() => render(source)).toThrow();
  }
});

test('an oversized real alias cannot return unbounded SVG', () => {
  const molecule = ocl.Molecule.fromSmiles('CO'); molecule.setAtomCustomLabel(0, '<&'.repeat(225_000));
  const source = molecule.toMolfile({ includeCustomAtomLabelsAsALines: true });
  expect(source.length).toBeLessThan(2_000_000);
  expect(() => render(source)).toThrow();
});

test('the packaged OCL browser global supplies the same real drawing and source hit geometry', () => {
  const bundled = vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/openchemlib/openchemlib.js', import.meta.url), 'utf8')
    + ';BuretteOpenChemLib;', { TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval });
  const svg = render(nitro(), true, bundled);
  expect(atomRows(svg)).toEqual(atomRows(render(nitro())));
  expect(drawing(svg).querySelectorAll('path[class*="bond-"]')).toHaveLength(3);
  expect(drawing(svg).textContent).toContain('+');
});
