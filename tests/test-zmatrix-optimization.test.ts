import { expect, test } from 'bun:test';
import { parseScientificFile } from '../apps/desktop/src/lib/molecular-workbench/quantum';
import { atomsFromZmatrixDocument, formatZmatrixDocument, parseZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { atomsFromZmatrixRows, parseXyzAtoms, placeInReferenceFrame } from '../scripts/internal-coordinates.mjs';
import { resolveZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { measureGeometry } from '../scripts/molecular-geometry.js';
import { zmatrixDocumentFromAtoms } from '../scripts/zmatrix-export.mjs';
import { zmatrixAfterOptimization, zmatrixAtomIndices, zmatrixConstraints, zmatrixLockUnavailable } from '../apps/desktop/src/lib/workbench/zmatrix-optimization';
import { withRowValue, withVariable, zmatrixOptimizedRevision, zmatrixRevision, zmatrixRowLabels, zmatrixRowsRevision } from '../apps/desktop/src/lib/workbench/zmatrix-draft';
import { editZmatrixRows } from '../scripts/zmatrix-rows.mjs';
import { parseXyz, serializeXyz } from '../apps/desktop/src/lib/molecular-workbench/xyz';

// Independent references: geometry is built here by hand or measured with the shared
// Cartesian kernel; the mapping is judged only by what the rebuilt definition places.
type Atom = { element: string; position: number[] };
const water = 'O\nX 1 1.0\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 0.9572\nA = 52.26\n';
test('an almost axial reference and a long lever allow edit, optimization and row removal', () => {
  const definition = parseZmatrixDocument('C\nN 1 1.2\nO 2 1.3 1 179.99998917895974\nH 1 58.28813648922369 2 70 3 90\n');
  const atoms = [
    { element: 'C', x: 96.04358445081837, y: -72.96429778085997, z: -84.0994508055404 },
    { element: 'N', x: 94.99213744363406, y: -73.4833565560105, z: -83.8444269262224 },
    { element: 'O', x: 93.85306985479613, y: -74.04567012456036, z: -83.56815083481449 },
    { element: 'H', x: 104.96800465645592, y: -125.11874377566777, z: -59.650006182926674 },
  ];
  const text = serializeXyz(atoms);
  const science = { ...parseScientificFile('geometry.xyz', text), internalCoordinates: definition };
  const edited = withRowValue(definition, 2, 1, 179.9999918842198);
  const revision = zmatrixRevision(science, edited, text, [{ text, document: science }]);
  const output = revision.document.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
  expectRebuilds(edited, output, 1e-9);
  expect(() => zmatrixAfterOptimization(edited, output, output, ['C1', 'N2', 'O3', 'H4'])).not.toThrow();
  expect(() => editZmatrixRows(edited, { type: 'remove', index: 3 }, output)).not.toThrow();
});
const labels = (text: string) => {
  let atoms = 0, points = 0;
  return parseZmatrixDocument(text).rows.map((row) => (row.element === 'X' ? `Ref ${++points}` : `${row.element}${++atoms}`));
};
const at = (atoms: number[][], indices: number[]) => indices.map((i) => ({ id: String(i), position: atoms[i] }));
const measure = (kind: 'distance' | 'angle' | 'dihedral', atoms: number[][], indices: number[]) => measureGeometry(kind, at(atoms, indices)).value;
// A proper rotation (unit quaternion) followed by a translation.
function rigid(atoms: Atom[], [w, x, y, z] = [0.8, 0.2, -0.4, 0.4], shift = [3, -2, 7]): Atom[] {
  const n = Math.hypot(w, x, y, z);
  [w, x, y, z] = [w / n, x / n, y / n, z / n];
  const r = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  return atoms.map(({ element, position }) => ({ element, position: r.map((row, k) => row.reduce((s, v, j) => s + v * position[j], 0) + shift[k]) }));
}
// Water with O at the origin, O–H lengths r1, r2 and H–O–H angle in degrees, in the xy plane.
function waterAt(r1: number, r2: number, angle: number): Atom[] {
  const half = (angle / 2) * Math.PI / 180;
  return [
    { element: 'O', position: [0, 0, 0] },
    { element: 'H', position: [r1 * Math.sin(half), r1 * Math.cos(half), 0] },
    { element: 'H', position: [-r2 * Math.sin(half), r2 * Math.cos(half), 0] },
  ];
}
function expectRebuilds(document: ReturnType<typeof parseZmatrixDocument>, atoms: Atom[], tolerance = 1e-6) {
  // Through the file format, as Export Z-matrix writes and reopens it.
  const reopened = atomsFromZmatrixDocument(parseZmatrixDocument(formatZmatrixDocument(document)));
  const aligned = placeInReferenceFrame(reopened, atoms);
  for (const [i, atom] of aligned.entries()) {
    expect(atom.element).toBe(atoms[i].element);
    expect(Math.hypot(...atom.position.map((v, k) => v - atoms[i].position[k]))).toBeLessThan(tolerance);
  }
}

test('a rigid motion of the atoms keeps every value, binding and reference point exactly', () => {
  const definition = parseZmatrixDocument(water);
  const before = rigid(atomsFromZmatrixDocument(definition), [0.3, -0.5, 0.7, 0.2], [-4, 1, 2]);
  const after = rigid(before);
  const result = zmatrixAfterOptimization(definition, before, after, labels(water));
  expect(result.document).toEqual(definition);
  expect(result.detachedBindings).toEqual([]);
  expect(result.deviation).toBeLessThan(1e-9);
});

test('a symmetric optimization keeps shared variables bound and the reference point on the bisector', () => {
  const definition = parseZmatrixDocument(water);
  const before = atomsFromZmatrixDocument(definition);
  const after = rigid(waterAt(0.97, 0.97, 106));
  const result = zmatrixAfterOptimization(definition, before, after, labels(water));
  expect(result.detachedBindings).toEqual([]);
  expect(result.document.rows.map((row) => row.values)).toEqual(definition.rows.map((row) => row.values));
  const values = Object.fromEntries(result.document.variables.map(({ name, value }) => [name, value]));
  expect(values.R).toBeCloseTo(0.97, 10);
  // The reference point keeps its own distance and lies on the H–O–H bisector: each H is half the angle from it.
  expect(values.A).toBeCloseTo(53, 8);
  expect(result.document.rows[1].values).toEqual([1.0]);
  expectRebuilds(result.document, after);
});

test('an asymmetric Cartesian result cannot detach shared variables', () => {
  const definition = parseZmatrixDocument(water);
  const before = atomsFromZmatrixDocument(definition);
  const after = rigid(waterAt(0.95, 0.99, 104.1));
  const original = structuredClone(definition);
  expect(() => zmatrixAfterOptimization(definition, before, after, labels(water))).toThrow('does not preserve shared variable R');
  expect(definition).toEqual(original);
});

test('a converted collinear start keeps its reference point and rebuilds a perturbed geometry', () => {
  const xyz = '5\nleading collinear chain\nC 5 -7 11\nN 5.432 -6.424 10.04\nO 5.864 -5.848 9.08\nH 4.592 -5.794 10.04\nF 5.256 -4.492 9.62\n';
  const atoms = parseXyzAtoms(xyz);
  const definition = zmatrixDocumentFromAtoms(atoms);
  expect(definition.rows.map((row) => row.element)).toEqual(['C', 'N', 'X', 'O', 'H', 'F']);
  const names = ['C1', 'N2', 'Ref 1', 'O3', 'H4', 'F5'];
  // The optimizer bends the chain slightly and moves everything a little.
  const offsets = [[0.01, -0.02, 0.005], [-0.015, 0.01, 0.02], [0.03, 0.04, -0.01], [0.02, -0.01, 0.03], [-0.02, 0.015, -0.025]];
  const after = rigid(atoms.map(({ element, position }, i) => ({ element, position: position.map((v, k) => v + offsets[i][k]) })), [0.9, 0.1, 0.3, -0.2], [0.5, 0, -1]);
  const result = zmatrixAfterOptimization(definition, atoms, after, names);
  expect(result.document.rows.map(({ element, refs }) => ({ element, refs }))).toEqual(definition.rows.map(({ element, refs }) => ({ element, refs })));
  // Its own distance and angle from C and N hold exactly; the rows after it are measured from where it went.
  expect(result.document.rows[2].values).toEqual(definition.rows[2].values);
  expectRebuilds(result.document, after);
  // The optimized atoms are bent: the O row now measures a non-linear angle from the C–N axis.
  const placed = placeInReferenceFrame(atomsFromZmatrixRows(resolveZmatrixDocument(result.document)).filter((a) => a.element !== 'X'), after).map((a) => a.position);
  expect(measure('angle', placed, [2, 1, 0])).toBeLessThan(179.9);
});

test('mismatched atoms and invalid coordinates are rejected before anything is written', () => {
  const definition = parseZmatrixDocument(water);
  const before = atomsFromZmatrixDocument(definition);
  expect(() => zmatrixAfterOptimization(definition, before, before.slice(0, 2), labels(water))).toThrow('does not match');
  expect(() => zmatrixAfterOptimization(definition, before, before.map((atom, i) => (i === 1 ? { ...atom, element: 'F' } : atom)), labels(water))).toThrow('does not match');
  expect(() => zmatrixAfterOptimization(definition, before, before.map((atom, i) => (i === 1 ? { ...atom, position: [Number.NaN, 0, 0] } : atom)), labels(water))).toThrow('invalid coordinates');
  // Geometry this definition does not place (an edit made elsewhere) is not taken as its starting point.
  expect(() => zmatrixAfterOptimization(definition, waterAt(1.2, 0.9572, 104.52), waterAt(1.1, 1.1, 104.52), labels(water))).toThrow('no longer matches');
});

test('constraints name real atoms past reference rows; anything a reference point would carry is refused with its reason', () => {
  const text = 'C\nX 1 1.0\nO 1 1.2 2 90\nH 1 1.1 2 90 3 120\nH 1 1.1 3 120 4 180\n';
  const definition = parseZmatrixDocument(text);
  const names = labels(text);
  expect(names).toEqual(['C1', 'Ref 1', 'O2', 'H3', 'H4']);
  expect(zmatrixAtomIndices(definition)).toEqual([0, null, 1, 2, 3]);
  const geometry = atomsFromZmatrixDocument(definition);
  expect(zmatrixConstraints(definition, new Set([2, 4]), new Set(['3:0', '4:1', '4:2']), names, geometry)).toEqual([
    { kind: 'freeze', atoms: [1] },
    { kind: 'freeze', atoms: [3] },
    { kind: 'distance', atoms: [2, 0] },
    { kind: 'angle', atoms: [3, 0, 1] },
    { kind: 'dihedral', atoms: [3, 0, 1, 2] },
  ]);
  // The angle and dihedral of H3 are measured from Ref 1.
  expect(zmatrixLockUnavailable(definition, names, 3, 0)).toBeNull();
  expect(zmatrixLockUnavailable(definition, names, 3, 1)).toBe('Ref 1 is a reference point, not an atom the force field moves');
  expect(zmatrixLockUnavailable(definition, names, 1, 0)).toBe('Ref 1 is a reference point, not an atom the force field moves');
  expect(() => zmatrixConstraints(definition, new Set(), new Set(['3:1']), names)).toThrow('Angle of H3 cannot be held fixed: Ref 1 is a reference point');
  expect(() => zmatrixConstraints(definition, new Set([1]), new Set(), names)).toThrow('Ref 1 is a reference point, not an atom that can be frozen');
});

test('a linear angle, or a torsion over collinear atoms, cannot be a force-field restraint', () => {
  const text = 'H\nC 1 1.06\nN 2 1.15 1 180\nH 2 2.0 1 180 3 0\n';
  const definition = parseZmatrixDocument(text);
  const names = labels(text);
  const geometry = atomsFromZmatrixDocument(definition);
  expect(() => zmatrixConstraints(definition, new Set(), new Set(['2:1']), names, geometry)).toThrow('Angle of N3 cannot be held fixed: it is a linear angle.');
  expect(() => zmatrixConstraints(definition, new Set(), new Set(['3:2']), names, geometry)).toThrow('Dihedral of H4 cannot be held fixed: three of its atoms are collinear.');
  // Without the geometry (quantum input export) the coordinates are passed as they are.
  expect(zmatrixConstraints(definition, new Set(), new Set(['2:1']), names)).toEqual([{ kind: 'angle', atoms: [2, 1, 0] }]);
});

// A Z-matrix source as the workbench holds it: XYZ text of its real atoms, with frame energy
// and modes computed for that geometry.
function zmatrixSource(zmatrix: string, orient = (atoms: Atom[]) => atoms) {
  const definition = parseZmatrixDocument(zmatrix);
  const atoms = orient(atomsFromZmatrixDocument(definition)).map(({ element, position: [x, y, z] }) => ({ element, x, y, z }));
  const text = serializeXyz(atoms, 'imported');
  const science = { format: 'xyz', atoms, frames: [{ atoms, energy: -1 }], modes: [{ frequency: 1000 }], orbitals: [], internalCoordinates: definition } as any;
  return { definition, science, text, revisions: [{ text, document: science }] };
}
const coordinates = (atoms: { element: string; x: number; y: number; z: number }[]) => atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
const shifted = (atoms: Atom[], moves: Record<number, number[]>) => atoms.map((atom, i) => (moves[i] ? { ...atom, position: atom.position.map((v, k) => v + moves[i][k]) } : atom));
// The revision's text, atoms and definition are one geometry: the text parses to the atoms,
// the definition places them (well inside the 1e-6 Å the next optimization checks), and the
// next optimization starts from them.
function expectOneGeometry(revision: { text: string; document: any }, names: string[]) {
  expect(parseXyz(revision.text).atoms).toEqual(revision.document.atoms);
  const kept = coordinates(revision.document.atoms);
  const rebuilt = placeInReferenceFrame(atomsFromZmatrixDocument(revision.document.internalCoordinates), kept);
  expect(Math.max(...rebuilt.map((atom, i) => Math.hypot(...atom.position.map((v, k) => v - kept[i].position[k]))))).toBeLessThan(1e-9);
  expect(zmatrixAfterOptimization(revision.document.internalCoordinates, kept, kept, names).document).toEqual(revision.document.internalCoordinates);
}

test('atoms an optimization left in place keep their lines, and the definition is measured where they are kept', () => {
  const zmatrix = 'C\nN 1 1.2\nO 2 1.3 1 120\nH 2 1.4 1 108 3 80\n';
  const names = labels(zmatrix);
  const source = zmatrixSource(zmatrix);
  const before = coordinates(source.science.atoms);
  const lines = source.text.split('\n');
  // O moves; H moves 0.9e-6 Å, which keeps its line and its exact coordinates.
  const after = shifted(before, { 2: [2e-3, -1e-3, 5e-4], 3: [0.9e-6, 0, 0] });
  const { revision } = zmatrixOptimizedRevision(source.science, source.definition, after, names, source.text, source.revisions);
  const next = revision.text.split('\n');
  expect(next.filter((line, i) => line !== lines[i])).toEqual([next[4]]);
  expect(revision.document.atoms[3]).toEqual(source.science.atoms[3]);
  expect(revision.document.atoms[2]).toEqual({ element: 'O', x: after[2].position[0], y: after[2].position[1], z: after[2].position[2] });
  // A new geometry: data computed for the old one is left out.
  expect(revision.document.frames).toEqual([{ atoms: revision.document.atoms }]);
  expect(revision.document.modes).toEqual([]);
  expectOneGeometry(revision, names);

  // H moved 0.99e-6 Å along every axis (1.7e-6 Å): it is written where the optimization left it.
  const moved = shifted(before, { 3: [0.99e-6, 0.99e-6, 0.99e-6] });
  const written = zmatrixOptimizedRevision(source.science, source.definition, moved, names, source.text, source.revisions).revision;
  expect(written.document.atoms[3]).toEqual({ element: 'H', x: moved[3].position[0], y: moved[3].position[1], z: moved[3].position[2] });
  expectOneGeometry(written, names);

  // The next optimization from either revision is written the same way.
  for (const previous of [revision, written] as Revision[]) {
    const further = shifted(coordinates(previous.document.atoms), { 1: [0, 3e-3, 0], 3: [0, 0, 0.5e-6] });
    const step = zmatrixOptimizedRevision(previous.document, previous.document.internalCoordinates, further, names, previous.text, [...source.revisions, previous]).revision;
    expect(step.document.atoms[3]).toEqual(previous.document.atoms[3]);
    expectOneGeometry(step, names);
  }
});

test('an optimization that leaves every atom in place keeps the text, the definition and the data', () => {
  const zmatrix = 'C\nN 1 1.2\nO 2 1.3 1 120\nH 2 1.4 1 108 3 80\n';
  const source = zmatrixSource(zmatrix);
  const after = shifted(coordinates(source.science.atoms), { 0: [3e-7, 0, 0], 3: [0, -4e-7, 4e-7] });
  const { revision } = zmatrixOptimizedRevision(source.science, source.definition, after, labels(zmatrix), source.text, source.revisions);
  expect(revision.text).toBe(source.text);
  expect(revision.document).toEqual(source.science);
});

type Revision = { text: string; document: any };
// Each row move as the panel applies it: on the current atoms, with every earlier revision.
function moveRow(revision: Revision, revisions: Revision[], index: number, to: number): Revision {
  const edit = editZmatrixRows(revision.document.internalCoordinates, { type: 'move', index, to }, coordinates(revision.document.atoms));
  const next = zmatrixRowsRevision(revision.document, edit, revision.text, revisions);
  revisions.push(next);
  return next;
}
// The atoms of `next` are those of `previous` in `order` (old index of each), exactly where they were, each with its own line.
function expectReordered(next: Revision, previous: Revision, order: number[]) {
  expect(next.document.atoms).toEqual(order.map((old) => previous.document.atoms[old]));
  const lines = previous.text.split('\n');
  expect(next.text.split('\n').slice(2, 2 + order.length)).toEqual(order.map((old) => lines[old + 2]));
}

test('a sub-micron authored edit is written where the definition places it, so later row moves and optimizations still match', () => {
  const zmatrix = 'C\nN 1 1.2\nO 2 1.3 1 120\nH 2 1.4 1 108 3 80\n';
  const names = labels(zmatrix);
  // Turned off its axes, so placing the definition differs from the source atoms by round-off.
  const source = zmatrixSource(zmatrix, rigid);
  const lines = source.text.split('\n');
  // The H bond grows by 0.9e-6 Å, inside the distance at which an atom keeps its line.
  const authored = withRowValue(source.definition, 3, 0, 1.4 + 0.9e-6);
  const edited = zmatrixRevision(source.science, authored, source.text, source.revisions);
  const placed = placeInReferenceFrame(atomsFromZmatrixDocument(authored), coordinates(source.science.atoms))[3].position;
  const h = edited.document.atoms[3];
  expect(Math.hypot(h.x - placed[0], h.y - placed[1], h.z - placed[2])).toBeLessThan(1e-12);
  const old = source.science.atoms[3];
  expect(Math.hypot(h.x - old.x, h.y - old.y, h.z - old.z)).toBeGreaterThan(0.5e-6);
  // The other atoms keep their lines and exact coordinates; the authored value is kept as typed.
  const next = edited.text.split('\n');
  expect(next.filter((line, i) => line !== lines[i])).toEqual([next[5]]);
  expect(edited.document.atoms.slice(0, 3)).toEqual(source.science.atoms.slice(0, 3));
  expect(edited.document.internalCoordinates).toEqual(authored);
  expect(edited.document.modes).toEqual([]);
  expectOneGeometry(edited, names);

  // Move up three times: H becomes the first row, the atom the frame is anchored on.
  const revisions: Revision[] = [...source.revisions, edited];
  let revision: Revision = edited;
  for (let index = 3; index > 0; index--) {
    const moved = moveRow(revision, revisions, index, index - 1);
    const order = [0, 1, 2, 3];
    order.splice(index - 1, 0, ...order.splice(index, 1));
    expectReordered(moved, revision, order);
    expectOneGeometry(moved, zmatrixRowLabels(moved.document.internalCoordinates));
    revision = moved;
  }
  const reordered = zmatrixRowLabels(revision.document.internalCoordinates);
  expect(reordered).toEqual(['H1', 'C2', 'N3', 'O4']);

  // The next optimization and the next row move start from these atoms.
  const further = shifted(coordinates(revision.document.atoms), { 2: [0, 2e-3, -1e-3], 0: [0.5e-6, 0, 0] });
  const optimized = zmatrixOptimizedRevision(revision.document, revision.document.internalCoordinates, further, reordered, revision.text, revisions).revision;
  expectOneGeometry(optimized, reordered);
  revisions.push(optimized);
  const back = moveRow(optimized, revisions, 0, 3);
  expectReordered(back, optimized, [1, 2, 3, 0]);
  expectOneGeometry(back, names);
});

test('an edit that leaves every atom in place keeps the lines and the data, and the next row move is exact', () => {
  const source = zmatrixSource(water, rigid);
  // The reference point's distance places no real atom.
  const authored = withRowValue(source.definition, 1, 0, 1.5);
  const edited = zmatrixRevision(source.science, authored, source.text, source.revisions);
  expect(edited.document).toEqual({ ...source.science, internalCoordinates: authored });
  // Only the comment tells the revisions apart.
  expect(edited.text.split('\n').filter((line, i) => line !== source.text.split('\n')[i])).toHaveLength(1);
  expectOneGeometry(edited, labels(water));
  const moved = moveRow(edited, [...source.revisions, edited], 3, 2);
  expectReordered(moved, edited, [0, 2, 1]);
  expectOneGeometry(moved, zmatrixRowLabels(moved.document.internalCoordinates));
});

test('a row move writes the atoms its new rows describe when the revision kept an atom off its definition', () => {
  const zmatrix = 'C\nN 1 1.2\nO 2 1.3 1 120\nH 2 1.4 1 108 3 80\n';
  const source = zmatrixSource(zmatrix, rigid);
  // H kept at its old line while the definition places it 0.9e-6 Å away (as an earlier snap left it).
  const offset = { text: source.text, document: { ...source.science, internalCoordinates: withRowValue(source.definition, 3, 0, 1.4 + 0.9e-6) } };
  const revisions: Revision[] = [...source.revisions, offset];
  let revision = moveRow(offset, revisions, 3, 2);
  const [c, n, h, o] = revision.document.atoms;
  expect([c, n, o]).toEqual(source.science.atoms.slice(0, 3));
  expect(h).not.toEqual(source.science.atoms[3]);
  expectOneGeometry(revision, zmatrixRowLabels(revision.document.internalCoordinates));
  for (const index of [2, 1]) {
    revision = moveRow(revision, revisions, index, index - 1);
    expectOneGeometry(revision, zmatrixRowLabels(revision.document.internalCoordinates));
  }
  const names = zmatrixRowLabels(revision.document.internalCoordinates);
  const further = shifted(coordinates(revision.document.atoms), { 3: [1e-3, 0, 0] });
  expectOneGeometry(zmatrixOptimizedRevision(revision.document, revision.document.internalCoordinates, further, names, revision.text, revisions).revision, names);
});

// Independent of any frame: every pair of real atoms is as far apart as the definition places
// them, the text parses to the atoms, the definition placed on them rebuilds them, and (when
// `optimizable`) the next optimization accepts them.
function expectShape(revision: Revision, optimizable = true) {
  expect(parseXyz(revision.text).atoms).toEqual(revision.document.atoms);
  const definition = revision.document.internalCoordinates;
  const kept = coordinates(revision.document.atoms);
  const own = atomsFromZmatrixDocument(definition);
  expect(pairDeviation(kept, own)).toBeLessThan(1e-9);
  const rebuilt = placeInReferenceFrame(own, kept);
  expect(Math.max(...rebuilt.map((atom, i) => Math.hypot(...atom.position.map((v, k) => v - kept[i].position[k]))))).toBeLessThan(1e-9);
  if (optimizable) expect(zmatrixAfterOptimization(definition, kept, kept, zmatrixRowLabels(definition)).deviation).toBeLessThan(1e-9);
}

// The largest difference between how far apart two atoms of `atoms` are and how far apart `own` places them.
function pairDeviation(atoms: Atom[], own: Atom[]) {
  const apart = (list: Atom[], i: number, j: number) => Math.hypot(...list[i].position.map((v, k) => v - list[j].position[k]));
  let worst = 0;
  for (let i = 0; i < atoms.length; i++) for (let j = 0; j < i; j++) worst = Math.max(worst, Math.abs(apart(atoms, i, j) - apart(own, i, j)));
  return worst;
}

// Rows at 180° and at 0° whose torsions place nothing: H turns about the N–C axis, F about the
// collinear O–C–N line (its torsion references are themselves collinear). The reference point
// carries the torsion of H and the frame of every other row; R is used, U is not.
const linearRows = {
  180: 'C\nX 1 1.0\nN 1 1.2 2 90\nO 1 1.3 2 90 3 180\nH 3 1.1 1 180 2 70\nF 4 1.4 1 180 3 -35\nCl 1 R 2 100 3 60\n\nR = 1.8\nU = 1\n',
  0: 'C\nX 1 1.0\nN 1 1.2 2 90\nO 1 1.3 2 90 3 180\nH 3 2.0 1 0 2 70\nF 4 2.0 1 0 3 -35\nCl 1 R 2 100 3 60\n\nR = 1.8\nU = 1\n',
};

for (const [angle, zmatrix] of Object.entries(linearRows)) {
  test(`an unused variable or an undefined torsion on a ${angle}° row keeps every line and the data; a sub-micron edit there is still written`, () => {
    const source = zmatrixSource(zmatrix, rigid);
    const lines = source.text.split('\n');
    const changed = (revision: Revision) => revision.text.split('\n').flatMap((line, i) => (line === lines[i] ? [] : [i]));

    // Neither U nor H's torsion places an atom: the atoms, their lines and their data stay, and
    // the definition is kept as authored, its undefined torsions included.
    for (const authored of [withVariable(source.definition, 'U', 2), withRowValue(source.definition, 4, 2, -110)]) {
      const edited = zmatrixRevision(source.science, authored, source.text, source.revisions);
      expect(edited.document).toEqual({ ...source.science, internalCoordinates: authored });
      expect(changed(edited)).toEqual([1]);
      expectShape(edited);
    }

    // H's bond grows by 0.9e-6 Å: H alone is written, where the definition places it.
    const authored = withRowValue(source.definition, 4, 0, Number(source.definition.rows[4].values[0]) + 0.9e-6);
    const edited = zmatrixRevision(source.science, authored, source.text, source.revisions);
    const placed = placeInReferenceFrame(atomsFromZmatrixDocument(authored), coordinates(source.science.atoms))[3].position;
    const h = edited.document.atoms[3];
    expect(Math.hypot(h.x - placed[0], h.y - placed[1], h.z - placed[2])).toBeLessThan(1e-12);
    expect(changed(edited)).toEqual([5]);
    expect(edited.document.internalCoordinates).toEqual(authored);
    expect(edited.document.modes).toEqual([]);
    expectShape(edited);

    // H moves up to the first row, where it anchors the frame; each move keeps every atom and
    // line exactly, and the next optimization and row move start from those atoms.
    const revisions: Revision[] = [...source.revisions, edited];
    let revision: Revision = edited;
    for (let index = 4; index > 0; index--) {
      const before = zmatrixRowLabels(revision.document.internalCoordinates);
      const after = [...before];
      [after[index - 1], after[index]] = [after[index], after[index - 1]];
      const atoms = (list: string[]) => list.filter((label) => !label.startsWith('Ref'));
      const moved = moveRow(revision, revisions, index, index - 1);
      expectReordered(moved, revision, atoms(after).map((label) => atoms(before).indexOf(label)));
      expectShape(moved);
      revision = moved;
    }
    const names = zmatrixRowLabels(revision.document.internalCoordinates);
    expect(names).toEqual(['H1', 'C2', 'Ref 1', 'N3', 'O4', 'F5', 'Cl6']);
    // Cl moves; H, the anchor, moves 0.5e-6 Å and keeps its line.
    const further = shifted(coordinates(revision.document.atoms), { 5: [0, 2e-3, -1e-3], 0: [0.5e-6, 0, 0] });
    const optimized = zmatrixOptimizedRevision(revision.document, revision.document.internalCoordinates, further, names, revision.text, revisions).revision;
    expect(optimized.document.atoms[0]).toEqual(revision.document.atoms[0]);
    expectShape(optimized);
    revisions.push(optimized);
    expectShape(moveRow(optimized, revisions, 0, 4));
  });
}

test('a row only nearly linear keeps its data through an unused variable, and its torsion still places H', () => {
  for (const angle of [179.99999, 179.9999999999, 1e-10]) {
    const source = zmatrixSource(`C\nN 1 1.2\nO 2 1.3 1 120\nH 2 1.4 1 ${angle} 3 80\n\nU = 1\n`, rigid);
    const unused = withVariable(source.definition, 'U', 2);
    const kept = zmatrixRevision(source.science, unused, source.text, source.revisions);
    expect(kept.document).toEqual({ ...source.science, internalCoordinates: unused });
    // Optimize measures every torsion and so refuses an atom within 1e-10 Å of its axis.
    expectShape(kept, angle === 179.99999);
  }
  // At 179.99999° turning the torsion by 180° moves H 4.9e-7 Å: within the distance an atom
  // keeps its line, yet H is written where the definition now places it.
  const source = zmatrixSource('C\nN 1 1.2\nO 2 1.3 1 120\nH 2 1.4 1 179.99999 3 80\n', rigid);
  const turned = withRowValue(source.definition, 3, 2, -100);
  const edited = zmatrixRevision(source.science, turned, source.text, source.revisions);
  const placed = placeInReferenceFrame(atomsFromZmatrixDocument(turned), coordinates(source.science.atoms))[3].position;
  const [h, old] = [edited.document.atoms[3], source.science.atoms[3]];
  expect(Math.hypot(h.x - old.x, h.y - old.y, h.z - old.z)).toBeLessThan(1e-6);
  expect(Math.hypot(h.x - placed[0], h.y - placed[1], h.z - placed[2])).toBeLessThan(1e-12);
  expect(edited.document.atoms.slice(0, 3)).toEqual(source.science.atoms.slice(0, 3));
  expectShape(edited);
});

// Torsions measured from a reference nearly on their axis, where a 1e-15 Å round-off of the
// reference turns the measured torsion by up to 1e-7 rad: O nearly on the N–C line as the
// reference of H (and of Cl); a reference point nearly on it as the reference of H, O and Cl; a
// chain whose real atoms all lie nearly on one line around a reference point; O nearly on the
// line as the atom the frame is anchored on, measured from by a reference point.
const nearAxis: Record<string, (angle: string) => string> = {
  atom: (angle) => `C\nN 1 1.2\nO 2 1.3 1 ${angle}\nH 2 1.4 1 100 3 80\n\nU = 1\n`,
  atoms: (angle) => `C\nN 1 1.2\nO 2 1.3 1 ${angle}\nH 2 1.4 1 100 3 80\nCl 2 1.8 1 110 3 60\n\nU = 1\n`,
  point: (angle) => `C\nN 1 1.2\nX 2 1.0 1 ${angle}\nH 2 1.4 1 100 3 80\nO 1 1.3 2 115 3 -50\nCl 1 1.8 2 110 3 60\n\nU = 1\n`,
  chain: (angle) => `C\nN 1 1.2\nX 2 1.0 1 90\nO 2 1.3 1 ${angle} 3 20\nF 4 1.4 2 179.99999 3 30\nH 1 1.1 2 ${angle} 3 -70\n\nU = 1\n`,
  anchor: (angle) => `C\nN 1 1.2\nO 2 1.3 1 ${angle}\nX 1 1.0 2 90 3 0\nH 1 1.1 4 100 2 30\nCl 2 1.8 4 110 1 -60\n\nU = 1\n`,
};
const nearAxisAngles = ['179.999', '179.99999', '179.999999', '0.001', '0.00001', '0.000001'];
const motions: [[number, number, number, number], number[]][] = [[[0.8, 0.2, -0.4, 0.4], [3, -2, 7]], [[0.3, -0.7, 0.5, 0.1], [-40, 15, 22]], [[0.9, 0.1, 0.1, -0.3], [600, -900, 350]], [[0.3, -0.7, 0.5, 0.1], [250, 80, -500]]];
// Each valid near-axis source, rigidly moved (with its frame energy and modes).
function nearAxisSources(shapes: string[], angles = nearAxisAngles) {
  return shapes.flatMap((shape) => angles.flatMap((angle) => motions.flatMap(([turn, shift]) => {
    try {
      return [{ shape, angle, ...zmatrixSource(nearAxis[shape](angle), (atoms) => rigid(atoms, turn, shift)) }];
    } catch {
      return [];
    }
  })));
}

test('an unused variable keeps every line and the data when a torsion is measured from a reference nearly on its axis', () => {
  const sources = nearAxisSources(Object.keys(nearAxis));
  expect(sources.length).toBeGreaterThan(90);
  for (const source of sources) {
    const unused = withVariable(source.definition, 'U', 2);
    const edited = zmatrixRevision(source.science, unused, source.text, source.revisions);
    expect(edited.document).toEqual({ ...source.science, internalCoordinates: unused });
    expect(edited.text.split('\n').filter((line, i) => line !== source.text.split('\n')[i])).toHaveLength(1);
  }
});

test('a sub-micron torsion turn measured from a reference nearly on its axis is written where it moves atoms against the rest', () => {
  // H turns 9e-7 Å about the N–C axis while Cl, measured from the same reference, stays: H
  // moves against Cl, though against its own references the turn is within their round-off.
  const turn = (9e-7 / (1.4 * Math.sin(100 * Math.PI / 180))) * 180 / Math.PI;
  for (const source of nearAxisSources(['atoms', 'point'])) {
    const row = source.definition.rows.findIndex(({ element }) => element === 'H');
    const turned = withRowValue(source.definition, row, 2, 80 + turn);
    const edited = zmatrixRevision(source.science, turned, source.text, source.revisions);
    const placed = placeInReferenceFrame(atomsFromZmatrixDocument(turned), coordinates(source.science.atoms));
    // Every atom keeps its exact source or is written where the definition places it.
    const written = edited.document.atoms.flatMap((atom: any, i: number) => {
      if (atom.x === source.science.atoms[i].x && atom.y === source.science.atoms[i].y && atom.z === source.science.atoms[i].z) return [];
      expect(Math.hypot(atom.x - placed[i].position[0], atom.y - placed[i].position[1], atom.z - placed[i].position[2])).toBeLessThan(1e-12);
      return [atom.element];
    });
    // H is written, or Cl (with O) turns instead where the frame is anchored on H.
    expect(written.filter((element: string) => element === 'H' || element === 'Cl').length).toBeGreaterThan(0);
    expect(edited.document.internalCoordinates).toEqual(turned);
    expect(edited.document.modes).toEqual([]);
    // The shape is the definition's to the 1e-8 Å two kept atoms may each be off, or as closely
    // as the frame places it (that frame shears by round-off where it is anchored on an atom
    // nearly on the line of the first two); the turn itself moved H 9e-7 Å.
    const own = atomsFromZmatrixDocument(turned);
    expect(pairDeviation(coordinates(edited.document.atoms), own)).toBeLessThan(Math.max(2e-8, 2 * pairDeviation(placed, own)));
  }
});

test('after a near-axis edit that keeps the atoms, the next row move and optimization start from them', () => {
  for (const source of nearAxisSources(['atoms', 'point'], ['179.999', '0.001'])) {
    const unused = withVariable(source.definition, 'U', 2);
    const edited = zmatrixRevision(source.science, unused, source.text, source.revisions);
    const revisions: Revision[] = [...source.revisions, edited];
    const last = unused.rows.length - 1;
    const moved = moveRow(edited, revisions, last, last - 1);
    // Every element appears once, so it names its atom.
    const elements = (definition: typeof unused) => definition.rows.flatMap(({ element }) => (element === 'X' ? [] : [element]));
    const after = elements(moved.document.internalCoordinates);
    expectReordered(moved, edited, after.map((element) => elements(unused).indexOf(element)));
    const names = zmatrixRowLabels(moved.document.internalCoordinates);
    const further = shifted(coordinates(moved.document.atoms), { [after.indexOf('Cl')]: [0, 2e-3, -1e-3] });
    const optimized = zmatrixOptimizedRevision(moved.document, moved.document.internalCoordinates, further, names, moved.text, revisions).revision;
    expect(optimized.document.atoms.filter((atom: any) => atom.element !== 'Cl')).toEqual(moved.document.atoms.filter((atom: any) => atom.element !== 'Cl'));
  }
});

test('a sub-micron edit of the last of 512 rows is written and the rows still hold', () => {
  let seed = 171;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const definition = zmatrixDocumentFromAtoms(Array.from({ length: 512 }, () => ({ element: 'C', position: [0, 1, 2].map(() => 30 * random()) })));
  const source = zmatrixSource(formatZmatrixDocument(definition), rigid);
  const authored = withRowValue(source.definition, 511, 0, Number(source.definition.rows[511].values[0]) + 0.9e-6);
  const edited = zmatrixRevision(source.science, authored, source.text, source.revisions);
  expect(edited.document.atoms.slice(0, 511)).toEqual(source.science.atoms.slice(0, 511));
  expect(edited.document.atoms[511]).not.toEqual(source.science.atoms[511]);
  const kept = coordinates(edited.document.atoms);
  expect(zmatrixAfterOptimization(authored, kept, kept, zmatrixRowLabels(authored)).document).toEqual(authored);
});
