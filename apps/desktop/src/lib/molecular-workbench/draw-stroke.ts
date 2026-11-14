import { Molecule } from 'openchemlib';
import { atomicNumber } from './elements';
import type { BondOrder, GraphEdit } from './graph-edit';
import { covalentRadii, type MolecularStructure } from './molecular-graph';
import type { Vec3 } from './types';

/**
 * One Draw-tool gesture in the 3D view. Atom indices refer to the structure the
 * stroke is planned on; positions are in Å.
 */
export type DrawStroke =
  /** A click on empty space: a new atom there. */
  | { kind: 'atom'; element: string; position: Vec3 }
  /** A drag from an atom into empty space: a new atom bonded to it, towards the pointer. */
  | { kind: 'bonded-atom'; from: number; toward: Vec3; element: string; order: BondOrder }
  /** A drag from one atom onto another: a bond between them, or a new order for theirs. */
  | { kind: 'bond'; a: number; b: number; order: BondOrder }
  /** A click on a bond: single → double → triple → single. */
  | { kind: 'cycle-bond'; a: number; b: number }
  /** A click on an atom: it becomes the chosen element. */
  | { kind: 'element'; atom: number; element: string };

/** The graph edits of one stroke and the atoms whose hydrogens follow it, numbered after the edits. */
export type StrokePlan = { edits: GraphEdit[]; touched: number[] };

const OCL_BOND: Record<BondOrder, number> = { 1: Molecule.cBondTypeSingle, 2: Molecule.cBondTypeDouble, 3: Molecule.cBondTypeTriple, 9: Molecule.cBondTypeMetalLigand };
const ORDER_SCALE: Record<BondOrder, number> = { 1: 1, 2: 0.87, 3: 0.78, 9: 1 };
const DEFAULT_RADIUS = 0.76;

