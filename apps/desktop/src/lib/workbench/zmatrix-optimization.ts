import { atomsFromZmatrixRows, placeInReferenceFrame, type CoordinateAtom } from "../../../../../scripts/internal-coordinates.mjs";
import { measureGeometry } from "../../../../../scripts/molecular-geometry.js";
import { atomsFromZmatrixDocument, resolveZmatrixDocument, type ZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";
import type { GeometryConstraint } from "../molecular-workbench/chemistry";

// Optimization of a Z-matrix definition. The force field only ever sees the real atoms,
// numbered as the viewer numbers them; reference points (X rows) are placement geometry.
// Cartesian results can only be written back when every variable still agrees.
// The reduced-coordinate optimizer returns its authored definition directly.

const KINDS = ["distance", "angle", "dihedral"] as const;
const COLUMNS = ["Bond", "Angle", "Dihedral"] as const;
// Coordinates and bindings agree below this, as in zmatrix-rows.mjs and zmatrix-editing.mjs.
const AGREEMENT = 1e-8;
// The rebuilt definition must place every real atom this close to the optimized one (as row edits require).
const RECONSTRUCTION_A = 1e-6;
const EPS = 1e-8;
const DEG = Math.PI / 180;

const isPoint = (definition: ZmatrixDocument, row: number) => definition.rows[row].element === "X";
const sub = (a: number[], b: number[]) => a.map((value, k) => value - b[k]);
const dot = (a: number[], b: number[]) => a.reduce((sum, value, k) => sum + value * b[k], 0);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => Math.hypot(...a);
const unit = (a: number[]) => a.map((value) => value / norm(a));
// Difference of two values of one coordinate slot; torsions wrap at ±180.
const slotDifference = (a: number, b: number, slot: number) => (slot === 2 ? (a - b) - 360 * Math.round((a - b) / 360) : a - b);

/** Row index -> index of the real atom it places (as the viewer and chemistry number them); null for reference points. */
export function zmatrixAtomIndices(definition: ZmatrixDocument) {
  let atoms = 0;
  return definition.rows.map((row) => (row.element === "X" ? null : atoms++));
}

/**
 * What a frozen atom or fixed coordinate is attached to: the elements and references of
 * every row. The rows themselves change only through row and reference edits.
 */
export function zmatrixRowStructure(definition: ZmatrixDocument) {
  return JSON.stringify(definition.rows.map(({ element, refs }) => [element, refs]));
}

/** Why a coordinate cannot be held fixed by the force field, or null when it can. */
export function zmatrixLockUnavailable(definition: ZmatrixDocument, labels: readonly string[], row: number, slot: number) {
  const point = [row, ...definition.rows[row].refs.slice(0, slot + 1)].find((index) => isPoint(definition, index));
  return point === undefined ? null : `${labels[point]} is a reference point, not an atom the force field moves`;
}

const lockKey = (row: number, slot: number) => `${row}:${slot}`;
export { lockKey as zmatrixLockKey };

/**
 * Frozen rows and fixed coordinates as force-field constraints on real-atom indices.
 * Reference points are never atoms here: a frozen reference point or a coordinate measured
 * from one is rejected with its reason instead of being dropped. With `geometry` (the
 * current real atoms) the restraint targets are checked as the optimizer checks them: a
 * linear angle, or a torsion whose atoms are collinear, cannot be held.
 */
export function zmatrixConstraints(definition: ZmatrixDocument, frozen: ReadonlySet<number>, locked: ReadonlySet<string>, labels: readonly string[], geometry?: readonly CoordinateAtom[]): GeometryConstraint[] {
  const atom = zmatrixAtomIndices(definition);
  const constraints: GeometryConstraint[] = [];
  for (const row of [...frozen].sort((a, b) => a - b)) {
    const index = atom[row];
    if (index === undefined) throw new Error("A frozen row no longer exists.");
    if (index === null) throw new Error(`${labels[row]} is a reference point, not an atom that can be frozen.`);
    constraints.push({ kind: "freeze", atoms: [index] });
  }
  definition.rows.forEach((row, index) => row.refs.forEach((_, slot) => {
    if (!locked.has(lockKey(index, slot))) return;
    const label = `${COLUMNS[slot]} of ${labels[index]}`;
    const unavailable = zmatrixLockUnavailable(definition, labels, index, slot);
    if (unavailable) throw new Error(`${label} cannot be held fixed: ${unavailable}.`);
    const atoms = [index, ...row.refs.slice(0, slot + 1)].map((rowIndex) => atom[rowIndex] as number);
    if (geometry) {
      const at = (indices: number[]) => indices.map((i) => ({ id: String(i), position: geometry[i].position }));
      // The force-field restraint accepts angles strictly between 0 and 180 degrees.
      const linear = (indices: number[]) => {
        const value = measureGeometry("angle", at(indices)).value;
        return Math.min(value, 180 - value) < 1e-9;
      };
      if (slot === 1 && linear(atoms)) throw new Error(`${label} cannot be held fixed: it is a linear angle.`);
      if (slot === 2 && (linear(atoms.slice(0, 3)) || linear(atoms.slice(1)))) throw new Error(`${label} cannot be held fixed: three of its atoms are collinear.`);
    }
    constraints.push({ kind: KINDS[slot], atoms });
  }));
  return constraints;
}

// A row's values measured on `points` with its own references, linear placements
// snapped as zmatrix-rows.mjs (measuredRow) snaps them.
function measuredValues(points: readonly number[][], index: number, refs: readonly number[]) {
  const at = (indices: number[]) => indices.map((i) => ({ id: String(i), position: points[i] }));
  return refs.map((_, slot) => {
    if (slot === 2) {
      const angle = measureGeometry("angle", at([index, ...refs.slice(0, 2)])).value;
      if (Math.min(angle, 180 - angle) < 1e-12) return 0;
    }
    const value = measureGeometry(KINDS[slot], at([index, ...refs.slice(0, slot + 1)])).value;
    return slot === 1 && Math.min(value, 180 - value) < 1e-12 ? (value < 90 ? 0 : 180) : value;
  });
}

function perpendicular(u: number[]) {
  const axis = [0, 0, 0];
  axis[u.reduce((best, value, i) => (Math.abs(value) < Math.abs(u[best]) ? i : best), 0)] = 1;
  return unit(sub(axis, u.map((value) => value * dot(axis, u))));
}

// The unit component of `direction` across `u`; null when `direction` is along it.
function across(u: number[], direction: number[]) {
  const projection = sub(direction, u.map((value) => value * dot(direction, u)));
  return norm(projection) / norm(direction) > EPS ? unit(projection) : null;
}

// The eigenvector of the largest eigenvalue of a symmetric 4×4 matrix (cyclic Jacobi rotations).
function largestEigenvector(matrix: number[][]) {
  const a = matrix.map((row) => [...row]);
  const v: number[][] = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta < 0 ? -1 : 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < 4; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < 4; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
    }
  }
  const best = [0, 1, 2, 3].reduce((top, i) => (a[i][i] > a[top][top] ? i : top), 0);
  return v.map((row) => row[best]);
}

