import { Molecule } from 'openchemlib';
import { atomicNumber } from './elements';
import type { MolecularAtom, MolecularBond } from './types';
import { serializePhysicalMolfile } from './molecule-serialization';
import { parseXyz } from './xyz';

export type MolecularStructure = {
  atoms: MolecularAtom[]; bonds: MolecularBond[]; molfile: string; title: string;
  graphSource: 'explicit' | 'perceived'; graphComplete: boolean;
  /** Output atom index -> OCL molfile atom index (OCL moves plain H to the end). */
  atomMap?: number[];
};

// Single-bond covalent radii, angstrom (Cordero et al., Dalton Trans. 2008,
// DOI:10.1039/B801115J). They infer connectivity only, never bond order/charge.
const radii: Record<string, number> = { H: .31, B: .84, C: .76, N: .71, O: .66, F: .57, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Br: 1.20, I: 1.39 };
const valences: Record<string, number> = { H: 1, B: 3, C: 4, N: 3, O: 2, F: 1, Si: 4, P: 3, S: 2, Cl: 1, Br: 1, I: 1 };
const limit = 256;
export function checkMoleculeSize(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > limit) throw new Error(`Browser chemistry supports 1–${limit} atoms.`);
}

export function snapshotMolecule(mol: Molecule, title = '', graphSource: MolecularStructure['graphSource'] = 'explicit', graphComplete = true, atomMap?: number[]): MolecularStructure {
  mol.ensureHelperArrays(Molecule.cHelperRings);
  checkMoleculeSize(mol.getAllAtoms());
  const indices = atomMap ?? Array.from({ length: mol.getAllAtoms() }, (_, i) => i);
  const atoms = indices.map(i => ({ element: mol.getAtomLabel(i), x: mol.getAtomX(i), y: mol.getAtomY(i), z: mol.getAtomZ(i) }));
  if (atoms.some(a => ![a.x, a.y, a.z].every(Number.isFinite))) throw new Error('Invalid molecular coordinates.');
  const bonds = Array.from({ length: mol.getAllBonds() }, (_, i) => ({ a: indices.indexOf(mol.getBondAtom(0, i)), b: indices.indexOf(mol.getBondAtom(1, i)), order: mol.isAromaticBond(i) ? 1.5 : mol.getBondOrder(i) }));
  return { atoms, bonds, molfile: serializePhysicalMolfile(mol), title, graphSource, graphComplete, ...(atomMap ? { atomMap } : {}) };
}
export function parseMolecule(source: string, format: 'xyz' | 'sdf' | 'mol'): MolecularStructure {
  if (source.length > 2_000_000) throw new Error('Molecule input exceeds 2 MB.');
  if (format === 'mol' || format === 'sdf') {
    const records = source.split(/^\$\$\$\$\s*$/m).filter(s => s.trim());
    if (records.length !== 1) throw new Error('Open one SDF record at a time.');
    let parsed: ReturnType<typeof Molecule.fromMolfileWithAtomMap>;
    try { parsed = Molecule.fromMolfileWithAtomMap(records[0]); }
    catch { throw new Error('Could not read the molecule. Check the MOL or SDF connection table.'); }
    if (!parsed?.molecule) throw new Error('Could not read the molecule. Check the MOL or SDF connection table.');
    const { molecule: mol, map } = parsed;
    // OCL reads MOL coordinates in a frame rotated 180° about x. The public
    // molecular model shares the source/viewer's physical Cartesian frame.
    for (let i = 0; i < mol.getAllAtoms(); i++) {
      mol.setAtomY(i, -mol.getAtomY(i));
      mol.setAtomZ(i, -mol.getAtomZ(i));
    }
    return snapshotMolecule(mol, records[0].split(/\r?\n/)[0], 'explicit', true, Array.from(map));
  }
  if (format !== 'xyz') throw new Error('Unsupported molecule format.');
  const { atoms, title } = parseXyz(source);
  checkMoleculeSize(atoms.length);
  const mol = new Molecule(atoms.length, atoms.length * 2);
  atoms.forEach(a => { const i = mol.addAtom(atomicNumber(a.element)); mol.setAtomX(i, a.x); mol.setAtomY(i, a.y); mol.setAtomZ(i, a.z); mol.setAtomMapNo(i, i + 1); });
  const degrees = atoms.map(() => 0);
  for (let a = 0; a < atoms.length; a++) for (let b = a + 1; b < atoms.length; b++) {
    const x = atoms[a], y = atoms[b];
    if (!radii[x.element] || !radii[y.element]) continue;
    const d = Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z);
    // Display-only single-bond perception. Accept it for calculation only when
    // every neutral, common-valence atom is saturated by the explicit atoms.
    if (d > .2 && d <= radii[x.element] + radii[y.element] + .35) { mol.addBond(a, b); degrees[a]++; degrees[b]++; }
  }
  const complete = atoms.every((a, i) => degrees[i] === valences[a.element]);
  mol.ensureHelperArrays(Molecule.cHelperRings);
  const atomMap = atoms.map((_, i) => Array.from({ length: mol.getAllAtoms() }, (_, j) => j).find(j => mol.getAtomMapNo(j) === i + 1)!);
  atomMap.forEach(i => mol.setAtomMapNo(i, 0));
  return snapshotMolecule(mol, title, 'perceived', complete, atomMap);
}
