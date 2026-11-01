import ligandData from "./metal-ligands.json";
import { covalentRadii } from "./molecular-graph";
import type { MolecularAtom, Vec3 } from "./types";

export type CoordinationGeometry = "linear" | "trigonal-planar" | "tetrahedral" | "square-planar" | "trigonal-bipyramidal" | "square-pyramidal" | "octahedral";
export type MetalLigandId = keyof typeof ligandData.ligands;
type LigandTemplate = { label: string; formula: string; file: string; metal: Vec3; donors: number[]; atoms: [element: string, x: number, y: number, z: number, charge: number][]; bonds: [number, number, 1 | 2 | 3][] };
/** Rigid ligand templates from OpenChemistry/fragments (BSD-3-Clause); `metal` is the template's attachment dummy. */
export const METAL_LIGANDS = ligandData.ligands as unknown as Record<MetalLigandId, LigandTemplate>;

const h = Math.sqrt(3) / 2, t = 1 / Math.sqrt(3);
type Site = readonly [position: string, direction: Vec3];
/** Ideal polyhedra with the metal at the origin; site order is the public site numbering. Square pyramidal is the vacant octahedron (90°/180°). */
export const COORDINATION_GEOMETRIES: Record<CoordinationGeometry, { label: string; sites: readonly Site[] }> = {
  linear: { label: "Linear", sites: [["", [1, 0, 0]], ["", [-1, 0, 0]]] },
  "trigonal-planar": { label: "Trigonal planar", sites: [["", [1, 0, 0]], ["", [-.5, h, 0]], ["", [-.5, -h, 0]]] },
  tetrahedral: { label: "Tetrahedral", sites: [["", [t, t, t]], ["", [t, -t, -t]], ["", [-t, t, -t]], ["", [-t, -t, t]]] },
  "square-planar": { label: "Square planar", sites: [["", [1, 0, 0]], ["", [0, 1, 0]], ["", [-1, 0, 0]], ["", [0, -1, 0]]] },
  "trigonal-bipyramidal": { label: "Trigonal bipyramidal", sites: [["equatorial", [1, 0, 0]], ["equatorial", [-.5, h, 0]], ["equatorial", [-.5, -h, 0]], ["axial", [0, 0, 1]], ["axial", [0, 0, -1]]] },
  "square-pyramidal": { label: "Square pyramidal", sites: [["basal", [1, 0, 0]], ["basal", [0, 1, 0]], ["basal", [-1, 0, 0]], ["basal", [0, -1, 0]], ["apical", [0, 0, 1]]] },
  octahedral: { label: "Octahedral", sites: [["equatorial", [1, 0, 0]], ["equatorial", [0, 1, 0]], ["equatorial", [-1, 0, 0]], ["equatorial", [0, -1, 0]], ["axial", [0, 0, 1]], ["axial", [0, 0, -1]]] },
};

// Single-bond covalent radii, Å (Cordero et al., Dalton Trans. 2008, DOI:10.1039/B801115J);
// low-spin values for Mn, Fe and Co. Their sum with the donor radius is only a default distance.
export const METAL_COVALENT_RADII: Record<string, number> = {
  Sc: 1.70, Ti: 1.60, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22,
  Y: 1.90, Zr: 1.75, Nb: 1.64, Mo: 1.54, Tc: 1.47, Ru: 1.46, Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44,
  Hf: 1.75, Ta: 1.70, W: 1.62, Re: 1.51, Os: 1.44, Ir: 1.41, Pt: 1.36, Au: 1.36, Hg: 1.32, Mg: 1.41, Al: 1.21, Ga: 1.22,
};
export const METAL_DONOR_DISTANCE_LIMITS = { min: 1.4, max: 3.5 } as const;
export const OXIDATION_STATE_LIMITS = { min: -2, max: 8 } as const;

export type MetalLigandAssignment = Readonly<{ ligand: MetalLigandId; sites: readonly number[]; distance?: number }>;
export type MetalComplexOptions = Readonly<{ metal: string; oxidationState: number; geometry: CoordinationGeometry; ligands: readonly MetalLigandAssignment[] }>;
export type MetalComplexAtom = MolecularAtom & { charge: number };
export type MetalComplexGraph = {
  atoms: MetalComplexAtom[]; bonds: { a: number; b: number; order: 1 | 2 | 3 }[];
  /** Dative metal–donor edges, `a` donor → `b` metal; never covalent bonds. */
  coordination: { a: number; b: number }[];
};
export type MetalComplex = MetalComplexGraph & { charge: number; formula: string; name: string };

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
/** Rotation of `point` by `angle` about the unit `axis` (Rodrigues). */
function rotate(point: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(scale(point, c), scale(cross(axis, point), s)), scale(axis, dot(axis, point) * (1 - c)));
}
const position = (atom: LigandTemplate["atoms"][number]): Vec3 => [atom[1], atom[2], atom[3]];

