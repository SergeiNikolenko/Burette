import { expect, test } from 'bun:test';
import { editMeasurementCoordinate, type MeasurementCoordinateEdit } from '../apps/desktop/src/lib/molecular-workbench/measurement-coordinate';
import type { Vec3 } from '../apps/desktop/src/lib/molecular-workbench/types';

const graph = (points: Vec3[], edges: [number, number][]) => ({
  atoms: points.map(([x, y, z]) => ({ element: 'C', x, y, z })), bonds: edges.map(([a, b]) => ({ a, b, order: 1 })),
});
const points = (molecule: ReturnType<typeof graph>) => molecule.atoms.map(({ x, y, z }) => [x, y, z] as Vec3);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function close(actual: Vec3[], expected: Vec3[], tolerance = 1e-10) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, i) => point.forEach((value, axis) => expect(Math.abs(value - expected[i][axis])).toBeLessThan(tolerance)));
}
function rigid(before: Vec3[], after: Vec3[], moved: number[]) {
  for (const a of moved) for (const b of moved) expect(Math.abs(distance(before[a], before[b]) - distance(after[a], after[b]))).toBeLessThan(1e-10);
  before.forEach((point, index) => { if (!moved.includes(index)) expect(after[index]).toEqual(point); });
}
function handed(coordinates: Vec3[], indices: number[]) {
  const origin = coordinates[indices[0]];
  const [a, b, c] = indices.slice(1).map(index => coordinates[index].map((value, axis) => value - origin[axis]));
  return a[0] * b[1] * c[2] + a[1] * b[2] * c[0] + a[2] * b[0] * c[1]
    - a[2] * b[1] * c[0] - a[1] * b[0] * c[2] - a[0] * b[2] * c[1];
}
const radians = (degrees: number) => degrees * Math.PI / 180;
const torso = graph([[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1], [8, 8, 8]], [[0, 1], [1, 2], [2, 3], [3, 4]]);

// Expected coordinates below are Cartesian constructions independent of the setter:
// distance is an x translation, angle a point on a unit circle, torsion a y/z circle.
test('distance chooses the smaller bonded component and preserves the branch and unrelated molecule', () => {
  const molecule = graph([[0, 0, 0], [1, 0, 0], [-1, 1, 0], [-1, 0, 1], [9, 9, 9]], [[0, 1], [0, 2], [0, 3]]);
  const original = structuredClone(molecule), before = points(molecule);
  const result = editMeasurementCoordinate(molecule, { kind: 'distance', atoms: [0, 1], target: 2.5 });
  expect([result.side, result.movedAtoms, result.previous, result.value]).toEqual(['last', [1], 1, 2.5]);
  close(result.coordinates, [before[0], [2.5, 0, 0], before[2], before[3], before[4]]);
  const other = editMeasurementCoordinate(molecule, { kind: 'distance', atoms: [0, 1], target: 2.5, side: 'first' });
  close(other.coordinates, [[-1.5, 0, 0], before[1], [-2.5, 1, 0], [-2.5, 0, 1], before[4]]);
  rigid(before, other.coordinates, [0, 2, 3]);
  close(editMeasurementCoordinate(molecule, { kind: 'distance', atoms: [1, 0], target: 2.5, side: 'last' }).coordinates, other.coordinates);
  expect(molecule).toEqual(original);
});

test('disconnected distance moves only the chosen component, and ties consistently choose first', () => {
  const molecule = graph([[0, 0, 0], [3, 0, 0], [3, 1, 0], [10, 0, 0]], [[1, 2]]);
  const result = editMeasurementCoordinate(molecule, { kind: 'distance', atoms: [0, 1], target: 1 });
  expect([result.side, result.movedAtoms]).toEqual(['first', [0]]);
  close(result.coordinates, [[2, 0, 0], [3, 0, 0], [3, 1, 0], [10, 0, 0]]);
  const tied = graph([[0, 0, 0], [2, 0, 0]], []);
  expect(editMeasurementCoordinate(tied, { kind: 'distance', atoms: [0, 1], target: 3 }).side).toBe('first');
  const unchanged = editMeasurementCoordinate(molecule, { kind: 'distance', atoms: [0, 1], target: 3 });
  expect([unchanged.movedAtoms, unchanged.coordinates]).toEqual([[], points(molecule)]);
});

for (const target of [35, 125, 179.9999918842198]) test(`angle ${target} follows an independent Cartesian construction with either point order`, () => {
  const molecule = graph([[1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 2, 0], [9, 9, 9]], [[0, 1], [1, 2], [2, 3]]);
  const result = editMeasurementCoordinate(molecule, { kind: 'angle', atoms: [0, 1, 2], target, side: 'last' });
  const ray: Vec3 = [Math.cos(radians(target)), Math.sin(radians(target)), 0];
  close(result.coordinates, [[1, 0, 0], [0, 0, 0], ray, ray.map(value => value * 2) as Vec3, [9, 9, 9]]);
  expect(Math.abs(Math.atan2(result.coordinates[2][1], result.coordinates[2][0]) * 180 / Math.PI - target)).toBeLessThan(1e-11);
  rigid(points(molecule), result.coordinates, [2, 3]);
  close(editMeasurementCoordinate(molecule, { kind: 'angle', atoms: [2, 1, 0], target, side: 'first' }).coordinates, result.coordinates);
});

