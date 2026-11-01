import { ConformerGenerator, Molecule, Resources } from 'openchemlib';
import resources from '../../../../../node_modules/openchemlib/dist/resources.json';
import { appendHydrogens } from './hydrogen-geometry';
import { editGraph, type GraphEditResult } from './graph-edit';
import { checkMoleculeSize, type MolecularStructure } from './molecular-graph';
import { elementSymbol } from './elements';
import { placeFragment, type AttachmentSite, type FragmentTemplate } from './fragment-insertion';
import type { Vec3 } from './types';

/** A library group (OpenChemistry/fragments `groups/`, by id) or a SMILES string.
 * In SMILES, one `*` marks the attachment point; without it the first atom attaches through one of its hydrogens. */
export type FragmentSource = { source: 'library'; id: string } | { source: 'smiles'; smiles: string };
export type FragmentInsertion = { structure: GraphEditResult; name: string; anchor: number | null; replaced: number | null; bondLength: number | null; addedAtoms: number };
type LibraryEntry = { id: string; category: string; name: string; elements: number[]; coords: number[]; bonds: number[]; charges?: number[] };

let registered = false;
async function libraryTemplate(id: string): Promise<FragmentTemplate & { name: string }> {
  const { fragments } = (await import('./fragment-library.json')).default as { fragments: LibraryEntry[] };
  const entry = fragments.find(fragment => fragment.id === id);
  if (!entry) throw new Error('This fragment is not in the library.');
  const dummy = entry.elements.indexOf(0);
  return {
    name: entry.name, attachment: dummy,
    atoms: entry.elements.map((z, i) => ({ element: z ? elementSymbol(z) : 'H', x: entry.coords[3 * i], y: entry.coords[3 * i + 1], z: entry.coords[3 * i + 2] })),
    bonds: Array.from({ length: entry.bonds.length / 3 }, (_, i) => ({ a: entry.bonds[3 * i], b: entry.bonds[3 * i + 1], order: entry.bonds[3 * i + 2] as 1 | 2 | 3 })),
    charges: entry.charges ?? entry.elements.map(() => 0),
  };
}