/** Covalent-radius sum; a triple- or double-bonded C donor uses the sp or sp2 carbon radius. */
export function defaultDonorDistance(metal: string, ligand: MetalLigandId) {
  const template = METAL_LIGANDS[ligand], donor = template.donors[0], element = template.atoms[donor][0];
  const order = Math.max(...template.bonds.filter(bond => bond[0] === donor || bond[1] === donor).map(bond => bond[2]), 1);
  const radius = element === "C" ? [0.76, 0.76, 0.73, 0.69][order] : covalentRadii[element];
  return Number((METAL_COVALENT_RADII[metal] + radius).toFixed(2));
}

const SPINS = 24;
/** Candidate rigid poses: monodentate donors spin about M–D, chelates may swap their two donors between the sites. */
function poses(template: LigandTemplate, sites: Vec3[], distance: number): Vec3[][] {
  const points = template.atoms.map(position), metal = template.metal;
  if (sites.length === 1) {
    const donor = points[template.donors[0]], site = sites[0], pair = unit(subtract(metal, donor)), target = scale(site, -1);
    const axis = cross(pair, target), cosine = dot(pair, target);
    const align = (point: Vec3) => Math.hypot(...axis) > 1e-9 ? rotate(point, unit(axis), Math.atan2(Math.hypot(...axis), cosine))
      : cosine > 0 ? point : rotate(point, unit(cross(pair, Math.abs(pair[0]) < .9 ? [1, 0, 0] : [0, 1, 0])), Math.PI);
    const local = points.map(point => align(subtract(point, donor)));
    const symmetric = local.every(point => Math.hypot(...cross(point, site)) < 1e-6);
    return Array.from({ length: symmetric ? 1 : SPINS }, (_, spin) => local.map(point => add(scale(site, distance), rotate(point, site, 2 * Math.PI * spin / SPINS))));
  }
  const [first, second] = template.donors.map(index => points[index]), middle = scale(add(first, second), .5), half = Math.hypot(...subtract(first, second)) / 2;
  const axis = unit(subtract(first, second)), toward = subtract(metal, middle), inPlane = subtract(toward, scale(axis, dot(toward, axis)));
  if (Math.hypot(...inPlane) < 1e-6) throw new Error(`${template.label} has no chelate plane.`);
  const normal = unit(inPlane), binormal = cross(axis, normal);
  if (distance <= half + .05) throw new Error(`${template.label} cannot reach both sites at ${distance.toFixed(2)} Å.`);
  return [sites, [sites[1], sites[0]]].map(([a, b]) => {
    const bisector = unit(add(a, b)), targetAxis = unit(subtract(a, b)), targetNormal = scale(bisector, -1), targetBinormal = cross(targetAxis, targetNormal);
    const center = scale(bisector, Math.sqrt(distance * distance - half * half));
    return points.map(point => {
      const local = subtract(point, middle);
      return add(center, add(add(scale(targetAxis, dot(local, axis)), scale(targetNormal, dot(local, normal))), scale(targetBinormal, dot(local, binormal))));
    });
  });
}

const radius = (element: string) => METAL_COVALENT_RADII[element] ?? covalentRadii[element];
function closest(points: Vec3[], others: Vec3[][]) {
  let best = Infinity;
  for (const other of others) for (const a of points) for (const b of other) best = Math.min(best, Math.hypot(...subtract(a, b)));
  return best;
}

/**
 * Places rigid ligand templates on an ideal coordination polyhedron: each donor's template
 * lone-pair direction (donor → attachment dummy) points at the metal, monodentate spins and
 * chelate donor order are chosen deterministically to maximize the closest inter-ligand contact.
 */
