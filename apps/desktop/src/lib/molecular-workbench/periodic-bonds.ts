import type { MolecularAtom, UnitCell, Vec3 } from "./types";

/**
 * Bonds of a periodic structure under the minimum-image convention, and the
 * placement that keeps every finite molecule whole.
 *
 * Two atoms are bonded when 0.4 Å < d < r_i + r_j + 0.45 Å with the single-bond
 * covalent radii of Cordero et al., Dalton Trans. 2008, 2832 — the rule Avogadro and
 * Open Babel use for distance bonding — where d is measured to every lattice image,
 * so a bond across a cell face is found once, with the image it reaches.
 *
 * Wrapping atoms one by one into the cell splits molecules that cross a face; a
 * non-periodic bond search then loses those bonds. `wholeMolecules` moves each finite
 * fragment by whole lattice vectors so its bonded atoms are adjacent images and its
 * centre lies in the cell. Infinite networks (a cycle of bonds that adds up to a
 * lattice translation, as in quartz or rutile) are left where they are.
 */

// Cordero 2008 radii in angstrom for Z = 1–96 (sp3 C; low-spin Mn, Fe, Co).
const RADII = "0.31 0.28 1.28 0.96 0.84 0.76 0.71 0.66 0.57 0.58 1.66 1.41 1.21 1.11 1.07 1.05 1.02 1.06 2.03 1.76 1.70 1.60 1.53 1.39 1.39 1.32 1.26 1.24 1.32 1.22 1.22 1.20 1.19 1.20 1.20 1.16 2.20 1.95 1.90 1.75 1.64 1.54 1.47 1.46 1.42 1.39 1.45 1.44 1.42 1.39 1.39 1.38 1.39 1.40 2.44 2.15 2.07 2.04 2.03 2.01 1.99 1.98 1.98 1.96 1.94 1.92 1.92 1.89 1.90 1.87 1.87 1.75 1.70 1.62 1.51 1.44 1.41 1.36 1.36 1.32 1.45 1.46 1.48 1.40 1.50 1.50 2.60 2.21 2.15 2.06 2.00 1.96 1.90 1.87 1.80 1.69".split(" ").map(Number);
const SYMBOLS = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm".split(" ");
const COVALENT_RADII = new Map(SYMBOLS.map((symbol, index) => [symbol, RADII[index]]));
const BOND_TOLERANCE = 0.45;
const MIN_BOND = 0.4;
export const PERIODIC_BOND_ATOM_LIMIT = 100_000;
/** Ghost images one search may create; a cell much thinner than a bond needs many. */
const GHOST_LIMIT = 4_000_000;

/** `image` is the lattice translation, in cell vectors, from atom a to the bonded copy of atom b. */
export type PeriodicBond = { a: number; b: number; image: Vec3 };
export type Fragment = { atoms: number[]; periodic: boolean };

const det = ([a, b, c]: UnitCell) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function fractionalOf(atoms: readonly MolecularAtom[], cell: UnitCell) {
  const volume = det(cell);
  if (!Number.isFinite(volume) || Math.abs(volume) < 1e-8) throw new Error("The cell must contain three independent lattice vectors.");
  // Rows of the inverse: f_k = (r · (b × c)) / V for k = a, and cyclically.
  const normals = [cross(cell[1], cell[2]), cross(cell[2], cell[0]), cross(cell[0], cell[1])].map(n => n.map(value => value / volume) as Vec3);
  return {
    normals,
    fractional: atoms.map(atom => normals.map(n => n[0] * atom.x + n[1] * atom.y + n[2] * atom.z) as Vec3),
    // Distance between neighbouring lattice planes along each axis.
    spacings: normals.map(n => 1 / Math.hypot(n[0], n[1], n[2])),
  };
}

function radius(element: string) {
  const value = COVALENT_RADII.get(element);
  if (value === undefined) throw new Error(`No covalent radius is known for ${element}.`);
  return value;
}

