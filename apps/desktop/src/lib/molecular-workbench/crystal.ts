import type { MolecularAtom, UnitCell, Vec3 } from "./types";

export type CellParameters = { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };
export type FractionalRanges = [[number, number], [number, number], [number, number]];

function determinant(cell: UnitCell) {
  const [a, b, c] = cell;
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

function validateCell(cell: UnitCell) {
  if (cell.length !== 3 || cell.some(vector => vector.length !== 3 || vector.some(value => !Number.isFinite(value) || Math.abs(value) > 1e5)) || Math.abs(determinant(cell)) < 1e-8) {
    throw new Error("The cell must contain three finite, independent lattice vectors.");
  }
}

export function cellFromParameters(parameters: CellParameters): UnitCell {
  const { a, b, c, alpha, beta, gamma } = parameters;
  if (![a, b, c].every(value => Number.isFinite(value) && value > 0 && value <= 1e5) || ![alpha, beta, gamma].every(value => Number.isFinite(value) && value > 0 && value < 180)) {
    throw new Error("Cell lengths must be positive and angles must lie between 0 and 180 degrees.");
  }
  const [ca, cb, cg] = [alpha, beta, gamma].map(value => Math.cos(value * Math.PI / 180));
  const sg = Math.sin(gamma * Math.PI / 180);
  const cy = (ca - cb * cg) / sg;
  const cz2 = 1 - cb * cb - cy * cy;
  if (cz2 <= 1e-12) throw new Error("These cell angles do not form a nondegenerate unit cell.");
  const cell: UnitCell = [[a, 0, 0], [b * cg, b * sg, 0], [c * cb, c * cy, c * Math.sqrt(cz2)]];
  validateCell(cell);
  return cell;
}

export function fractionalToCartesian(point: Vec3, cell: UnitCell): Vec3 {
  return [0, 1, 2].map(axis => point.reduce((sum, value, index) => sum + value * cell[index][axis], 0)) as Vec3;
}

export function cartesianToFractional(point: Vec3, cell: UnitCell): Vec3 {
  validateCell(cell);
  const volume = determinant(cell);
  return cell.map((_, axis) => {
    const replaced = cell.map((vector, index) => index === axis ? point : vector) as UnitCell;
    return determinant(replaced) / volume;
  }) as Vec3;
}

// Reads cell metadata only. Coordinates and symmetry operations stay with the source reader.
export function readUnitCell(text: string): UnitCell | null {
  const lattice = text.match(/\bLattice\s*=\s*"([^"]*)"/i);
  if (lattice) {
    const values = lattice[1].trim().split(/\s+/).map(Number);
    if (values.length !== 9) throw new Error("Extended XYZ Lattice requires nine numbers.");
    const cell = [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)] as UnitCell;
    validateCell(cell);
    return cell;
  }
  const entries = ["length_a", "length_b", "length_c", "angle_alpha", "angle_beta", "angle_gamma"].map(name => {
    const match = text.match(new RegExp(`^\\s*_cell_${name}\\s+['\"]?([-+\\d.eE]+)(?:\\(\\d+\\))?['\"]?\\s*(?:#.*)?$`, "mi"));
    return match ? Number(match[1]) : null;
  });
  if (entries.every(value => value === null)) return null;
  if (entries.some(value => value === null)) throw new Error("The CIF cell parameters are incomplete.");
  const [a, b, c, alpha, beta, gamma] = entries as number[];
  return cellFromParameters({ a, b, c, alpha, beta, gamma });
}

export function buildSupercell(atoms: MolecularAtom[], cell: UnitCell, ranges: FractionalRanges, limit = 100_000) {
  validateCell(cell);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new Error("The atom limit must be between 1 and 100000.");
  if (ranges.length !== 3 || ranges.some(range => range.length !== 2 || !range.every(Number.isFinite) || range[1] <= range[0] || range.some(value => Math.abs(value) > 1000))) {
    throw new Error("Each fractional range must have finite, increasing bounds between -1000 and 1000.");
  }
  const spans = ranges.map(([min, max]) => Math.ceil(max - min) + 1);
  if (spans.reduce((count, span) => count * span, 1) * atoms.length > limit * 8) throw new Error("The requested supercell exceeds the atom budget.");
  const result: MolecularAtom[] = [];
  const sourceAtomIndices: number[] = [];
  const sites = new Set<string>();
  atoms.forEach((atom, sourceIndex) => {
    if (![atom.x, atom.y, atom.z].every(Number.isFinite)) throw new Error("Atom coordinates must be finite.");
    const fractional = cartesianToFractional([atom.x, atom.y, atom.z], cell).map(value => {
      const wrapped = value - Math.floor(value);
      return wrapped > 1 - 1e-9 ? 0 : wrapped;
    }) as Vec3;
    const site = `${atom.element}:${fractional.map(value => Math.round(value * 1e8)).join(",")}`;
    if (sites.has(site)) return;
    sites.add(site);
    const bounds = ranges.map(([min, max], axis) => [Math.ceil(min - fractional[axis] - 1e-9), Math.ceil(max - fractional[axis] - 1e-9)]);
    for (let i = bounds[0][0]; i < bounds[0][1]; i++) for (let j = bounds[1][0]; j < bounds[1][1]; j++) for (let k = bounds[2][0]; k < bounds[2][1]; k++) {
      if (result.length >= limit) throw new Error("The requested supercell exceeds the atom budget.");
      const [x, y, z] = fractionalToCartesian([fractional[0] + i - ranges[0][0], fractional[1] + j - ranges[1][0], fractional[2] + k - ranges[2][0]], cell);
      result.push({ ...atom, x, y, z });
      sourceAtomIndices.push(sourceIndex);
    }
  });
  return { atoms: result, sourceAtomIndices, cell: cell.map((vector, axis) => vector.map(value => value * (ranges[axis][1] - ranges[axis][0]))) as UnitCell };
}