/**
 * The rotation and translation that best superpose `from` onto `to` (equal weights, least
 * squares): the unit-quaternion solution of Horn, J. Opt. Soc. Am. A 4, 629 (1987).
 * `point` carries a position, `direction` an offset.
 */
export function bestRigidMotion(from: number[][], to: number[][]) {
  const centre = (points: number[][]) => [0, 1, 2].map((k) => points.reduce((sum, point) => sum + point[k], 0) / points.length);
  const [cf, ct] = [centre(from), centre(to)];
  const s = [0, 1, 2].map((i) => [0, 1, 2].map((j) => from.reduce((sum, point, n) => sum + (point[i] - cf[i]) * (to[n][j] - ct[j]), 0)));
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = s;
  const [w, x, y, z] = largestEigenvector([
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]);
  const rotation = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  const direction = (offset: number[]) => rotation.map((row) => dot(row, offset));
  return { direction, point: (position: number[]) => direction(sub(position, cf)).map((value, k) => value + ct[k]) };
}

/**
 * A reference point after optimization: its own row (distance, angle and torsion from its
 * references, in the convention of atomsFromZmatrixRows in internal-coordinates.mjs) holds
 * exactly; whatever the row leaves free follows `carried`, where the best rigid motion of
 * the real atoms takes the point. `offset` is that motion applied to its previous offset
 * from its first reference, used when `carried` lies on the reference itself or its axis.
 */
function placeReferencePoint(anchors: number[][], values: number[], carried: number[], offset: number[]) {
  const [a, b, c] = anchors;
  if (!a) return carried;
  const [r, angle = 0, torsion = 0] = values;
  const toward = norm(sub(carried, a)) > EPS ? sub(carried, a) : offset;
  if (!b) return a.map((value, k) => value + r * unit(toward)[k]);
  const u = unit(sub(b, a));
  const theta = angle * DEG, phi = c ? torsion * DEG : 0;
  const sine = angle === 0 || angle === 180 ? 0 : Math.sin(theta);
  let v = c ? across(u, sub(c, a)) : across(u, toward) ?? across(u, offset);
  if (!v && c && sine) throw new Error("collinear references");
  v ??= perpendicular(u);
  const w = cross(v, u);
  return a.map((value, k) => value + r * (Math.cos(theta) * u[k] + sine * (Math.cos(phi) * v[k] + Math.sin(phi) * w[k])));
}

export type ZmatrixOptimizationResult = {
  document: ZmatrixDocument;
  /** Retained for the row-edit result contract; optimization never detaches bindings. */
  detachedBindings: { row: number; slot: number; binding: string }[];
  /** Largest distance between a real atom the definition rebuilds and the optimized one, Å. */
  deviation: number;
};