/** Bond length from covalent radii, shortened for double and triple bonds. */
export function drawnBondLength(a: string, b: string, order: BondOrder) {
  return ((covalentRadii[a] ?? DEFAULT_RADIUS) + (covalentRadii[b] ?? DEFAULT_RADIUS)) * ORDER_SCALE[order];
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Plans one stroke as graph edits. With `hydrogens`, explicit hydrogens that the
 * new bond or element would overfill are deleted first, the ones nearest the new
 * bond before others, so the edit stays within valence; the caller then fills
 * the touched atoms' free valences with new hydrogens. Returns null when the
 * stroke changes nothing, such as giving an atom the element it has.
 */
export function planStroke(structure: MolecularStructure, stroke: DrawStroke, hydrogens: boolean): StrokePlan | null {
  const n = structure.atoms.length;
  const valid = (i: number) => { if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error('Invalid atom index.'); return i; };
  const point = (i: number): Vec3 => [structure.atoms[i].x, structure.atoms[i].y, structure.atoms[i].z];
  const bondOrder = (a: number, b: number) => structure.bonds.find(bond => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a))?.order ?? 0;

  // The heavy-atom change on the current numbering; `index` renumbers after deleted hydrogens.
  let heavy: (index: (i: number) => number, added: number) => GraphEdit[];
  let touched: number[];
  // Where each touched atom's new bond points, so the hydrogen there gives way first.
  const toward = new Map<number, Vec3>();
  // The simulated bond: the pair (n is the new atom) and its order.
  let bond: { a: number; b: number; order: BondOrder } | null = null;
  if (stroke.kind === 'atom') {
    atomicNumber(stroke.element);
    heavy = () => [{ kind: 'add-atom', element: stroke.element, position: stroke.position }];
    touched = [n];
  } else if (stroke.kind === 'bonded-atom') {
    const from = valid(stroke.from), origin = point(from), length = distance(stroke.toward, origin);
    atomicNumber(stroke.element);
    if (!(length > 1e-6)) throw new Error('Drag away from the atom to place the new one.');
    const scale = drawnBondLength(structure.atoms[from].element, stroke.element, stroke.order) / length;
    const position = origin.map((value, axis) => value + (stroke.toward[axis] - value) * scale) as Vec3;
    heavy = (index, added) => [{ kind: 'add-atom', element: stroke.element, position }, { kind: 'set-bond', a: index(from), b: added, order: stroke.order }];
    touched = [from, n];
    toward.set(from, position);
    bond = { a: from, b: n, order: stroke.order };
  } else if (stroke.kind === 'bond' || stroke.kind === 'cycle-bond') {
    const a = valid(stroke.a), b = valid(stroke.b);
    if (a === b) throw new Error('Choose two distinct atoms.');
    const current = bondOrder(a, b);
    if (stroke.kind === 'cycle-bond' && !current) throw new Error('These atoms have no bond.');
    const order: BondOrder = stroke.kind === 'bond' ? stroke.order : current === 1 ? 2 : current === 2 ? 3 : 1;
    if (order === current) return null;
    heavy = index => [{ kind: 'set-bond', a: index(a), b: index(b), order }];
    touched = [a, b];
    toward.set(a, point(b)).set(b, point(a));
    bond = { a, b, order };
  } else {
    const atom = valid(stroke.atom);
    atomicNumber(stroke.element);
    if (structure.atoms[atom].element === stroke.element) return null;
    heavy = index => [{ kind: 'update-atom', index: index(atom), element: stroke.element }];
    touched = [atom];
  }

  const removed: number[] = [];
  if (hydrogens) {
    // Simulate the change on a private copy to read each touched atom's excess valence.
    const { molecule: mol } = Molecule.fromMolfileWithAtomMap(structure.molfile);
    const map = structure.atomMap ?? structure.atoms.map((_, i) => i);
    // Helper arrays move plain hydrogens to the end, so atoms are found by map number (index + 1).
    map.forEach((j, i) => mol.setAtomMapNo(j, i + 1));
    if (stroke.kind === 'atom' || stroke.kind === 'bonded-atom') mol.setAtomMapNo(mol.addAtom(atomicNumber(stroke.element)), n + 1);
    const ocl = (i: number) => {
      for (let j = 0; j < mol.getAllAtoms(); j++) if (mol.getAtomMapNo(j) === i + 1) return j;
      throw new Error('Atom identity was lost while planning the stroke.');
    };
    if (bond) {
      mol.ensureHelperArrays(Molecule.cHelperNeighbours);
      const a = ocl(bond.a), b = ocl(bond.b), existing = mol.getBond(a, b);
      mol.setBondType(existing < 0 ? mol.addBond(a, b) : existing, OCL_BOND[bond.order]);
    }
    if (stroke.kind === 'element') mol.setAtomicNo(ocl(stroke.atom), atomicNumber(stroke.element));
    mol.ensureHelperArrays(Molecule.cHelperRings);
    for (const atom of touched) {
      const excess = mol.getOccupiedValence(ocl(atom)) - mol.getMaxValence(ocl(atom));
      if (excess <= 0) continue;
      const near = toward.get(atom) ?? point(atom);
      const candidates = structure.bonds.flatMap(item => (item.a === atom ? [item.b] : item.b === atom ? [item.a] : []))
        .filter(other => structure.atoms[other].element === 'H' && !touched.includes(other) && !removed.includes(other))
        .sort((x, y) => distance(point(x), near) - distance(point(y), near));
      if (candidates.length < excess) throw new Error('The stroke exceeds the atom valence. Remove a bond first.');
      removed.push(...candidates.slice(0, excess));
    }
  }

  const index = (i: number) => i - removed.filter(r => r < i).length;
  const added = n - removed.length;
  const edits: GraphEdit[] = [...(removed.length ? [{ kind: 'delete-atoms', indices: removed } as GraphEdit] : []), ...heavy(index, added)];
  return { edits, touched: touched.map(atom => (atom === n ? added : index(atom))) };
}