for (const target of [-179, -60, 45, 180, -180]) test(`signed torsion ${target} moves one rigid side and reverses consistently`, () => {
  const result = editMeasurementCoordinate(torso, { kind: 'dihedral', atoms: [0, 1, 2, 3], target, side: 'last' });
  const cosine = Math.cos(radians(target)), sine = Math.sin(radians(target));
  close(result.coordinates, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, cosine, sine], [1, cosine - sine, sine + cosine], [8, 8, 8]]);
  const actual = Math.atan2(result.coordinates[3][2], result.coordinates[3][1]) * 180 / Math.PI;
  expect(Math.abs(Math.abs(target) === 180 ? Math.abs(actual) - 180 : actual - target)).toBeLessThan(1e-11);
  rigid(points(torso), result.coordinates, [2, 3, 4]);
  close(editMeasurementCoordinate(torso, { kind: 'dihedral', atoms: [3, 2, 1, 0], target, side: 'first' }).coordinates, result.coordinates);
  expect(editMeasurementCoordinate(torso, { kind: 'dihedral', atoms: [0, 1, 2, 3], target }).side).toBe('first');
});

test('a translated diagonal torsion axis agrees with the independent cyclic-coordinate rotation', () => {
  const molecule = graph([[6, -4, 2], [5, -3, 2], [6, -2, 3], [7, -3, 3]], [[0, 1], [1, 2], [2, 3]]);
  const result = editMeasurementCoordinate(molecule, { kind: 'dihedral', atoms: [0, 1, 2, 3], target: 120, side: 'last' });
  close(result.coordinates, [[6, -4, 2], [5, -3, 2], [6, -2, 3], [6, -1, 2]]);
  expect(result.coordinates.slice(0, 3)).toEqual(points(molecule).slice(0, 3));
  expect(result.movedAtoms).toEqual([3]);
});

test('torsion crosses the signed wrap by a small proper rotation', () => {
  const molecule = graph([[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, Math.cos(radians(170)), Math.sin(radians(170))]], [[0, 1], [1, 2], [2, 3]]);
  const result = editMeasurementCoordinate(molecule, { kind: 'dihedral', atoms: [0, 1, 2, 3], target: -170, side: 'last' });
  close(result.coordinates, [[0, 1, 0], [0, 0, 0], [1, 0, 0], [1, Math.cos(radians(-170)), Math.sin(radians(-170))]]);
});

test('ring cuts and nonbonded paths reject; a safe angle arm outside a ring remains editable', () => {
  const ring = graph([[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 1]], [[0, 1], [1, 2], [2, 3], [3, 0]]);
  for (const [kind, atoms, target] of [['distance', [0, 1], 2], ['angle', [0, 1, 2], 80], ['dihedral', [0, 1, 2, 3], 60]] as const) {
    expect(() => editMeasurementCoordinate(ring, { kind, atoms, target })).toThrow(/ring|separated/u);
  }
  expect(() => editMeasurementCoordinate(torso, { kind: 'distance', atoms: [0, 3], target: 2 })).toThrow(/nonbonded/u);
  expect(() => editMeasurementCoordinate(torso, { kind: 'angle', atoms: [0, 1, 5], target: 60 })).toThrow(/bonded/u);
  const branched = graph([[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, -1, 0]], [[0, 1], [1, 2], [1, 3], [3, 0]]);
  expect(editMeasurementCoordinate(branched, { kind: 'angle', atoms: [0, 1, 2], target: 60 }).side).toBe('last');
  expect(() => editMeasurementCoordinate(branched, { kind: 'angle', atoms: [0, 1, 2], target: 60, side: 'first' })).toThrow(/ring/u);
});