/**
 * The definition of optimized real atoms `after` (same elements and order as `before`, the
 * geometry the definition currently places). Every row keeps its references; its values are
 * measured on the optimized atoms. A reference point keeps its own values and moves with the
 * rows it is measured from; whatever its row leaves free (the first three rows) follows the
 * best rigid superposition of the real atoms before and after. A variable stays bound
 * while all its signed uses measure one value (then it takes that value); disagreement is
 * rejected rather than silently changing the definition. The rebuilt definition must place every real
 * atom where the optimization left it, or nothing is returned.
 */
export function zmatrixAfterOptimization(definition: ZmatrixDocument, before: readonly CoordinateAtom[], after: readonly CoordinateAtom[], labels: readonly string[]): ZmatrixOptimizationResult {
  const resolved = resolveZmatrixDocument(definition);
  const placed = atomsFromZmatrixRows(resolved);
  const real = placed.filter((atom) => atom.element !== "X");
  if (before.length !== real.length || after.length !== real.length
    || real.some((atom, i) => before[i].element !== atom.element || after[i].element !== atom.element)) {
    throw new Error("The optimized structure does not match the Z-matrix atoms.");
  }
  if (after.some((atom) => atom.position.length !== 3 || atom.position.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e6))) {
    throw new Error("The optimized structure has invalid coordinates.");
  }
  // Every row (reference points included) where the definition places it among the current atoms.
  const old = placeInReferenceFrame(real, [...before], placed).map(({ position }) => position);
  const atomOf = zmatrixAtomIndices(definition);
  if (atomOf.some((atom, row) => atom !== null && norm(sub(old[row], before[atom].position)) > RECONSTRUCTION_A)) {
    throw new Error("The current geometry no longer matches this Z-matrix definition.");
  }
  // Real atoms where the optimization left them; reference points follow in row order.
  const points = definition.rows.map((_, row) => (atomOf[row] === null ? [] : [...after[atomOf[row] as number].position]));
  const carry = bestRigidMotion(before.map(({ position }) => position), after.map(({ position }) => position));
  definition.rows.forEach((row, index) => {
    if (atomOf[index] !== null) return;
    try {
      points[index] = placeReferencePoint(row.refs.map((ref) => points[ref]), resolved[index].values, carry.point(old[index]),
        row.refs.length ? carry.direction(sub(old[index], old[row.refs[0]])) : [0, 0, 0]);
    } catch {
      throw new Error(`The optimized geometry made the references of ${labels[index]} collinear; it cannot be placed as before.`);
    }
  });

  let measured: number[][];
  try {
    measured = definition.rows.map((row, index) => measuredValues(points, index, row.refs));
  } catch {
    throw new Error("The optimized geometry made references of this Z-matrix collinear; it cannot keep these rows.");
  }
  // Each variable's signed uses, measured.
  const uses = new Map<string, { row: number; slot: number; implied: number }[]>();
  definition.rows.forEach((row, index) => row.values.forEach((token, slot) => {
    if (typeof token !== "string") return;
    const name = token.replace(/^[+-]/u, "");
    uses.set(name, [...(uses.get(name) ?? []), { row: index, slot, implied: (token.startsWith("-") ? -1 : 1) * measured[index][slot] }]);
  }));
  const kept = new Map<string, number>();
  for (const [name, list] of uses) {
    const [first] = list;
    const agree = list.every(({ implied, slot }) => Math.abs(slot === 2 && first.slot === 2 ? slotDifference(implied, first.implied, 2) : implied - first.implied) < AGREEMENT);
    if (!agree) throw new Error(`The optimized geometry does not preserve shared variable ${name}; its bindings were not detached.`);
    const previous = definition.variables.find((variable) => variable.name === name)!.value;
    kept.set(name, Math.abs(slotDifference(first.implied, previous, first.slot === 2 ? 2 : 0)) < AGREEMENT ? previous : first.implied);
  }
  const rows = definition.rows.map((row, index) => ({ ...row, refs: [...row.refs], values: row.values.map((token, slot) => {
    const value = measured[index][slot];
    if (typeof token === "number") return Math.abs(slotDifference(value, token, slot)) < AGREEMENT ? token : value;
    return token;
  }) }));
  const document: ZmatrixDocument = { rows, variables: definition.variables.map((variable) => ({ name: variable.name, value: kept.get(variable.name) ?? variable.value })) };
  let rebuilt: CoordinateAtom[];
  try {
    rebuilt = placeInReferenceFrame(atomsFromZmatrixDocument(document), [...after]);
  } catch (caught) {
    throw new Error(`The optimized geometry cannot be written with this Z-matrix: ${caught instanceof Error ? caught.message : String(caught)}`);
  }
  const deviation = Math.max(...rebuilt.map((atom, i) => norm(sub(atom.position, after[i].position))));
  if (!(deviation <= RECONSTRUCTION_A)) throw new Error("The optimized geometry cannot be written accurately with this Z-matrix.");
  return { document, detachedBindings: [], deviation };
}