export function buildMetalComplex(options: MetalComplexOptions): MetalComplex {
  const { metal, oxidationState, geometry, ligands } = options;
  if (!(metal in METAL_COVALENT_RADII)) throw new Error("Choose a supported metal.");
  const polyhedron = COORDINATION_GEOMETRIES[geometry];
  if (!polyhedron) throw new Error("Choose a supported coordination geometry.");
  if (!Number.isInteger(oxidationState) || oxidationState < OXIDATION_STATE_LIMITS.min || oxidationState > OXIDATION_STATE_LIMITS.max)
    throw new Error(`Use an integer oxidation state from ${OXIDATION_STATE_LIMITS.min} to +${OXIDATION_STATE_LIMITS.max}.`);
  const used = new Set<number>(), siteName = (site: number) => `site ${site + 1}`;
  const placed = ligands.map(assignment => {
    const template = METAL_LIGANDS[assignment.ligand];
    if (!template) throw new Error("Choose a supported ligand.");
    const { sites } = assignment;
    if (sites.length !== template.donors.length) throw new Error(`${template.label} occupies ${template.donors.length} site${template.donors.length > 1 ? "s" : ""}.`);
    for (const site of sites) {
      if (!Number.isInteger(site) || site < 0 || site >= polyhedron.sites.length) throw new Error(`${polyhedron.label} has sites 1–${polyhedron.sites.length}.`);
      if (used.has(site)) throw new Error(`Site ${site + 1} has more than one ligand.`);
      used.add(site);
    }
    const directions = sites.map(site => polyhedron.sites[site][1]);
    if (directions.length === 2 && dot(directions[0], directions[1]) < Math.cos(135 * Math.PI / 180))
      throw new Error(`${template.label} must span two cis sites; ${siteName(sites[0])} and ${siteName(sites[1])} are trans.`);
    const distance = assignment.distance ?? defaultDonorDistance(metal, assignment.ligand);
    if (!Number.isFinite(distance) || distance < METAL_DONOR_DISTANCE_LIMITS.min || distance > METAL_DONOR_DISTANCE_LIMITS.max)
      throw new Error(`Use metal–donor distances from ${METAL_DONOR_DISTANCE_LIMITS.min} to ${METAL_DONOR_DISTANCE_LIMITS.max} Å.`);
    return { template, sites, candidates: poses(template, directions, distance), choice: 0 };
  });
  if (used.size !== polyhedron.sites.length) throw new Error(`Assign a ligand to every ${polyhedron.label.toLowerCase()} site.`);
  const atomCount = placed.reduce((sum, ligand) => sum + ligand.template.atoms.length, 1);
  if (atomCount > 256) throw new Error("The complex exceeds the browser limit of 256 atoms.");
  // Greedy in request order, then one sweep against every other ligand; ties keep the earlier pose.
  for (const sweep of [0, 1]) placed.forEach((ligand, index) => {
    const others = placed.filter((other, j) => sweep ? j !== index : j < index).map(other => other.candidates[other.choice]);
    if (!others.length) return;
    let best = -Infinity;
    ligand.candidates.forEach((candidate, choice) => {
      const score = closest(candidate, others);
      if (score > best + 1e-9) { best = score; ligand.choice = choice; }
    });
  });
  const atoms: MetalComplexAtom[] = [{ element: metal, x: 0, y: 0, z: 0, charge: oxidationState }];
  const graph: MetalComplexGraph = { atoms, bonds: [], coordination: [] };
  const fragments: { atom: number; owner: number; donor: boolean }[] = [];
  placed.forEach((ligand, owner) => {
    const offset = atoms.length, points = ligand.candidates[ligand.choice];
    ligand.template.atoms.forEach((atom, index) => {
      atoms.push({ element: atom[0], x: points[index][0], y: points[index][1], z: points[index][2], charge: atom[4] });
      fragments.push({ atom: offset + index, owner, donor: ligand.template.donors.includes(index) });
    });
    for (const [a, b, order] of ligand.template.bonds) graph.bonds.push({ a: a + offset, b: b + offset, order });
    for (const donor of ligand.template.donors) graph.coordination.push({ a: donor + offset, b: 0 });
  });
  // Anything closer than the XYZ bond-perception cutoff (radius sum + 0.35 Å) would read back as a bond.
  const point = (index: number): Vec3 => [atoms[index].x, atoms[index].y, atoms[index].z];
  const contact = (a: number, b: number) => Math.hypot(...subtract(point(a), point(b))) < radius(atoms[a].element) + radius(atoms[b].element) + .35;
  for (const item of fragments) if (!item.donor && contact(0, item.atom)) throw new Error(`The ligand at ${siteName(placed[item.owner].sites[0])} reaches the metal.`);
  for (let i = 0; i < fragments.length; i++) for (let j = i + 1; j < fragments.length; j++) {
    const a = fragments[i], b = fragments[j];
    if (a.owner !== b.owner && contact(a.atom, b.atom))
      throw new Error(`Ligands at ${siteName(placed[a.owner].sites[0])} and ${siteName(placed[b.owner].sites[0])} overlap. Choose smaller ligands or another geometry.`);
  }
  const charge = atoms.reduce((sum, atom) => sum + atom.charge, 0);
  const counts = new Map<string, number>();
  for (const atom of atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
  // Hill order: C, H, then alphabetical; without carbon every element is alphabetical.
  const rank = (element: string) => !counts.has("C") ? 2 : element === "C" ? 0 : element === "H" ? 1 : 2;
  const hill = [...counts.keys()].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  const groups = new Map<string, { count: number; polyatomic: boolean }>();
  for (const ligand of placed) {
    const group = groups.get(ligand.template.formula) ?? { count: 0, polyatomic: ligand.template.atoms.length > 1 };
    group.count++; groups.set(ligand.template.formula, group);
  }
  const inner = [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([formula, group]) => `${group.polyatomic ? `(${formula})` : formula}${group.count > 1 ? group.count : ""}`).join("");
  const suffix = charge === 0 ? "" : `${Math.abs(charge) > 1 ? Math.abs(charge) : ""}${charge > 0 ? "+" : "-"}`;
  return { ...graph, charge, formula: hill.map(element => `${element}${counts.get(element)! > 1 ? counts.get(element) : ""}`).join(""), name: `[${metal}${inner}]${suffix}` };
}