test('rigid fragment motion preserves tetrahedral handedness and rejects inversion at the edited centre', () => {
  const chiral = graph([[0, 0, 0], [1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1], [2, 2, 2]], [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5]]);
  const result = editMeasurementCoordinate(chiral, { kind: 'distance', atoms: [1, 5], target: 2, side: 'first' });
  rigid(points(chiral), result.coordinates, [0, 1, 2, 3, 4]);
  expect(handed(result.coordinates, [1, 2, 3, 4])).toBeCloseTo(handed(points(chiral), [1, 2, 3, 4]), 10);
  // Three non-coplanar bonds (the fourth ligand may be an implicit H).
  const implicit = graph([[1, 0, 1], [0, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 1], [1, 2], [1, 3]]);
  const inverted = graph([[1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, 1], [1, -1, -1]], [[0, 1], [1, 2], [1, 3], [1, 4]]);
  const reflected = points(inverted); reflected[0] = [Math.sin(radians(160)), Math.cos(radians(160)), 0];
  expect(handed(points(inverted), [0, 2, 3, 4]) * handed(reflected, [0, 2, 3, 4])).toBeLessThan(0);
  for (const target of [160, 2 * Math.atan2(3, 1) * 180 / Math.PI]) {
    expect(() => editMeasurementCoordinate(inverted, { kind: 'angle', atoms: [0, 1, 2], target, side: 'first' })).toThrow(/stereocentre/u);
  }
  const accepted = editMeasurementCoordinate(implicit, { kind: 'angle', atoms: [0, 1, 2], target: 60, side: 'first' });
  expect(accepted.value).toBeCloseTo(60, 10);
  expect(handed(points(implicit), [1, 0, 2, 3]) * handed(accepted.coordinates, [1, 0, 2, 3])).toBeGreaterThan(0);
});

test('undefined planes reject while a small but well-defined plane retains precision', () => {
  const linear = graph([[1, 0, 0], [0, 0, 0], [-1, 1e-13, 0], [-2, 1, 0]], [[0, 1], [1, 2], [2, 3]]);
  expect(() => editMeasurementCoordinate(linear, { kind: 'angle', atoms: [0, 1, 2], target: 120 })).toThrow(/collinear|conditioned/u);
  expect(() => editMeasurementCoordinate(linear, { kind: 'dihedral', atoms: [0, 1, 2, 3], target: 30 })).toThrow(/collinear|conditioned/u);
  const narrow = graph([[1, 0, 0], [0, 0, 0], [-1, 2e-7, 0]], [[0, 1], [1, 2]]);
  const target = 179.9999918842198;
  const result = editMeasurementCoordinate(narrow, { kind: 'angle', atoms: [0, 1, 2], target, side: 'last' });
  expect(Math.abs(result.value - target)).toBeLessThan(1e-11);
  expect(result.coordinates[2][1]).toBeGreaterThan(0);
});

test('invalid indices, repeated endpoints, bounds, targets and malformed graphs leave inputs intact', () => {
  const original = structuredClone(torso);
  const invalid = [
    { kind: 'distance', atoms: [0, 0], target: 1 }, { kind: 'distance', atoms: [0, ,], target: 1 }, { kind: 'angle', atoms: [0, 1], target: 30 },
    { kind: 'distance', atoms: [-1, 1], target: 1 }, { kind: 'distance', atoms: [0, 99], target: 1 },
    { kind: 'distance', atoms: [0, 0.5], target: 1 }, { kind: 'distance', atoms: [0, 1], target: 0 },
    { kind: 'distance', atoms: [0, 1], target: -1 }, { kind: 'distance', atoms: [0, 1], target: Number.MAX_VALUE },
    { kind: 'distance', atoms: [0, 1], target: NaN }, { kind: 'distance', atoms: [0, 1], target: Infinity },
    { kind: 'angle', atoms: [0, 1, 2], target: 180 }, { kind: 'angle', atoms: [0, 1, 2], target: 0 },
    { kind: 'dihedral', atoms: [0, 1, 2, 3], target: 181 }, { kind: 'distance', atoms: [0, 1], target: 1, side: 'all' },
    { kind: 'radius', atoms: [0, 1], target: 1 },
  ];
  for (const edit of invalid) expect(() => editMeasurementCoordinate(torso, edit as MeasurementCoordinateEdit)).toThrow();
  for (const bonds of [[{ a: 0, b: 0, order: 1 }], [{ a: 0, b: 1, order: NaN }], [{ a: 0, b: 1, order: 1 }, { a: 1, b: 0, order: 1 }]]) {
    expect(() => editMeasurementCoordinate({ ...torso, bonds }, { kind: 'distance', atoms: [0, 1], target: 2 })).toThrow(/bond/u);
  }
  expect(() => editMeasurementCoordinate(graph([[1e6, 0, 0], [999999, 0, 0]], [[0, 1]]), { kind: 'distance', atoms: [0, 1], target: 3, side: 'first' })).toThrow(/1000000/u);
  expect(() => editMeasurementCoordinate(graph([[NaN, 0, 0], [1, 0, 0]], []), { kind: 'distance', atoms: [0, 1], target: 1 })).toThrow(/finite/u);
  const sparse = { ...torso, atoms: [...torso.atoms] }; delete sparse.atoms[5];
  expect(() => editMeasurementCoordinate(sparse, { kind: 'distance', atoms: [0, 1], target: 2 })).toThrow(/atom/u);
  expect(torso).toEqual(original);
});
