import type { Vec3 } from "./types";

export type CoordinateAxis = "x" | "y" | "z";
/** Source atom indices: `origin` moves to (0, 0, 0); `target`, when given, then lies on +axis. */
export type CoordinateAlign = { origin: number; target?: number; axis: CoordinateAxis };
export type CoordinateAlignResult = {
  coordinates: Vec3[];
  /** Applied first, in Å. */
  translation: Vec3;
  /** Row-major proper rotation about the origin, applied after the translation. */
  rotation: [Vec3, Vec3, Vec3];
};

const UNIT: Record<CoordinateAxis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
// A half turn about this axis reverses an antiparallel direction (Avogadro leaves the choice to Eigen).
const FOLLOWING: Record<CoordinateAxis, CoordinateAxis> = { x: "y", y: "z", z: "x" };
const LIMIT = 1e6;
const fail = (message: string): never => { throw new Error(message); };
const bounded = (point: readonly number[]) => point.length === 3 && point.every(value => Number.isFinite(value) && Math.abs(value) <= LIMIT);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Rotation taking unit `from` onto unit `to` about their common normal (identity when parallel). */
function minimalRotation(from: Vec3, to: CoordinateAxis): [Vec3, Vec3, Vec3] {
  const target = UNIT[to], cosine = dot(from, target);
  if (cosine < -1 + 1e-12) {
    const [x, y, z] = UNIT[FOLLOWING[to]];
    return [[2 * x * x - 1, 2 * x * y, 2 * x * z], [2 * y * x, 2 * y * y - 1, 2 * y * z], [2 * z * x, 2 * z * y, 2 * z * z - 1]];
  }
  // R = I + [v]× + [v]×² / (1 + c), with v = from × to and c = from · to.
  const [a, b, c] = cross(from, target), k = 1 / (1 + cosine);
  return [
    [1 - (b * b + c * c) * k, -c + a * b * k, b + a * c * k],
    [c + a * b * k, 1 - (a * a + c * c) * k, -a + b * c * k],
    [-b + a * c * k, a + b * c * k, 1 - (a * a + b * b) * k],
  ];
}

/**
 * Avogadro's Align tool (avogadrolibs `qtplugins/aligntool/aligntool.cpp`, BSD-3-Clause): shift the
 * first atom to the origin, then rotate the whole structure about the origin by the minimal rotation
 * that takes the second atom onto the positive axis. A rigid proper motion: atom order, pairwise
 * distances and handedness are unchanged. Coincident picks are refused instead of ignored.
 */
export function alignCoordinates(coordinates: readonly Vec3[], align: CoordinateAlign): CoordinateAlignResult {
  const count = coordinates.length;
  if (!count || coordinates.some(point => !Array.isArray(point) || !bounded(point))) fail("Coordinates must be finite and within 1000000 Å.");
  const indices = align.target === undefined ? [align.origin] : [align.origin, align.target];
  if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= count) || new Set(indices).size !== indices.length) fail("Choose one or two different atoms of this structure.");
  if (!Object.hasOwn(UNIT, align.axis)) fail("Choose the x, y or z axis.");
  const origin = coordinates[align.origin];
  const translation: Vec3 = [-origin[0], -origin[1], -origin[2]];
  let rotation: [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (align.target !== undefined) {
    const point = coordinates[align.target], direction: Vec3 = [point[0] + translation[0], point[1] + translation[1], point[2] + translation[2]];
    const length = Math.hypot(...direction);
    if (length < 1e-8) fail("The two atoms are at the same position; choose another atom for the axis.");
    rotation = minimalRotation(direction.map(value => value / length) as Vec3, align.axis);
  }
  const result = coordinates.map(point => {
    const shifted: Vec3 = [point[0] + translation[0], point[1] + translation[1], point[2] + translation[2]];
    return rotation.map(row => dot(row, shifted)) as Vec3;
  });
  if (result.some(point => !bounded(point))) fail("The aligned coordinates exceed 1000000 Å.");
  return { coordinates: result, translation, rotation };
}
