import { Molecule } from 'openchemlib';
import { parseMolecule, type MolecularStructure } from './molecular-graph';
import { serializePhysicalMolfile } from './molecule-serialization';
import { atomicNumber } from './elements';
import type { Vec3 } from './types';

export type GraphEdit =
  | { kind: 'add-atom'; element: string; position: Vec3 }
  | { kind: 'update-atom'; index: number; element?: string; charge?: number; isotope?: number; position?: Vec3 }
  | { kind: 'delete-atoms'; indices: number[] }
  | { kind: 'set-bond'; a: number; b: number; order: 0 | 1 | 2 | 3 }
  | { kind: 'reorder-atoms'; order: number[] };
export type GraphEditResult = MolecularStructure & { sourceAtomIndices: number[] };

/** Edits a private graph copy. A rejected edit never mutates the input. */
export function editGraph(structure: MolecularStructure, edit: GraphEdit): GraphEditResult {
  if (structure.graphSource !== 'explicit' || !structure.graphComplete) throw new Error('Editing bonds requires an explicit MOL or SDF graph.');
  if (structure.atoms.length < 1 || structure.atoms.length > 256 || structure.molfile.length > 2_000_000) throw new Error('Graph editing supports 1–256 atoms.');
  const mol = Molecule.fromMolfile(structure.molfile);
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  const n = structure.atoms.length, mapping = structure.atomMap ?? structure.atoms.map((_, i) => i);
  if (mol.getAllAtoms() !== n || mapping.length !== n || new Set(mapping).size !== n || mapping.some(i => !Number.isInteger(i) || i < 0 || i >= n)) throw new Error('Invalid atom mapping.');
  const originalMap = new Map<number, number>();
  const index = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error('Invalid atom index.');
    return mapping[i];
  };
  const position = (i: number, xyz: Vec3) => {
    if (xyz.length !== 3 || xyz.some(x => !Number.isFinite(x) || Math.abs(x) > 1e6)) throw new Error('Coordinates must be finite and within 1000000 Å.');
    mol.setAtomX(i, xyz[0]); mol.setAtomY(i, xyz[1]); mol.setAtomZ(i, xyz[2]);
  };
  structure.atoms.forEach((a, i) => {
    const j = index(i);
    if (mol.getAtomLabel(j) !== a.element) throw new Error('Graph and atom identities differ.');
    position(j, [a.x, a.y, a.z]);
    originalMap.set(i + 1, mol.getAtomMapNo(j));
    mol.setAtomMapNo(j, i + 1);
  });
  let wanted = structure.atoms.map((_, i) => i + 1);
  switch (edit.kind) {
    case 'add-atom': {
      if (n >= 256) throw new Error('Graph editing supports at most 256 atoms.');
      const j = mol.addAtom(atomicNumber(edit.element)); position(j, edit.position);
      mol.setAtomMapNo(j, n + 1); originalMap.set(n + 1, 0); wanted.push(n + 1);
      break;
    }
    case 'update-atom': {
      const j = index(edit.index);
      if (edit.element !== undefined) mol.setAtomicNo(j, atomicNumber(edit.element));
      if (edit.charge !== undefined) {
        if (!Number.isInteger(edit.charge) || Math.abs(edit.charge) > 8) throw new Error('Formal charge must be an integer from −8 to 8.');
        mol.setAtomCharge(j, edit.charge);
      }
      if (edit.isotope !== undefined) {
        if (!Number.isInteger(edit.isotope) || edit.isotope < 0 || edit.isotope > 300 || (edit.isotope > 0 && edit.isotope < mol.getAtomicNo(j))) throw new Error('Invalid isotope mass number.');
        mol.setAtomMass(j, edit.isotope);
      }
      if (edit.position) position(j, edit.position);
      break;
    }
    case 'delete-atoms': {
      if (!edit.indices.length || new Set(edit.indices).size !== edit.indices.length) throw new Error('Choose distinct atoms to delete.');
      const deleted = new Set(edit.indices.map(i => { index(i); return i + 1; }));
      wanted = wanted.filter(i => !deleted.has(i));
      if (!wanted.length) throw new Error('Keep at least one atom in the structure.');
      mol.deleteAtoms(edit.indices.map(index));
      break;
    }
    case 'set-bond': {
      const a = index(edit.a), b = index(edit.b);
      if (a === b || ![0, 1, 2, 3].includes(edit.order)) throw new Error('Choose two distinct atoms and a valid bond order.');
      const bond = mol.getBond(a, b);
      if (edit.order === 0) { if (bond < 0) throw new Error('These atoms have no bond.'); mol.deleteBond(bond); }
      else {
        const type = [0, Molecule.cBondTypeSingle, Molecule.cBondTypeDouble, Molecule.cBondTypeTriple][edit.order];
        if (bond < 0) mol.setBondType(mol.addBond(a, b), type); else mol.setBondType(bond, type);
      }
      break;
    }
    case 'reorder-atoms':
      if (edit.order.length !== n || new Set(edit.order).size !== n) throw new Error('Atom order must be a permutation.');
      edit.order.forEach(index); wanted = edit.order.map(i => i + 1);
      break;
    default: throw new Error('Unknown graph edit.');
  }
  mol.ensureHelperArrays(Molecule.cHelperRings);
  for (let i = 0; i < mol.getAllAtoms(); i++) {
    if (mol.getOccupiedValence(i) > mol.getMaxValence(i)) throw new Error('The edit exceeds the atom valence. Remove hydrogens or a bond first.');
  }
  // Helper creation may move hydrogens. Temporary map numbers track exact
  // identities through deletion and normalization, and are restored before IO.
  const internal = wanted.map(tag => {
    for (let i = 0; i < mol.getAllAtoms(); i++) if (mol.getAtomMapNo(i) === tag) return i;
    throw new Error('Atom identity was lost during editing.');
  });
  for (let i = 0; i < mol.getAllAtoms(); i++) mol.setAtomMapNo(i, originalMap.get(mol.getAtomMapNo(i)) ?? 0);
  const text = orderedMolfile(serializePhysicalMolfile(mol), internal);
  return { ...parseMolecule(text, 'mol'), molfile: text, title: structure.title, sourceAtomIndices: wanted.map(tag => tag <= n ? tag - 1 : -1) };
}