export function perceivePeriodicBonds(atoms: readonly MolecularAtom[], cell: UnitCell): PeriodicBond[] {
  if (atoms.length > PERIODIC_BOND_ATOM_LIMIT) throw new Error(`Periodic bonding supports at most ${PERIODIC_BOND_ATOM_LIMIT.toLocaleString("en-US")} atoms.`);
  if (!atoms.length) return [];
  const radii = atoms.map(atom => radius(atom.element));
  const reach = 2 * Math.max(...radii) + BOND_TOLERANCE;
  const { fractional, spacings } = fractionalOf(atoms, cell);
  if (!fractional.flat().every(value => Number.isFinite(value) && Math.abs(value) < 1e9)) throw new Error("Atom coordinates must be finite.");
  const shift = fractional.map(point => point.map(Math.floor) as Vec3);
  const wrapped = fractional.map((point, index) => point.map((value, axis) => value - shift[index][axis]) as Vec3);
  const margin = spacings.map(spacing => reach / spacing);
  const ranges = margin.map(value => Math.ceil(value) + 1);
  const toCartesian = (f: Vec3): Vec3 => [0, 1, 2].map(axis => f[0] * cell[0][axis] + f[1] * cell[1][axis] + f[2] * cell[2][axis]) as Vec3;

  // Every image within `reach` of the cell becomes a ghost, hashed on a grid of `reach`.
  type Ghost = { atom: number; image: Vec3; point: Vec3 };
  const grid = new Map<string, Ghost[]>();
  const key = (point: Vec3) => point.map(value => Math.floor(value / reach)).join(",");
  let ghosts = 0;
  for (let i = -ranges[0]; i <= ranges[0]; i++) for (let j = -ranges[1]; j <= ranges[1]; j++) for (let k = -ranges[2]; k <= ranges[2]; k++) {
    const image: Vec3 = [i, j, k];
    wrapped.forEach((point, atom) => {
      const moved = point.map((value, axis) => value + image[axis]) as Vec3;
      if (moved.some((value, axis) => value < -margin[axis] || value > 1 + margin[axis])) return;
      if (++ghosts > GHOST_LIMIT) throw new Error("The cell is too thin for a periodic bond search.");
      const cartesian = toCartesian(moved);
      const cellKey = key(cartesian);
      const bucket = grid.get(cellKey);
      const ghost = { atom, image, point: cartesian };
      if (bucket) bucket.push(ghost); else grid.set(cellKey, [ghost]);
    });
  }

  const bonds: PeriodicBond[] = [];
  wrapped.forEach((point, a) => {
    const origin = toCartesian(point);
    const [gx, gy, gz] = origin.map(value => Math.floor(value / reach));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const ghost of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
        const b = ghost.atom, t = ghost.image;
        // Each bond is met from both ends; keep it once.
        if (b < a || (b === a && !(t[0] > 0 || (t[0] === 0 && (t[1] > 0 || (t[1] === 0 && t[2] > 0)))))) continue;
        const distance = Math.hypot(ghost.point[0] - origin[0], ghost.point[1] - origin[1], ghost.point[2] - origin[2]);
        if (distance <= MIN_BOND || distance >= radii[a] + radii[b] + BOND_TOLERANCE) continue;
        // Back to the atoms' own (unwrapped) coordinates.
        bonds.push({ a, b, image: t.map((value, axis) => value + shift[a][axis] - shift[b][axis]) as Vec3 });
      }
    }
  });
  return bonds;
}

/** Connected fragments through bonds and images; a fragment is periodic when a cycle of its bonds spans a lattice translation. */
export function periodicFragments(atomCount: number, bonds: readonly PeriodicBond[]) {
  const adjacency: { atom: number; image: Vec3 }[][] = Array.from({ length: atomCount }, () => []);
  for (const bond of bonds) {
    adjacency[bond.a].push({ atom: bond.b, image: bond.image });
    adjacency[bond.b].push({ atom: bond.a, image: bond.image.map(value => -value) as Vec3 });
  }
  const placement: (Vec3 | null)[] = Array.from({ length: atomCount }, () => null);
  const fragments: Fragment[] = [];
  for (let start = 0; start < atomCount; start++) {
    if (placement[start]) continue;
    placement[start] = [0, 0, 0];
    const members = [start], queue = [start];
    let periodic = false;
    while (queue.length) {
      const atom = queue.pop()!;
      for (const next of adjacency[atom]) {
        const expected = placement[atom]!.map((value, axis) => value + next.image[axis]) as Vec3;
        const placed = placement[next.atom];
        if (!placed) { placement[next.atom] = expected; members.push(next.atom); queue.push(next.atom); }
        else if (placed.some((value, axis) => value !== expected[axis])) periodic = true;
      }
    }
    fragments.push({ atoms: members.sort((x, y) => x - y), periodic });
  }
  // `placement` is the lattice translation that brings each atom next to its fragment's first atom.
  return { fragments, placement: placement as Vec3[] };
}

/**
 * Moves every finite molecule by whole lattice vectors so it is contiguous and its
 * fractional centre lies in [0, 1)³. Periodic networks and atom order are kept.
 */
export function wholeMolecules(atoms: readonly MolecularAtom[], cell: UnitCell, bonds = perceivePeriodicBonds(atoms, cell)) {
  const { fractional } = fractionalOf(atoms, cell);
  const { fragments, placement } = periodicFragments(atoms.length, bonds);
  const translation: Vec3[] = atoms.map(() => [0, 0, 0]);
  for (const fragment of fragments) {
    if (fragment.periodic) continue;
    const centre = [0, 1, 2].map(axis => fragment.atoms.reduce((sum, atom) => sum + fractional[atom][axis] + placement[atom][axis], 0) / fragment.atoms.length);
    const back = centre.map(Math.floor);
    for (const atom of fragment.atoms) translation[atom] = placement[atom].map((value, axis) => value - back[axis]) as Vec3;
  }
  const moved = atoms.map((atom, index) => {
    const t = translation[index];
    if (!t[0] && !t[1] && !t[2]) return { ...atom };
    return {
      ...atom,
      x: atom.x + t[0] * cell[0][0] + t[1] * cell[1][0] + t[2] * cell[2][0],
      y: atom.y + t[0] * cell[0][1] + t[1] * cell[1][1] + t[2] * cell[2][1],
      z: atom.z + t[0] * cell[0][2] + t[1] * cell[1][2] + t[2] * cell[2][2],
    };
  });
  return { atoms: moved, fragments, translations: translation };
}
