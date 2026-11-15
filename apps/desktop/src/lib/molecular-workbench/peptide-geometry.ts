// Adapts the BSD-3-Clause Avogadro peptide builder and OpenChemistry fragments.
// See docs/peptide-geometry.md and docs/third-party/{avogadro,fragments}-LICENSE.
import residueData from "./peptide-residues.json";
import { atomsFromZmatrixRows, type ZmatrixRow } from "../../../../../scripts/internal-coordinates.mjs";
import type { ResidueChirality } from "./peptide";

type ResidueTemplate = {
  name: string;
  atoms: (string | number)[][];
  bonds: (string | number)[][];
};
export type PeptideGeometryOptions = {
  phi?: number;
  psi?: number;
  chirality?: ResidueChirality | ResidueChirality[];
  nTerminus?: "amine" | "ammonium";
  cTerminus?: "acid" | "carboxylate";
  chain?: string;
};
export type PeptideGeometry = {
  atoms: { element: string; name: string; residue: string; residueNumber: number; chain: string; charge: number; position: number[] }[];
  bonds: { a: number; b: number; order: number }[];
  chirality: ResidueChirality[];
};
/** Angles for L residues; the D enantiomer of each conformation is (−φ, −ψ). */
export const PEPTIDE_BACKBONE_PRESETS = {
  extended: { phi: 180, psi: 180 }, alpha: { phi: -60, psi: -40 },
  beta: { phi: -135, psi: 135 }, helix310: { phi: -74, psi: -4 }, pi: { phi: -57, psi: -70 },
} as const;
// wwPDB Chemical Component Dictionary identifiers of the D enantiomers.
const D_COMPONENTS: Record<string, string> = {
  ALA: "DAL", ARG: "DAR", ASN: "DSG", ASP: "DAS", CYS: "DCY", GLN: "DGN", GLU: "DGL", HIS: "DHI", ILE: "DIL", LEU: "DLE",
  LYS: "DLY", MET: "MED", PHE: "DPN", PRO: "DPR", SER: "DSN", THR: "DTH", TRP: "DTR", TYR: "DTY", VAL: "DVA",
};
// The fragment's free-acid ring (CA–N–CD 104°) leaves a peptide Pro N pyramidal at
// any useful phi. These Cγ-endo/exo L rings keep its lengths and angles, close
// N–CD at its 1.4866 Å, set CA–N–CD to 112°, and fix the phi that keeps N planar.
// Ring torsions are [chi1, chi2, chi3]; ring H dihedrals keep their offsets.
const PRO_PUCKERS = [{ phi: -70.67, chi: [23.943, -29.5, 23.528] }, { phi: -51.65, chi: [-23.943, 29.5, -23.528] }];
const PRO_RING: Record<string, [number, number]> = { CG: [0, 0], CD: [1, 0], HB2: [0, 118.817], HB3: [0, -118.889], HG2: [1, 118.835], HG3: [1, -118.887], HD2: [2, 118.902], HD3: [2, -118.66] };
const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;

