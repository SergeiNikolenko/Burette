import { measureGeometry } from '../../../../../scripts/molecular-geometry.js';
import type { MolecularAtom, MolecularBond, Vec3 } from './types';

export type MeasurementCoordinateEdit = {
  kind: 'distance' | 'angle' | 'dihedral';
  /** Ordered source atom indices; first/last select the terminal side. */
  atoms: readonly number[];
  target: number;
  side?: 'first' | 'last';
};
export type MeasurementCoordinateResult = { coordinates: Vec3[]; movedAtoms: number[]; side: 'first' | 'last'; previous: number; value: number };
const EPS = 1e-10;
const fail = (message: string): never => { throw new Error(message); };
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  if (length <= EPS) fail('The measurement has coincident or ill-conditioned endpoints.');
  return vector.map(value => value / length) as Vec3;
}
const bounded = (point: Vec3) => point.length === 3 && point.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6);
const wrap = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
function measured(kind: MeasurementCoordinateEdit['kind'], indices: readonly number[], coordinates: Vec3[]) {
  return measureGeometry(kind, indices.map(index => ({ id: String(index), position: coordinates[index] }))).value as number;
}

/** Reject inversion or collapse of an existing tetrahedral handedness, including implicit-H centres. */
function preserveHandedness(before: Vec3[], after: Vec3[], neighbours: number[][]) {
  const volume = (points: Vec3[], center: number, adjacent: number[]) => {
    const origin = points[adjacent.length === 4 ? adjacent[0] : center];
    const endpoints = adjacent.length === 4 ? adjacent.slice(1) : adjacent;
    const rays = endpoints.map(index => unit(sub(points[index], origin)));
    return dot(rays[0], cross(rays[1], rays[2]));
  };
  neighbours.forEach((adjacent, center) => {
    if (adjacent.length !== 3 && adjacent.length !== 4) return;
    const previous = volume(before, center, adjacent);
    if (Math.abs(previous) <= EPS) return; // A planar centre has no initial handedness.
    const next = volume(after, center, adjacent);
    if (Math.abs(next) <= EPS || previous * next < 0) fail('The edit would invert or collapse a stereocentre.');
  });
}

/**
 * One rigid fragment translation/rotation, without inferring connectivity or changing the graph.
 * Bonded endpoints are separated by removing the edited bond. A ring cut that reconnects
 * the required endpoints is rejected. Distance also accepts already disconnected components;
 * angle/dihedral require a bonded path. Other disconnected components never move.
 */
