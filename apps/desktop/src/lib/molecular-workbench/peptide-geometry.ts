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
export const PEPTIDE_BACKBONE_PRESETS = {
  extended: { phi: 180, psi: 180 }, alpha: { phi: -60, psi: -40 },
  beta: { phi: -135, psi: 135 }, helix310: { phi: -74, psi: -4 }, pi: { phi: -57, psi: -70 },
} as const;

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
    const first = residueIndex === 0, last = residueIndex === codes.length - 1;
    for (const [templateIndex, values] of template.atoms.entries()) {
      const [element, name] = values as [string, string, ...number[]];
      if ((!last && (name === "OXT" || name === "HXT")) || (last && name === "HXT" && cTerminus === "carboxylate") || (!first && code === "P" && name === "H")) continue;
      const index = atoms.length;
      indices.set(templateIndex + 1, index); names.set(name, index);
      const arity = Math.min(index, 3), refs = (values.slice(5) as number[]).slice(0, arity).map(ref => indices.get(ref)!);
      const coordinates = (values.slice(2, 5) as number[]).slice(0, arity);
      if (arity === 3 && stereos[residueIndex] === "D") coordinates[2] *= -1;
      if (previous) {
        if (name === "N") { refs.splice(0, 3, previous.get("C")!, previous.get("CA")!, previous.get("N")!); coordinates.splice(0, 3, 1.329, 116.2, psi); }
        else if (name === "CA") { refs.splice(0, 3, names.get("N")!, previous.get("C")!, previous.get("CA")!); coordinates[1] = 121.7; coordinates[2] = 180; }
        else if (name === "C") { refs.splice(0, 3, names.get("CA")!, names.get("N")!, previous.get("C")!); coordinates[2] = phi; }
        else if (name === "H") { coordinates[1] = 120; coordinates[2] = phi + 180 + 5 * Math.sin(psi * Math.PI / 180); }
      }
      if (coordinates.length === 3) coordinates[2] = ((coordinates[2] + 180) % 360 + 360) % 360 - 180;
      rows.push({ element, refs, values: coordinates });
      atoms.push({ element, name, residue: template.name, residueNumber: residueIndex + 1, chain, charge: last && name === "OXT" && cTerminus === "carboxylate" ? -1 : first && name === "N" && nTerminus === "ammonium" ? 1 : 0, position: [] });
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
        bonds.push({ a: n, b: atoms.length, order: 1 });
        atoms.push({ element: "H", name, residue: template.name, residueNumber: 1, chain, charge: 0, position: [] });
        rows.push({ element: "H", refs: [n, names.get("CA")!, names.get("C")!], values: [1.009, nTerminus === "amine" ? 120 : 109.5, nTerminus === "amine" ? 175 : name === "H2" ? 120 : 60] });
      }
    }
    if (previous) {
      bonds.push({ a: previous.get("C")!, b: names.get("N")!, order: 1 });
      rows[previous.get("O")!].values[2] = ((psi + 360) % 360) - 180;
    }
    previous = names;
  }
  if (atoms.length > 256) throw new Error("The peptide exceeds the browser limit of 256 atoms including hydrogens.");
  const valence = atoms.map(() => 0);
  for (const bond of bonds) { valence[bond.a] += bond.order; valence[bond.b] += bond.order; }
  for (const [index, atom] of atoms.entries()) if (atom.element === "N" && !atom.charge && valence[index] === 4) atom.charge = 1;
  const coordinates = atomsFromZmatrixRows(rows);
  for (const [index, atom] of atoms.entries()) atom.position = coordinates[index].position;
  if (nTerminus === "ammonium") {
    // Upstream's fixed H/H2/H3 torsions can put two protons 0.05 Å apart.
    // Complete the N tetrahedron around its unchanged heavy-atom bonds.
    const n = atoms[0], neighbours = bonds.filter(bond => bond.a === 0 || bond.b === 0).map(bond => atoms[bond.a === 0 ? bond.b : bond.a]);
    const hydrogen = neighbours.filter(atom => atom.element === "H"), heavy = neighbours.filter(atom => atom.element !== "H");
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    const unit = (a: number[]) => { const length = Math.hypot(...a); return a.map(value => value / length); };
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const u = unit(heavy[0].position.map((value, i) => value - n.position[i]));
    const initial = hydrogen[0].position.map((value, i) => value - n.position[i]);
    if (heavy.length === 1) {
      const v = unit(initial.map((value, i) => value - dot(initial, u) * u[i])), w = cross(u, v);
      hydrogen.forEach((atom, index) => {
        const phase = index * 2 * Math.PI / 3 * (stereos[0] === "D" ? -1 : 1);
        atom.position = n.position.map((value, i) => value + 1.009 * (-u[i] / 3 + Math.sqrt(8 / 9) * (Math.cos(phase) * v[i] + Math.sin(phase) * w[i])));
      });
    } else {
      const v = unit(heavy[1].position.map((value, i) => value - n.position[i]));
      const sum = u.map((value, i) => value + v[i]), bisector = unit(sum), normal = unit(cross(u, v));
      const along = -2 / (3 * Math.hypot(...sum)), across = Math.sqrt(1 - along * along) * (dot(initial, normal) < 0 ? -1 : 1);
      hydrogen.forEach((atom, index) => { atom.position = n.position.map((value, i) => value + 1.009 * (along * bisector[i] + (index === 0 ? across : -across) * normal[i])); });
    }
  }
  return { atoms, bonds, chirality: stereos };
}