/** Creates a new named peptide in a canonical frame; never mutates a source pose. */
export function buildPeptideGeometry(sequence: string, options: PeptideGeometryOptions = {}): PeptideGeometry {
  const compact = sequence.replace(/\s+/g, ""), codes = compact.toUpperCase();
  const templates: Record<string, ResidueTemplate> = residueData;
  if (!/^[A-Za-z]+$/.test(compact) || codes.length > 64 || [...codes].some(code => !templates[code]))
    throw new Error("Use 1–64 standard amino-acid one-letter codes.");
  const { phi = 180, psi = 180, nTerminus = "amine", cTerminus = "acid", chain = "A", chirality = "L" } = options;
  if (![phi, psi].every(value => Number.isFinite(value) && Math.abs(value) <= 180)) throw new Error("Backbone angles must be within −180 to 180 degrees.");
  if (!/^[A-Za-z0-9]$/.test(chain)) throw new Error("Use one letter or digit for the chain.");
  if (!["amine", "ammonium"].includes(nTerminus) || !["acid", "carboxylate"].includes(cTerminus)) throw new Error("Unsupported peptide terminal group.");
  const stereos = Array.isArray(chirality) ? Array.from(chirality) : [...codes].map(() => chirality);
  if (stereos.length !== codes.length || stereos.some(value => value !== "L" && value !== "D")) throw new Error("Specify L or D for each residue.");
  const atoms: PeptideGeometry["atoms"] = [], bonds: PeptideGeometry["bonds"] = [], rows: ZmatrixRow[] = [];
  let previous: Map<string, number> | undefined;
  for (const [residueIndex, code] of [...codes].entries()) {
    const template = templates[code], names = new Map<string, number>(), indices = new Map<number, number>();
    const first = residueIndex === 0, last = residueIndex === codes.length - 1, mirror = stereos[residueIndex] === "D" ? -1 : 1;
    // Pro takes the ring pucker whose fixed phi is nearest the requested one.
    const pucker = PRO_PUCKERS.reduce((best, item) => Math.abs(wrap(item.phi * mirror - phi)) < Math.abs(wrap(best.phi * mirror - phi)) ? item : best);
    const residue = mirror < 0 && code !== "G" ? D_COMPONENTS[template.name] : template.name;
    for (const [templateIndex, values] of template.atoms.entries()) {
      const [element, name] = values as [string, string, ...number[]];
      if ((!last && (name === "OXT" || name === "HXT")) || (last && name === "HXT" && cTerminus === "carboxylate") || (!first && code === "P" && name === "H")) continue;
      const index = atoms.length;
      indices.set(templateIndex + 1, index); names.set(name, index);
      const arity = Math.min(index, 3), refs = (values.slice(5) as number[]).slice(0, arity).map(ref => indices.get(ref)!);
      const coordinates = (values.slice(2, 5) as number[]).slice(0, arity);
      if (code === "P" && PRO_RING[name]) coordinates[2] = pucker.chi[PRO_RING[name][0]] + PRO_RING[name][1];
      if (arity === 3) coordinates[2] *= mirror;
      if (previous) {
        if (name === "N") { refs.splice(0, 3, previous.get("C")!, previous.get("CA")!, previous.get("N")!); coordinates.splice(0, 3, 1.329, 116.2, psi); }
        else if (name === "CA") { refs.splice(0, 3, names.get("N")!, previous.get("C")!, previous.get("CA")!); coordinates[1] = 121.7; coordinates[2] = 180; }
        else if (name === "C") { refs.splice(0, 3, names.get("CA")!, names.get("N")!, previous.get("C")!); coordinates[2] = code === "P" ? pucker.phi * mirror : phi; }
        // The amide H bisects the exterior C–N–CA angle in the peptide plane.
        else if (name === "H") { coordinates[1] = (360 - 121.7) / 2; coordinates[2] = phi + 180; }
      }
      if (coordinates.length === 3) coordinates[2] = wrap(coordinates[2]);
      rows.push({ element, refs, values: coordinates });
      atoms.push({ element, name, residue, residueNumber: residueIndex + 1, chain, charge: last && name === "OXT" && cTerminus === "carboxylate" ? -1 : first && name === "N" && nTerminus === "ammonium" ? 1 : 0, position: [] });
    }
    for (const [aName, bName, order] of template.bonds) {
      const a = names.get(aName as string), b = names.get(bName as string);
      if (a !== undefined && b !== undefined) bonds.push({ a, b, order: order as number });
    }
    if (first) {
      const extras = nTerminus === "ammonium" ? (code === "P" ? ["H2"] : ["H2", "H3"]) : code === "P" ? [] : ["H2"];
      for (const name of extras) {
        const n = names.get("N")!;
        // These terminal bonds are explicit; the residue dictionary may omit H3.
        // Their provisional rows are replaced by the tetrahedral completion below.
        bonds.push({ a: n, b: atoms.length, order: 1 });
        atoms.push({ element: "H", name, residue, residueNumber: 1, chain, charge: 0, position: [] });
        rows.push({ element: "H", refs: [n, names.get("CA")!, names.get("C")!], values: [1.009, 109.5, name === "H2" ? 120 : 60] });
      }
    }
    if (previous) {
      bonds.push({ a: previous.get("C")!, b: names.get("N")!, order: 1 });
      rows[previous.get("O")!].values[2] = wrap(psi + 180);
    }
    previous = names;
  }
  if (atoms.length > 256) throw new Error("The peptide exceeds the browser limit of 256 atoms including hydrogens.");
  const valence = atoms.map(() => 0);
  for (const bond of bonds) { valence[bond.a] += bond.order; valence[bond.b] += bond.order; }
  for (const [index, atom] of atoms.entries()) if (atom.element === "N" && !atom.charge && valence[index] === 4) atom.charge = 1;
  // A template side chain keeps its rotamer unless it overlaps the chain by more
  // than 0.4 Å (Bondi radii, pairs over three bonds apart, polar contacts exempt);
  // then the staggered chi1 (and chi2) alternative with the least overlap is used.
  // Backbone overlaps weigh ten times more, so a side chain blocked by its
  // neighbours' side chains still leaves the backbone. Side-chain torsions never
  // move another residue's atoms. Terminal N–H sites are only completed later.
  const fixed = atoms.map(atom => ["N", "CA", "C", "O", "H", "H2", "H3", "HA", "HA2", "HA3", "CB", "OXT", "HXT"].includes(atom.name));
  const radius: Record<string, number> = { H: 1.2, C: 1.7, N: 1.55, O: 1.52, S: 1.8 };
  const linked = atoms.map(() => [] as number[]);
  for (const bond of bonds) { linked[bond.a].push(bond.b); linked[bond.b].push(bond.a); }
  const polar = atoms.map((atom, index) => atom.element === "N" || atom.element === "O" || (atom.element === "H" && linked[index].some(other => atoms[other].element === "N" || atoms[other].element === "O")));
  const heavyPolar = atoms.map(atom => atom.element === "N" || atom.element === "O");
  let coordinates = atomsFromZmatrixRows(rows);
  for (let pass = 0; pass < 2; pass++) for (let residueNumber = 1; residueNumber <= codes.length; residueNumber++) {
    if ("AGP".includes(codes[residueNumber - 1])) continue;
    const member = atoms.flatMap((atom, index) => atom.residueNumber === residueNumber ? [index] : []);
    const cb = member.find(index => atoms[index].name === "CB")!, ca = member.find(index => atoms[index].name === "CA")!;
    const chi1 = member.filter(index => rows[index].refs[0] === cb && rows[index].refs[1] === ca);
    const gamma = chi1.find(g => atoms[g].element !== "H" && member.some(index => rows[index].refs[0] === g && atoms[index].element !== "H"));
    const chi2 = gamma === undefined ? [] : member.filter(index => rows[index].refs[0] === gamma && rows[index].refs[1] === cb);
    const planar = bonds.some(bond => bond.order === 2 && (bond.a === gamma || bond.b === gamma));
    const moving = member.filter(index => !fixed[index]);
    const close = moving.map(start => {
      const seen = new Set([start]); let shell = [start];
      for (let depth = 0; depth < 3; depth++) { shell = shell.flatMap(index => linked[index]).filter(index => !seen.has(index)); shell.forEach(index => seen.add(index)); }
      return seen;
    });
    const base = [...chi1, ...chi2].map(index => rows[index].values[2]);
    const apply = ([turn1, turn2]: number[]) => [...chi1, ...chi2].forEach((index, i) => { rows[index].values[2] = wrap(base[i] + (i < chi1.length ? turn1 : turn2)); });
    const overlap = (positions: typeof coordinates) => moving.reduce((total, a, k) => total + atoms.reduce((sum, atom, b) => {
      if (close[k].has(b) || (polar[a] && heavyPolar[b]) || (heavyPolar[a] && polar[b]) || (atom.residueNumber === 1 && /^H[23]?$/.test(atom.name))) return sum;
      const excess = radius[atoms[a].element] + radius[atom.element] - Math.hypot(...positions[a].position.map((value, i) => value - positions[b].position[i])) - 0.4;
      return excess > 0 ? sum + excess * (fixed[b] ? 10 : 1) : sum;
    }, 0), 0);
    let best = { turns: [0, 0], score: overlap(coordinates), positions: coordinates };
    if (best.score === 0) continue;
    for (const turn1 of [0, 120, -120]) for (const turn2 of chi2.length ? planar ? [0, 180] : [0, 120, -120] : [0]) {
      if (!turn1 && !turn2) continue;
      apply([turn1, turn2]);
      const positions = atomsFromZmatrixRows(rows), score = overlap(positions);
      if (score < best.score - 1e-9) best = { turns: [turn1, turn2], score, positions };
    }
    apply(best.turns); coordinates = best.positions;
  }
  for (const [index, atom] of atoms.entries()) atom.position = coordinates[index].position;
  {
    // Upstream's fixed terminal H torsions can put two protons 0.05 Å apart.
    // Complete the sp3 N around its unchanged heavy-atom bonds; a neutral amine
    // leaves its lone pair on the most crowded tetrahedral site.
    const n = atoms[0], neighbours = bonds.filter(bond => bond.a === 0 || bond.b === 0).map(bond => bond.a === 0 ? bond.b : bond.a);
    const hydrogen = neighbours.filter(index => atoms[index].element === "H"), heavy = neighbours.filter(index => atoms[index].element !== "H").map(index => atoms[index]);
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    const unit = (a: number[]) => { const length = Math.hypot(...a); return a.map(value => value / length); };
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const u = unit(heavy[0].position.map((value, i) => value - n.position[i]));
    const initial = atoms[hydrogen[0]].position.map((value, i) => value - n.position[i]);
    let sites: number[][];
    if (heavy.length === 1) {
      const v = unit(initial.map((value, i) => value - dot(initial, u) * u[i])), w = cross(u, v);
      sites = [0, 1, 2].map(index => {
        const phase = index * 2 * Math.PI / 3 * (stereos[0] === "D" ? -1 : 1);
        return n.position.map((value, i) => value + 1.009 * (-u[i] / 3 + Math.sqrt(8 / 9) * (Math.cos(phase) * v[i] + Math.sin(phase) * w[i])));
      });
    } else {
      const v = unit(heavy[1].position.map((value, i) => value - n.position[i]));
      const sum = u.map((value, i) => value + v[i]), bisector = unit(sum), normal = unit(cross(u, v));
      const along = -2 / (3 * Math.hypot(...sum)), across = Math.sqrt(1 - along * along) * (dot(initial, normal) < 0 ? -1 : 1);
      sites = [across, -across].map(side => n.position.map((value, i) => value + 1.009 * (along * bisector[i] + side * normal[i])));
    }
    const clearance = (site: number[]) => Math.min(...atoms.filter((_, index) => index && !neighbours.includes(index)).map(atom => Math.hypot(...atom.position.map((value, i) => value - site[i]))));
    const crowded = sites.length > hydrogen.length ? sites.indexOf(sites.reduce((worst, site) => clearance(site) < clearance(worst) ? site : worst)) : -1;
    sites.filter((_, index) => index !== crowded).forEach((site, index) => { atoms[hydrogen[index]].position = site; });
  }
  // Rows follow the Chemical Component Dictionary: heavy atoms, then N–H, then other H.
  const rank = atoms.map((atom, index) => atom.residueNumber * 8192 + (atom.element === "H" ? 1024 * (["H", "H2", "H3"].indexOf(atom.name) + 1 || 4) : 0) + index);
  const order = atoms.map((_, index) => index).sort((a, b) => rank[a] - rank[b]);
  const moved = new Map(order.map((source, index) => [source, index]));
  return { atoms: order.map(index => atoms[index]), bonds: bonds.map(bond => ({ ...bond, a: moved.get(bond.a)!, b: moved.get(bond.b)! })), chirality: stereos };
}