export function editMeasurementCoordinate(structure: { atoms: MolecularAtom[]; bonds: MolecularBond[] }, edit: MeasurementCoordinateEdit): MeasurementCoordinateResult {
  const count = structure?.atoms?.length;
  if (!Array.isArray(structure?.atoms) || !Number.isInteger(count) || count < 1 || count > 256 || !Array.isArray(structure.bonds) || structure.bonds.length > count * (count - 1) / 2) fail('Coordinate editing supports a graph of 1–256 atoms.');
  const coordinates: Vec3[] = Array.from(structure.atoms, atom => {
    if (!atom || typeof atom !== 'object') fail('The molecular graph has an invalid atom.');
    return [atom.x, atom.y, atom.z];
  });
  if (coordinates.some(point => !bounded(point))) fail('Coordinates must be finite and within 1000000 Å.');
  const size = { distance: 2, angle: 3, dihedral: 4 }[edit?.kind];
  const indices = edit?.atoms;
  if (!size || !Array.isArray(indices) || indices.length !== size || new Set(indices).size !== size
    || Array.from(indices).some(index => !Number.isInteger(index) || index < 0 || index >= count)) fail('Choose distinct, valid ordered measurement atoms.');
  if (edit.side !== undefined && edit.side !== 'first' && edit.side !== 'last') fail('Choose the first or last fragment.');
  if (!Number.isFinite(edit.target) || (edit.kind === 'distance' ? edit.target <= EPS
    : edit.kind === 'angle' ? edit.target <= 0 || edit.target >= 180 : Math.abs(edit.target) > 180)) fail('The coordinate target is outside its valid range.');
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  const edges = new Set<string>();
  const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  for (const bond of structure.bonds) {
    if (!bond || typeof bond !== 'object') fail('The molecular graph has an invalid bond.');
    const { a, b, order } = bond;
    if (![a, b].every(index => Number.isInteger(index) && index >= 0 && index < count) || a === b
      || !Number.isFinite(order) || order <= 0 || order > 3 || edges.has(edgeKey(a, b))) fail('The molecular graph has an invalid or repeated bond.');
    edges.add(edgeKey(a, b)); neighbours[a].push(b); neighbours[b].push(a);
  }
  const component = (start: number, cutA: number, cutB: number) => {
    const seen = new Set([start]), pending = [start];
    while (pending.length) {
      const atom = pending.pop()!;
      for (const next of neighbours[atom]) {
        if ((atom === cutA && next === cutB) || (atom === cutB && next === cutA) || seen.has(next)) continue;
        seen.add(next); pending.push(next);
      }
    }
    return [...seen].sort((a, b) => a - b);
  };
  const [a, b, c, d] = indices;
  let first: number[], last: number[];
  if (edit.kind === 'distance') {
    first = component(a, a, b); last = component(b, a, b);
    if (first.includes(b)) fail('These endpoints cannot be separated by a bond cut; ring and nonbonded intramolecular distances cannot move rigidly.');
  } else {
    if (!indices.slice(1).every((index, i) => edges.has(edgeKey(indices[i], index)))) fail('Angle and dihedral editing require consecutive bonded atoms.');
    if (edit.kind === 'angle') {
      first = component(a, a, b); last = component(c, b, c);
      if (first.includes(b) || first.includes(c)) first = [];
      if (last.includes(b) || last.includes(a)) last = [];
    } else {
      first = component(b, b, c); last = component(c, b, c);
      if (!first.includes(a) || first.includes(c) || first.includes(d)) first = [];
      if (!last.includes(d) || last.includes(b) || last.includes(a)) last = [];
    }
  }
  const side = edit.side ?? (!first.length ? 'last' : !last.length || first.length <= last.length ? 'first' : 'last');
  const moving = side === 'first' ? first : last;
  if (!moving.length) fail('This fragment is connected through a ring and cannot move rigidly.');
  const previous = measured(edit.kind, indices, coordinates);
  let axis: Vec3 | null = null;
  if (edit.kind === 'angle') {
    const normal = cross(unit(sub(coordinates[a], coordinates[b])), unit(sub(coordinates[c], coordinates[b])));
    if (Math.hypot(...normal) <= EPS || Math.abs(Math.sin(edit.target * Math.PI / 180)) <= EPS) fail('The angle plane is collinear or ill-conditioned.');
    axis = unit(normal);
  } else if (edit.kind === 'dihedral') {
    axis = unit(sub(coordinates[c], coordinates[b]));
    for (const ray of [sub(coordinates[a], coordinates[b]), sub(coordinates[d], coordinates[c])]) {
      if (Math.hypot(...cross(unit(ray), axis)) <= EPS) fail('The dihedral plane is collinear or ill-conditioned.');
    }
  }
  const delta = edit.kind === 'dihedral' ? wrap(edit.target - previous) : edit.target - previous;
  const result = coordinates.map(point => [...point] as Vec3);
  if (delta !== 0) {
    if (edit.kind === 'distance') {
      const direction = unit(sub(coordinates[b], coordinates[a]));
      const step = delta * (side === 'first' ? -1 : 1);
      for (const atom of moving) result[atom] = result[atom].map((value, i) => value + direction[i] * step) as Vec3;
    } else {
      const radians = delta * (side === 'first' ? -1 : 1) * Math.PI / 180;
      const cosine = Math.cos(radians), sine = Math.sin(radians), pivot = coordinates[b];
      for (const atom of moving) {
        if (edit.kind === 'dihedral' && (atom === b || atom === c)) continue; // Axis endpoints stay exact.
        const ray = sub(coordinates[atom], pivot), perpendicular = cross(axis!, ray), along = dot(axis!, ray) * (1 - cosine);
        result[atom] = ray.map((value, i) => pivot[i] + value * cosine + perpendicular[i] * sine + axis![i] * along) as Vec3;
      }
    }
  }
  if (result.some(point => !bounded(point))) fail('The edited coordinates exceed 1000000 Å.');
  preserveHandedness(coordinates, result, neighbours);
  const value = measured(edit.kind, indices, result);
  const error = edit.kind === 'dihedral' ? Math.abs(wrap(value - edit.target)) : Math.abs(value - edit.target);
  if (error > 1e-8 * Math.max(1, edit.kind === 'distance' ? edit.target : 1)) fail('The requested coordinate could not be reached accurately.');
  return { coordinates: result, movedAtoms: moving.filter(atom => result[atom].some((value, i) => value !== coordinates[atom][i])), side, previous, value };
}