/** V3000 indices, including bond endpoints, follow the displayed atom order. */
function orderedMolfile(text: string, order: number[]): string {
  const rows = text.split('\n'), begin = rows.indexOf('M  V30 BEGIN ATOM'), end = rows.indexOf('M  V30 END ATOM');
  if (end - begin - 1 !== order.length || rows.slice(begin + 1, end).some(row => row.endsWith('-'))) throw new Error('This atom record cannot be reordered safely.');
  const atoms = rows.slice(begin + 1, end), reverse = new Map(order.map((old, i) => [old + 1, i + 1]));
  rows.splice(begin + 1, order.length, ...order.map((old, i) => atoms[old].replace(/^M  V30 \d+ /, `M  V30 ${i + 1} `)));
  let inBonds = false;
  return rows.map(row => {
    if (row === 'M  V30 BEGIN BOND') inBonds = true;
    else if (row === 'M  V30 END BOND') inBonds = false;
    else if (inBonds) return row.replace(/^(M  V30 \d+ \d+ )([0-9]+) ([0-9]+)/, (_, prefix, a, b) => `${prefix}${reverse.get(Number(a))} ${reverse.get(Number(b))}`);
    // Sgroups/collections reference atom IDs too. Until those are remapped,
    // reject instead of silently changing annotated chemical identities.
    if (/^M  V30 BEGIN (?:SGROUP|COLLECTION)/.test(row) && order.some((old, i) => old !== i)) throw new Error('Reordering annotated atom groups is not supported.');
    return row;
  }).join('\n');
}
