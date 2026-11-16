import { expect, test } from 'bun:test';
import { atomsFromZmatrixDocument, formatZmatrixDocument, parseZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { atomsFromZmatrixRows, parseXyzAtoms, placeInReferenceFrame } from '../scripts/internal-coordinates.mjs';
import { resolveZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { measureGeometry } from '../scripts/molecular-geometry.js';
import { zmatrixDocumentFromAtoms } from '../scripts/zmatrix-export.mjs';
import { zmatrixAfterOptimization, zmatrixAtomIndices, zmatrixConstraints, zmatrixLockUnavailable } from '../apps/desktop/src/lib/workbench/zmatrix-optimization';

type Atom = { element: string; position: number[] };
const water = 'O\nX 1 1.0\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 0.9572\nA = 52.26\n';
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
