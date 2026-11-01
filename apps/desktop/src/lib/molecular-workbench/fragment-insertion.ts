import type { FragmentGraphEdit } from './graph-edit';
import type { MolecularAtom, MolecularBond, Vec3 } from './types';

/** A rigid 3D fragment. `attachment` is the placeholder atom (a dummy or a marked hydrogen) that stands
 * for the attachment partner; it is bonded to exactly one fragment atom and never becomes an atom itself. */
export type FragmentTemplate = { atoms: MolecularAtom[]; bonds: { a: number; b: number; order: 1 | 2 | 3 }[]; charges: readonly number[]; attachment: number | null };
/** Where a group attaches: an existing anchor atom and the positions of the hydrogens it may replace.
 * `atom` names an existing hydrogen; a free-valence position without one carries no `atom`. */
export type AttachmentSite = { anchor: number; leaving: { position: Vec3; atom?: number }[] };
export type FragmentPlacement = { edit: FragmentGraphEdit; anchor: number | null; replaced: number | null; bondLength: number | null };

// Single-bond covalent radii, Cordero et al., Dalton Trans. 2008, DOI:10.1039/B801115J.
// Carbon uses the paper's sp3/sp2/sp values; the others have one tabulated value.
const RADII: Record<string, number> = { H: .31, B: .84, N: .71, O: .66, F: .57, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Se: 1.20, Br: 1.20, I: 1.39 };
// Bondi, J. Phys. Chem. 1964, 68, 441; H 1.20; Si and B from Mantina et al., J. Phys. Chem. A 2009, 113, 5806.
const VDW: Record<string, number> = { H: 1.2, B: 1.92, C: 1.7, N: 1.55, O: 1.52, F: 1.47, Si: 2.1, P: 1.8, S: 1.8, Cl: 1.75, Se: 1.9, Br: 1.85, I: 1.98 };
const STEPS = 72;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const xyz = (atom: MolecularAtom): Vec3 => [atom.x, atom.y, atom.z];
function unit(a: Vec3): Vec3 {
  const norm = Math.hypot(...a);
  if (!Number.isFinite(norm) || norm < 1e-6) throw new Error('The attachment bond has no direction.');
  return scale(a, 1 / norm);
}
/** Rodrigues rotation by `angle` about the unit `axis`. */
function rotation(axis: Vec3, angle: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return (v: Vec3): Vec3 => add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}
/** A proper rotation taking unit `from` onto unit `to`. */
function aligning(from: Vec3, to: Vec3) {
  const cosine = dot(from, to), axis = cross(from, to);
  if (Math.hypot(...axis) > 1e-9) return rotation(unit(axis), Math.atan2(Math.hypot(...axis), cosine));
  if (cosine > 0) return (v: Vec3) => v;
  return rotation(unit(cross(from, Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), Math.PI);
}

function radius(element: string, orders: number[]) {
  if (element === 'C') return orders.some(order => order === 3) || orders.filter(order => order === 2).length > 1 ? .69 : orders.some(order => order === 2 || order === 1.5) ? .73 : .76;
  const value = RADII[element];
  if (value === undefined) throw new Error(`Attachment to ${element} is not supported.`);
  return value;
}
const vdw = (element: string) => VDW[element] ?? 2;

/**
 * Places a rigid fragment without moving any existing atom. With a site, the fragment atom bonded to the
 * placeholder bonds to the anchor along the replaced hydrogen's direction at the summed covalent radii;
 * the rotation about that bond and the choice among replaceable hydrogens minimize steric repulsion
 * (deterministic: the first minimum in candidate order and 5° steps). Without a site, the fragment is
 * placed beside the structure and its placeholder becomes a hydrogen.
 */
export function placeFragment(target: { atoms: MolecularAtom[]; bonds: MolecularBond[] }, template: FragmentTemplate, site: AttachmentSite | null): FragmentPlacement {
  const n = target.atoms.length, k = template.atoms.length, x = template.attachment;
  if (template.charges.length !== k || template.atoms.some(atom => !xyz(atom).every(Number.isFinite))) throw new Error('The fragment has invalid atoms.');
  const neighbours = (bonds: readonly { a: number; b: number }[], atom: number) => bonds.flatMap(bond => bond.a === atom ? [bond.b] : bond.b === atom ? [bond.a] : []);
  const partner = x === null ? -1 : neighbours(template.bonds, x)[0];
  if (x !== null && (neighbours(template.bonds, x).length !== 1 || template.bonds.some(bond => (bond.a === x || bond.b === x) && bond.order !== 1))) throw new Error('The fragment attachment point must be singly bonded to one atom.');
  if (x !== null && template.charges[x]) throw new Error('The fragment attachment point cannot carry a charge.');
  if (site && x === null) throw new Error('This fragment has no attachment point.');
  const partnerOrders = template.bonds.filter(bond => (bond.a === partner || bond.b === partner) && bond.a !== x && bond.b !== x).map(bond => bond.order);
  const kept = template.atoms.map((_, i) => i).filter(i => i !== x || !site);
  const outputIndex = new Map(kept.map((atom, i) => [atom, n + i]));
  const bonds = template.bonds.filter(bond => outputIndex.has(bond.a) && outputIndex.has(bond.b)).map(bond => ({ a: outputIndex.get(bond.a)!, b: outputIndex.get(bond.b)!, order: bond.order }));
  const elements = kept.map(i => i === x ? 'H' : template.atoms[i].element);
  const charges = kept.map(i => template.charges[i]);
  const edit = (positions: Vec3[], replace?: number, extra: FragmentGraphEdit['bonds'] = []): FragmentGraphEdit => ({
    kind: 'add-fragment', atoms: positions.map((position, i) => ({ element: elements[i], position, ...(charges[i] ? { charge: charges[i] } : {}) })),
    bonds: [...bonds, ...extra], ...(replace === undefined ? {} : { replace }),
  });

  if (!site) {
    // The placeholder becomes a hydrogen on its partner at the summed covalent radii.
    const local = kept.map(i => {
      if (i !== x) return xyz(template.atoms[i]);
      const origin = xyz(template.atoms[partner]);
      return add(origin, scale(unit(sub(xyz(template.atoms[i]), origin)), radius(template.atoms[partner].element, partnerOrders) + RADII.H));
    });
    const min = (axis: 0 | 1 | 2, points: Vec3[], s = 1) => Math.min(...points.map(p => s * p[axis]));
    const existing = target.atoms.map(xyz), centre = (points: Vec3[], axis: 1 | 2) => points.reduce((sum, p) => sum + p[axis], 0) / points.length;
    const shift: Vec3 = [-min(0, existing, -1) - min(0, local) + 3, centre(existing, 1) - centre(local, 1), centre(existing, 2) - centre(local, 2)];
    return { edit: edit(local.map(p => add(p, shift))), anchor: null, replaced: null, bondLength: null };
  }

  const anchor = site.anchor;
  if (!Number.isInteger(anchor) || anchor < 0 || anchor >= n || !site.leaving.length) throw new Error('Choose an atom to attach the fragment to.');
  const anchorOrders = target.bonds.filter(bond => bond.a === anchor || bond.b === anchor).map(bond => bond.order);
  const length = radius(target.atoms[anchor].element, anchorOrders) + radius(template.atoms[partner].element, partnerOrders);
  const g = xyz(template.atoms[partner]), toPlaceholder = unit(sub(xyz(template.atoms[x!]), g));
  const radii = kept.map(i => vdw(template.atoms[i].element));
  let best: { score: number; positions: Vec3[]; replace?: number } | null = null;
  for (const leaving of site.leaving) {
    if (leaving.atom !== undefined && (target.atoms[leaving.atom]?.element !== 'H' || neighbours(target.bonds, leaving.atom).join() !== String(anchor))) throw new Error('Only a hydrogen bonded to the chosen atom can be replaced.');
    const a = xyz(target.atoms[anchor]), axis = unit(sub(leaving.position, a)), origin = add(a, scale(axis, length));
    const align = aligning(toPlaceholder, scale(axis, -1));
    const base = kept.map(i => align(sub(xyz(template.atoms[i]), g)));
    const others = target.atoms.map((atom, j) => ({ j, p: xyz(atom), r: vdw(atom.element) })).filter(({ j }) => j !== leaving.atom && j !== anchor);
    for (let step = 0; step < STEPS; step++) {
      const turn = rotation(axis, 2 * Math.PI * step / STEPS), positions = base.map(p => add(origin, turn(p)));
      let score = 0;
      positions.forEach((p, i) => { for (const other of others) score += (0.5 * (radii[i] + other.r) / Math.max(1e-3, Math.hypot(...sub(p, other.p)))) ** 12; });
      if (!best || score < best.score * (1 - 1e-12)) best = { score, positions, replace: leaving.atom };
    }
  }
  const chosen = best!;
  for (const [i, p] of chosen.positions.entries()) for (const [j, atom] of target.atoms.entries()) {
    if (j === chosen.replace || (j === anchor && kept[i] === partner)) continue;
    if (Math.hypot(...sub(p, xyz(atom))) < 0.5 * (radii[i] + vdw(atom.element))) throw new Error('The fragment overlaps the structure at this atom. Choose another attachment atom.');
  }
  return { edit: edit(chosen.positions, chosen.replace, [{ a: anchor, b: outputIndex.get(partner)!, order: 1 }]), anchor, replaced: chosen.replace ?? null, bondLength: length };
}