function smilesTemplate(smiles: string, attach: boolean): FragmentTemplate & { name: string } {
  const text = smiles.trim();
  if (!text || text.length > 1024 || /\s/u.test(text)) throw new Error('Enter one SMILES string.');
  const stars = text.match(/\[\*\]|\*/gu)?.length ?? 0;
  if (stars > 1) throw new Error('Mark at most one attachment point with *.');
  // The attachment point becomes a deuterium marker so the conformer places it as a substituent.
  if (stars && /\[2H/u.test(text)) throw new Error('A SMILES with an attachment point cannot also contain deuterium.');
  if (!registered) { Resources.register(resources); registered = true; }
  let mol: Molecule;
  try { mol = Molecule.fromSmiles(text.replace(/\[\*\]|\*/gu, '[2H]')); } catch { throw new Error('Could not read the SMILES.'); }
  checkMoleculeSize(mol.getAllAtoms());
  const conformer = new ConformerGenerator(1).getOneConformerAsMolecule(mol);
  if (!conformer) throw new Error('Could not generate 3D coordinates for this SMILES.');
  conformer.ensureHelperArrays(Molecule.cHelperNeighbours);
  const count = conformer.getAllAtoms();
  checkMoleculeSize(count);
  const atoms = Array.from({ length: count }, (_, i) => ({ element: conformer.getAtomLabel(i), x: conformer.getAtomX(i), y: conformer.getAtomY(i), z: conformer.getAtomZ(i) }));
  const bonds = Array.from({ length: conformer.getAllBonds() }, (_, i) => ({ a: conformer.getBondAtom(0, i), b: conformer.getBondAtom(1, i), order: conformer.getBondOrder(i) as 1 | 2 | 3 }));
  if (bonds.some(bond => ![1, 2, 3].includes(bond.order))) throw new Error('This SMILES has bonds that cannot be written to the structure.');
  const marked = Array.from({ length: count }, (_, i) => i).find(i => conformer.getAtomicNo(i) === 1 && conformer.getAtomMass(i) === 2);
  // OCL keeps SMILES atom order; added hydrogens follow the heavy atoms.
  const firstHydrogen = Array.from({ length: conformer.getAllConnAtoms(0) }, (_, j) => conformer.getConnAtom(0, j)).filter(i => conformer.getAtomicNo(i) === 1).sort((a, b) => a - b)[0];
  if (attach && !stars && firstHydrogen === undefined) throw new Error('The first SMILES atom has no hydrogen to replace. Mark the attachment point with *.');
  return { name: text, atoms, bonds, charges: Array.from({ length: count }, (_, i) => conformer.getAtomCharge(i)), attachment: stars ? marked! : attach ? firstHydrogen! : null };
}

/** The anchor and the hydrogens a group may replace: a picked hydrogen, or every hydrogen (else free valence) of a picked atom. */
async function attachmentSite(structure: MolecularStructure, target: number): Promise<AttachmentSite> {
  if (!Number.isInteger(target) || target < 0 || target >= structure.atoms.length) throw new Error('Choose an atom to attach the fragment to.');
  const neighbours = (atom: number) => structure.bonds.flatMap(bond => bond.a === atom ? [bond.b] : bond.b === atom ? [bond.a] : []);
  const position = (atom: number): Vec3 => [structure.atoms[atom].x, structure.atoms[atom].y, structure.atoms[atom].z];
  const replaceable = (atom: number) => structure.atoms[atom].element === 'H' && neighbours(atom).length === 1;
  if (structure.atoms[target].element === 'H') {
    if (!replaceable(target)) throw new Error('This hydrogen is not bonded to exactly one atom.');
    return { anchor: neighbours(target)[0], leaving: [{ position: position(target), atom: target }] };
  }
  const hydrogens = neighbours(target).filter(replaceable);
  if (hydrogens.length) return { anchor: target, leaving: hydrogens.map(atom => ({ position: position(atom), atom })) };
  // No explicit hydrogen: use the positions Add Hydrogens would give the atom's free valences.
  const { molecule: mol } = Molecule.fromMolfileWithAtomMap(structure.molfile);
  const map = structure.atomMap ?? structure.atoms.map((_, i) => i);
  structure.atoms.forEach((atom, i) => { mol.setAtomX(map[i], atom.x); mol.setAtomY(map[i], atom.y); mol.setAtomZ(map[i], atom.z); });
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  if (!mol.getImplicitHydrogens(map[target])) throw new Error('This atom has no hydrogen or free valence to replace.');
  const before = mol.getAllAtoms();
  await appendHydrogens(mol);
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  const added = Array.from({ length: mol.getAllConnAtoms(map[target]) }, (_, j) => mol.getConnAtom(map[target], j)).filter(i => i >= before);
  return { anchor: target, leaving: added.map(i => ({ position: [mol.getAtomX(i), mol.getAtomY(i), mol.getAtomZ(i)] as Vec3 })) };
}

/** The rigid template of a fragment source; `attach` requires an attachment point. */
export async function fragmentTemplate(fragment: FragmentSource, attach: boolean): Promise<FragmentTemplate & { name: string }> {
  if (fragment.source === 'library') return libraryTemplate(fragment.id);
  if (fragment.source === 'smiles') return smilesTemplate(fragment.smiles, attach);
  throw new Error('Unknown fragment source.');
}

/** Inserts one rigid fragment into an explicit graph as a single edit; existing atoms keep their coordinates. */
export async function insertFragment(structure: MolecularStructure, fragment: FragmentSource, target: number | null): Promise<FragmentInsertion> {
  const template = await fragmentTemplate(fragment, target !== null);
  const placement = placeFragment(structure, template, target === null ? null : await attachmentSite(structure, target));
  const result = editGraph(structure, placement.edit);
  return { structure: result, name: template.name, anchor: placement.anchor, replaced: placement.replaced, bondLength: placement.bondLength, addedAtoms: placement.edit.atoms.length };
}
