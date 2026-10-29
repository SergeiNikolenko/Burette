import { Molecule } from 'openchemlib';
import type { Mol } from '@rdkit/rdkit';
import { loadRDKitModule } from '../rdkit-module';
import { covalentRadii } from './molecular-graph';
import { serializePhysicalMolfile } from './molecule-serialization';
import type { Vec3 } from './types';

type CommonChem = { defaults: { atom: { z: number } }; molecules: { atoms: { z?: number }[]; bonds: { atoms: number[]; bo?: number }[]; conformers: { dim: number; coords: number[][] }[] }[] };
function readCoordinates(data: CommonChem): Vec3[] {
  const conformer = data.molecules[0].conformers[0];
  // CommonChem explicitly represents planar conformers as [x,y], not [x,y,z].
  if (!conformer || ![2, 3].includes(conformer.dim) || conformer.coords.some(v => v.length !== conformer.dim || !v.every(Number.isFinite))) throw new Error('Invalid hydrogen coordinate dimensionality.');
  return conformer.coords.map(v => [v[0], v[1], conformer.dim === 2 ? 0 : v[2]]);
}

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Add only H atoms. Existing atoms, bonds, charges, isotopes and stereo stay owned by OCL. */
export async function appendHydrogens(mol: Molecule): Promise<void> {
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  const count = mol.getAllAtoms(), bonds = mol.getAllBonds();
  const positions: Vec3[] = Array.from({ length: count }, (_, i) => [mol.getAtomX(i), mol.getAtomY(i), mol.getAtomZ(i)]);
  const implicit = positions.map((_, i) => mol.getImplicitHydrogens(i));
  if (!implicit.some(Boolean)) return;
  const neighbours = positions.map((_, i) => Array.from({ length: mol.getAllConnAtoms(i) }, (_, j) => mol.getConnAtom(i, j)));
  // Stereo perception may invent a new diagram when bonded coordinates coincide.
  // Reject that input before perception so Add H can never move existing atoms.
  if (neighbours.some((list, atom) => list.some(i => Math.hypot(...subtract(positions[i], positions[atom])) < 1e-8))) throw new Error('Cannot place hydrogens on coincident bonded atoms.');
  mol.ensureHelperArrays(Molecule.cHelperParities);
  for (let atom = 0; atom < count; atom++) if (mol.getAtomParity(atom) === Molecule.cAtomParityUnknown) mol.setAtomConfigurationUnknown(atom, true);
  const local = new Map<number, Vec3[]>();
  for (let atom = 0; atom < count; atom++) {
    if (!implicit[atom]) continue;
    const directions = neighbours[atom].map(i => subtract(positions[i], positions[atom]));
    // Opposite bonds have no bisector. RDKit returns zero-length H here; OCL's
    // 2D hydrogen handler divides by zero. Classify from source geometry first.
    if (directions.length !== 2 || implicit[atom] > 2) continue;
    const axis = unit(directions[0]), other = unit(directions[1]);
    if (Math.hypot(...axis.map((v, i) => v + other[i])) >= 1e-8) continue;
    if (mol.getAtomParity(atom) !== Molecule.cAtomParityNone || neighbours[atom].some((_, j) => mol.getBondParity(mol.getConnBond(atom, j)) !== Molecule.cBondParityNone)) {
      throw new Error('Cannot place hydrogens in degenerate specified stereochemistry.');
    }
    // Prefer the same connected component's source orientation. For an entirely
    // linear component rotation about its axis is undefined; choose a stable gauge.
    const seen = new Set([atom]), queue = [atom];
    let perpendicular: Vec3 | undefined;
    for (let k = 0; k < queue.length && !perpendicular; k++) {
      for (const i of neighbours[queue[k]]) if (!seen.has(i)) { seen.add(i); queue.push(i); }
      const delta = subtract(positions[queue[k]], positions[atom]);
      const projected = subtract(delta, scale(axis, dot(delta, axis)));
      if (Math.hypot(...projected) > 1e-8) perpendicular = unit(projected);
    }
    if (!perpendicular) {
      const index = axis.reduce((best, v, i) => Math.abs(v) < Math.abs(axis[best]) ? i : best, 0);
      const reference: Vec3 = [0, 0, 0]; reference[index] = 1;
      perpendicular = unit(subtract(reference, scale(axis, dot(reference, axis))));
    }
    const length = covalentRadii[mol.getAtomLabel(atom)] + covalentRadii.H;
    if (!Number.isFinite(length)) throw new Error('No covalent radius for degenerate hydrogen placement.');
    const normal = cross(axis, perpendicular);
    // Fixed opposite source bonds cannot be tetrahedral. Two equivalent H are
    // perpendicular to that axis, mutually tetrahedral (cos(theta) = -1/3).
    local.set(atom, Array.from({ length: implicit[atom] }, (_, h) => positions[atom].map((v, i) => v + length * (implicit[atom] === 1 ? perpendicular[i] : perpendicular[i] / Math.sqrt(3) + (h ? -1 : 1) * Math.sqrt(2 / 3) * normal[i])) as Vec3));
  }
  const rdkit = await loadRDKitModule();
  const sourceMolfile = serializePhysicalMolfile(mol);
  const sourceProbe = rdkit.get_mol(sourceMolfile, JSON.stringify({ removeHs: false }));
  if (!sourceProbe) throw new Error('Could not read the molecular graph for hydrogen placement.');
  let geometryProbe: Mol | null = null;
  try {
    const sourceData = JSON.parse(sourceProbe.get_json()) as CommonChem;
    const sourceCoordinates = readCoordinates(sourceData);
    if (positions.some((p, i) => !sourceCoordinates[i] || Math.hypot(...subtract(p, sourceCoordinates[i])) > 1e-8)) throw new Error('Hydrogen placement changed the source coordinate frame.');
    // A pure translation gives planar input a nonzero z coordinate, so RDKit
    // uses its 3D H placer rather than its origin-dependent 2D diagram placer.
    // Preserve every stereo marker; only new H are translated back afterwards.
    const origin: Vec3 = [0, 0, Math.abs(positions[0][2] + 1) < .5 ? 2 : 1];
    const geometryMol = mol.getCompactCopy();
    positions.forEach((p, i) => { geometryMol.setAtomX(i, p[0]); geometryMol.setAtomY(i, p[1]); geometryMol.setAtomZ(i, p[2] + origin[2]); });
    geometryMol.setParitiesValid(0);
    geometryProbe = rdkit.get_mol(serializePhysicalMolfile(geometryMol), JSON.stringify({ removeHs: false }));
    if (!geometryProbe || !geometryProbe.add_hs_in_place()) throw new Error('Could not place hydrogens in the source coordinate frame.');
    const data = JSON.parse(geometryProbe.get_json()) as CommonChem;
    if (data.molecules[0].conformers[0].dim !== 3) throw new Error('Could not obtain 3D hydrogen coordinates.');
    const expanded = data.molecules[0], coordinates = readCoordinates(data).map(p => subtract(p, origin));
    if (positions.some((p, i) => !coordinates[i] || Math.hypot(...subtract(p, coordinates[i])) > 1e-8)) throw new Error('Hydrogen placement changed the source coordinate frame.');
    if (expanded.atoms.length !== count + implicit.reduce((a, b) => a + b, 0) || coordinates?.length !== expanded.atoms.length || expanded.atoms.slice(0, count).some((a, i) => (a.z ?? data.defaults.atom.z) !== mol.getAtomicNo(i))) throw new Error('Hydrogen placement changed the molecular atom identities.');
    const ordinals = positions.map(() => 0), additions: { parent: number; position: Vec3 }[] = [];
    for (let i = count; i < expanded.atoms.length; i++) {
      const connections = expanded.bonds.filter(b => b.atoms.includes(i));
      const parent = connections[0]?.atoms.find(a => a !== i) ?? -1;
      if ((expanded.atoms[i].z ?? data.defaults.atom.z) !== 1 || connections.length !== 1 || (connections[0].bo ?? 1) !== 1 || parent < 0 || parent >= count) throw new Error('Hydrogen placement changed the molecular graph.');
      const ordinal = ordinals[parent]++;
      const position = local.get(parent)?.[ordinal] ?? coordinates[i];
      if (!position.every(Number.isFinite) || Math.hypot(...subtract(position, positions[parent])) < .1) throw new Error('Could not determine a nonzero hydrogen bond direction.');
      additions.push({ parent, position });
    }
    if (ordinals.some((n, i) => n !== implicit[i])) throw new Error('Hydrogen placement changed the atom valences.');
    // RDKit can leave an unplaced H at absolute zero in almost linear geometry.
    // A length check alone cannot detect that at a translated parent. Require a
    // genuine rigid-translation invariant, comparing equivalent H as local sets.
    const shift: Vec3 = [17, 31, Math.abs(positions[0][2] + origin[2] + 43) < .5 ? 44 : 43];
    const shiftedMol = mol.getCompactCopy();
    positions.forEach((p, i) => { shiftedMol.setAtomX(i, p[0] + shift[0]); shiftedMol.setAtomY(i, p[1] + shift[1]); shiftedMol.setAtomZ(i, p[2] + origin[2] + shift[2]); });
    shiftedMol.setParitiesValid(0);
    const translated = rdkit.get_mol(serializePhysicalMolfile(shiftedMol), JSON.stringify({ removeHs: false }));
    if (!translated) throw new Error('Could not validate the hydrogen coordinate frame.');
    try {
      if (!translated.add_hs_in_place()) throw new Error('Could not validate hydrogen placement.');
      const shiftedData = JSON.parse(translated.get_json()) as CommonChem;
      const shifted = shiftedData.molecules[0], points = readCoordinates(shiftedData).map(p => subtract(p, origin));
      if (shifted.conformers[0].dim !== 3) throw new Error('Could not validate 3D hydrogen coordinates.');
      if (shifted.atoms.length !== expanded.atoms.length || points.length !== coordinates.length) throw new Error('Hydrogen validation changed the molecular graph.');
      const choices = new Map<number, Vec3[]>();
      for (let i = count; i < points.length; i++) {
        const links = shifted.bonds.filter(b => b.atoms.includes(i));
        const parent = links[0]?.atoms.find(a => a !== i) ?? -1;
        if (links.length !== 1 || parent < 0 || parent >= count) throw new Error('Hydrogen validation changed the molecular graph.');
        const list = choices.get(parent) ?? []; list.push(subtract(points[i], shift)); choices.set(parent, list);
      }
      for (const { parent, position } of additions) if (!local.has(parent)) {
        const list = choices.get(parent) ?? [];
        // Input MOL coordinates retain 10 decimal places. A 1e-5 Å tolerance
        // admits roundoff while rejecting numerically unstable local directions.
        const match = list.findIndex(p => Math.hypot(...subtract(p, position)) < 1e-5);
        if (match < 0) throw new Error('Hydrogen geometry is unstable under a rigid translation.');
        list.splice(match, 1);
      }
    } finally { translated.delete(); }
    // Validate every new coordinate before mutating our private graph. Appending
    // explicit H preserves the original parity ordering (H is last priority).
    for (const { parent, position } of additions) {
      const h = mol.addAtom(1); mol.setAtomX(h, position[0]); mol.setAtomY(h, position[1]); mol.setAtomZ(h, position[2]);
      mol.addBond(parent, h);
    }
    if (mol.getAllBonds() !== bonds + additions.length) throw new Error('Hydrogen placement changed the bond count.');
    mol.setParitiesValid(0);
  } finally { geometryProbe?.delete(); sourceProbe.delete(); }
}
