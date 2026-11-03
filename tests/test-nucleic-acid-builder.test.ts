import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Molecule } from "openchemlib";
import {
  buildNucleicAcid, NUCLEIC_ACID_MAX_LENGTH, nucleicAcidAtomCount, nucleicAcidFileStem, nucleicAcidMmcif, nucleicFormUnavailable, parseNucleicSequence, reverseComplement,
  type HelixForm, type NucleicAcidModel, type NucleicAcidOptions, type NucleicAtom,
} from "../apps/desktop/src/lib/molecular-workbench/nucleic";

// The builder is checked against references it does not use (tests/fixtures/nucleic/README.md):
// wwPDB CCD components for names, bonds, bond lengths and configurations; RDKit sequence
// molecules for formula, charge and the full stereo graph; Open-Source PyMOL fnab builds for
// the A and B forms; PDB 1BNA, 1RNA, 1DCG and 2F8W for crystal geometry; MDAnalysis numbers
// for torsions and puckers; Mol* and OpenChemLib for reading the result back.
const require = createRequire(import.meta.url);
const { CIF } = require("molstar/lib/commonjs/mol-io/reader/cif.js");
const { trajectoryFromMmCIF } = require("molstar/lib/commonjs/mol-model-formats/structure/mmcif.js");
const { Structure, StructureProperties, StructureElement } = require("molstar/lib/commonjs/mol-model/structure.js");

const fixture = (name: string) => readFileSync(new URL(`./fixtures/nucleic/${name}`, import.meta.url), "utf8");
type Vec = [number, number, number];
const v = (atom: { x: number; y: number; z: number }): Vec => [atom.x, atom.y, atom.z];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec) => Math.hypot(...a);
const distance = (a: Vec, b: Vec) => norm(sub(a, b));
const volume = (c: Vec, a: Vec, b: Vec, d: Vec) => dot(cross(sub(a, c), sub(b, c)), sub(d, c));
const angle = (a: Vec, b: Vec, c: Vec) => Math.acos(dot(sub(a, b), sub(c, b)) / norm(sub(a, b)) / norm(sub(c, b))) * 180 / Math.PI;
const angularGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
function dihedral(p0: Vec, p1: Vec, p2: Vec, p3: Vec) {
  const b0 = sub(p0, p1), b1 = sub(p2, p1), b2 = sub(p3, p2);
  const u = b1.map((x) => x / norm(b1)) as Vec;
  const w0 = sub(b0, u.map((x) => x * dot(b0, u)) as Vec), w2 = sub(b2, u.map((x) => x * dot(b2, u)) as Vec);
  return Math.atan2(dot(cross(u, w0), w2), dot(w0, w2)) * 180 / Math.PI;
}
const centre = (points: Vec[]) => points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length, sum[2] + p[2] / points.length] as Vec, [0, 0, 0] as Vec);
/** Least-squares superposition a -> b (Horn's quaternion method, Jacobi eigen-solver). */
function superpose(a: Vec[], b: Vec[]) {
  const ca = centre(a), cb = centre(b);
  const p = a.map((x) => sub(x, ca)), q = b.map((x) => sub(x, cb));
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = [0, 1, 2].map((i) => [0, 1, 2].map((j) => p.reduce((sum, x, k) => sum + x[i] * q[k][j], 0)));
  const m = [[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz], [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
  const vectors = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 100; sweep++) {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      if (Math.abs(m[i][j]) < 1e-12) continue;
      const theta = (m[j][j] - m[i][i]) / (2 * m[i][j]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)), c = 1 / Math.sqrt(t * t + 1), sn = t * c;
      for (const rows of [m, vectors]) for (let k = 0; k < 4; k++) { const ki = rows[k][i], kj = rows[k][j]; rows[k][i] = c * ki - sn * kj; rows[k][j] = sn * ki + c * kj; }
      for (let k = 0; k < 4; k++) { const ik = m[i][k], jk = m[j][k]; m[i][k] = c * ik - sn * jk; m[j][k] = sn * ik + c * jk; }
    }
  }
  const best = [0, 1, 2, 3].reduce((top, k) => (m[k][k] > m[top][top] ? k : top), 0);
  const [w, x, y, z] = vectors.map((row) => row[best]);
  const rotation = [[w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z]];
  const total = p.reduce((sum, point) => sum + dot(point, point), 0) + q.reduce((sum, point) => sum + dot(point, point), 0);
  const rotated = rotation.map((row) => row[0] * ca[0] + row[1] * ca[1] + row[2] * ca[2]);
  return { rmsd: Math.sqrt(Math.max(0, (total - 2 * m[best][best]) / a.length)), rotation, translation: sub(cb, rotated as Vec) };
}
/** Twist (degrees, negative = left-handed) and rise of the screw that superposes a onto b. */
function screw(a: Vec[], b: Vec[]) {
  const { rotation: r, translation } = superpose(a, b);
  const turn = Math.acos(Math.min(1, Math.max(-1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2))) * 180 / Math.PI;
  const axis: Vec = [r[2][1] - r[1][2], r[0][2] - r[2][0], r[1][0] - r[0][1]];
  const shift = dot(translation, axis) / norm(axis);
  return { twist: Math.sign(shift) * turn, rise: Math.abs(shift) };
}

// --- wwPDB CCD reference components ---------------------------------------------------
type CcdAtom = { name: string; element: string; ideal: Vec; stereo: string };
type Ccd = { atoms: Map<string, CcdAtom>; bonds: Map<string, number> };
const tokens = (line: string) => [...line.matchAll(/"([^"]*)"|(\S+)/gu)].map((match) => match[1] ?? match[2]);
const bondKey = (a: string, b: string) => [a, b].sort().join("-");
function readCcd(id: string): Ccd {
  const lines = fixture(`ccd/${id}.cif`).split("\n");
  const loop = (category: string) => {
    const start = lines.findIndex((line) => line.startsWith(`${category}.`));
    let end = start;
    while (lines[end].startsWith(`${category}.`)) end++;
    const fields = lines.slice(start, end).map((line) => line.trim().slice(category.length + 1));
    const rows: Record<string, string>[] = [];
    for (let i = end; lines[i].trim() !== "#"; i++) rows.push(Object.fromEntries(tokens(lines[i]).map((value, k) => [fields[k], value])));
    return rows;
  };
  const atoms = new Map(loop("_chem_comp_atom").map((row) => [row.atom_id, {
    name: row.atom_id, element: row.type_symbol, stereo: row.pdbx_stereo_config,
    ideal: [Number(row.pdbx_model_Cartn_x_ideal), Number(row.pdbx_model_Cartn_y_ideal), Number(row.pdbx_model_Cartn_z_ideal)] as Vec,
  }]));
  const bonds = new Map(loop("_chem_comp_bond").map((row) => [bondKey(row.atom_id_1, row.atom_id_2), row.value_order === "DOUB" ? 2 : 1]));
  return { atoms, bonds };
}
const CCD = Object.fromEntries(["DA", "DC", "DG", "DT", "A", "C", "G", "U"].map((id) => [id, readCcd(id)]));

// --- residues of a model or a reference PDB file, and their measured geometry --------------
type Residue = { chain: string; seq: number; name: string; atoms: Map<string, Vec>; indices: Map<string, number> };
type Residues = Map<string, Residue>;
function modelResidues(model: NucleicAcidModel): Residues {
  const map: Residues = new Map();
  model.atoms.forEach((atom, index) => {
    const key = `${atom.chain}${atom.seq}`;
    if (!map.has(key)) map.set(key, { chain: atom.chain, seq: atom.seq, name: atom.residue, atoms: new Map(), indices: new Map() });
    map.get(key)!.atoms.set(atom.name, v(atom));
    map.get(key)!.indices.set(atom.name, index);
  });
  return map;
}
/** PDB ATOM records; `renumber` maps a chain to the residue number that becomes 1. */
function pdbResidues(text: string, renumber: Record<string, number> = {}): Residues {
  const map: Residues = new Map();
  for (const line of text.split("\n").filter((row) => row.startsWith("ATOM"))) {
    const chain = line[21], seq = Number(line.slice(22, 26)) - (renumber[chain] ?? 1) + 1, key = `${chain}${seq}`;
    if (!map.has(key)) map.set(key, { chain, seq, name: line.slice(17, 20).trim(), atoms: new Map(), indices: new Map() });
    map.get(key)!.atoms.set(line.slice(12, 16).trim(), [Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54))]);
  }
  return map;
}
const isPurine = (residue: Residue) => residue.atoms.has("N9");
const SUGAR = ["C1'", "C2'", "C3'", "C4'", "O4'"];
const PAIRS: Record<string, [string, string][]> = { AT: [["N6", "O4"], ["N1", "N3"]], AU: [["N6", "O4"], ["N1", "N3"]], GC: [["O6", "N4"], ["N1", "N3"], ["N2", "O2"]] };
type Torsions = Partial<Record<"alpha" | "beta" | "gamma" | "delta" | "epsilon" | "zeta" | "chi" | "phase", number>>;
function torsions(residues: Residues, residue: Residue): Torsions {
  const at = (name: string) => residue.atoms.get(name)!;
  const previous = residues.get(`${residue.chain}${residue.seq - 1}`)?.atoms, next = residues.get(`${residue.chain}${residue.seq + 1}`)?.atoms;
  const nu = [["C4'", "O4'", "C1'", "C2'"], ["O4'", "C1'", "C2'", "C3'"], ["C1'", "C2'", "C3'", "C4'"], ["C2'", "C3'", "C4'", "O4'"], ["C3'", "C4'", "O4'", "C1'"]]
    .map((names) => dihedral(...(names.map(at) as [Vec, Vec, Vec, Vec])));
  // Pseudorotation phase from all five ring torsions, starting at nu2 (Altona & Sundaralingam 1972, Fourier form as in MDAnalysis phase_as).
  const ring = [nu[2], nu[3], nu[4], nu[0], nu[1]];
  const phase = Math.atan2(-0.4 * ring.reduce((sum, value, k) => sum + value * Math.sin(4 * Math.PI * k / 5), 0), 0.4 * ring.reduce((sum, value, k) => sum + value * Math.cos(4 * Math.PI * k / 5), 0)) * 180 / Math.PI;
  const result: Torsions = {
    beta: residue.atoms.has("P") ? dihedral(at("P"), at("O5'"), at("C5'"), at("C4'")) : undefined,
    gamma: dihedral(at("O5'"), at("C5'"), at("C4'"), at("C3'")), delta: dihedral(at("C5'"), at("C4'"), at("C3'"), at("O3'")),
    chi: isPurine(residue) ? dihedral(at("O4'"), at("C1'"), at("N9"), at("C4")) : dihedral(at("O4'"), at("C1'"), at("N1"), at("C2")), phase: (phase + 360) % 360,
  };
  if (previous && residue.atoms.has("P")) result.alpha = dihedral(previous.get("O3'")!, at("P"), at("O5'"), at("C5'"));
  if (next?.has("P")) { result.epsilon = dihedral(at("C4'"), at("C3'"), at("O3'"), next.get("P")!); result.zeta = dihedral(at("C3'"), at("O3'"), next.get("P")!, next.get("O5'")!); }
  if (result.beta === undefined) delete result.beta;
  return result;
}
function chains(residues: Residues) {
  const map = new Map<string, Residue[]>();
  for (const residue of [...residues.values()].sort((a, b) => a.seq - b.seq)) map.set(residue.chain, [...(map.get(residue.chain) ?? []), residue]);
  return map;
}
/** Screw of each repeat (1 nucleotide; 2 for Z) onto the next along every strand, by sugar rings. */
function steps(residues: Residues, repeat: number) {
  return [...chains(residues).values()].flatMap((strand) => {
    const units = Array.from({ length: Math.floor(strand.length / repeat) }, (_, k) => strand.slice(k * repeat, k * repeat + repeat).flatMap((residue) => SUGAR.map((name) => residue.atoms.get(name)!)));
    return units.slice(1).map((unit, k) => screw(units[k], unit));
  });
}
/** Watson-Crick donor-acceptor distances of chain A residue i with chain B residue n + 1 - i. */
function pairs(residues: Residues) {
  const [a, b] = [...chains(residues).values()];
  return a.map((first, i) => {
    const second = b[b.length - 1 - i];
    const codes = [first.name.at(-1)!, second.name.at(-1)!].join("");
    const key = PAIRS[codes] ? codes : [...codes].reverse().join("");
    const [purine, pyrimidine] = key === codes ? [first, second] : [second, first];
    return { pair: key, hbonds: Object.fromEntries(PAIRS[key].map(([x, y]) => [`${x}-${y}`, distance(purine.atoms.get(x)!, pyrimidine.atoms.get(y)!)])), c1c1: distance(first.atoms.get("C1'")!, second.atoms.get("C1'")!) };
  });
}
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const circularMean = (values: number[]) => Math.atan2(mean(values.map((x) => Math.sin(x * Math.PI / 180))), mean(values.map((x) => Math.cos(x * Math.PI / 180)))) * 180 / Math.PI;

type ReferenceStructure = { nucleotides: ({ chain: string; resid: number; resname: string } & Torsions)[]; pairs: { a: number; b: number; pair: string; hbonds: Record<string, number>; c1c1: number }[]; steps: { twist: number; rise: number }[] };
const REFERENCE: { structures: Record<string, ReferenceStructure> } = JSON.parse(fixture("reference-geometry.json"));
const RDKIT: { cases: { type: "DNA" | "RNA"; fivePrime: "hydroxyl" | "phosphate"; strands: "single" | "double"; sequence: string; formula: string; charge: number; atoms: number; smiles: string }[] } = JSON.parse(fixture("rdkit-references.json"));

const build = (sequence: string, options: Partial<NucleicAcidOptions> = {}) =>
  buildNucleicAcid(sequence, { type: "DNA", form: "B", strands: "single", fivePrime: "hydroxyl", ...options });
const FORMS: [NucleicAcidOptions["type"], HelixForm][] = [["DNA", "B"], ["DNA", "A"], ["DNA", "Z"], ["RNA", "A"]];
const COMBINATIONS: NucleicAcidOptions[] = (["single", "double"] as const).flatMap((strands) => (["hydroxyl", "phosphate"] as const).flatMap((fivePrime) =>
  FORMS.map(([type, form]) => ({ type, form, strands, fivePrime }))));
/** A sequence the form accepts with every base: alternating pyrimidines and purines for Z. */
const sample = ({ type, form }: Pick<NucleicAcidOptions, "type" | "form">) => (form === "Z" ? "CGTACATG" : type === "DNA" ? "GACTGACT" : "GACUGACU");
// Order-3 de Bruijn sequence: every trinucleotide occurs, so every nearest and next-nearest
// neighbour contact of a helix appears at least once. For Z, an alternating sequence in which
// every pyrimidine-purine-pyrimidine and purine-pyrimidine-purine triple occurs.
function contexts({ type, form }: Pick<NucleicAcidOptions, "type" | "form">) {
  if (form === "Z") return "CACGTGTATGCATACGCGTACATGTG";
  const alphabet = type === "DNA" ? "ACGT" : "ACGU";
  const a = Array(8).fill(0), out: number[] = [];
  const db = (t: number, p: number) => {
    if (t > 3) { if (3 % p === 0) out.push(...a.slice(1, p + 1)); return; }
    a[t] = a[t - p]; db(t + 1, p);
    for (let j = a[t - p] + 1; j < 4; j++) { a[t] = j; db(t + 1, t); }
  };
  db(1, 1);
  const cyclic = out.map((i) => alphabet[i]).join("");
  return cyclic + cyclic.slice(0, 2);
}

test("sequences are canonical, bounded and validated for the chosen helix before any work", () => {
  const dna = { type: "DNA", form: "B" } as const, rna = { type: "RNA", form: "A" } as const, z = { type: "DNA", form: "Z" } as const;
  expect(parseNucleicSequence(" acg t\nAC ", dna)).toBe("ACGTAC");
  expect(parseNucleicSequence("acgu", rna)).toBe("ACGU");
  expect(() => parseNucleicSequence("   ", dna)).toThrow("Enter a sequence.");
  expect(() => parseNucleicSequence("ACGN", dna)).toThrow("Use only A, C, G and T.");
  expect(() => parseNucleicSequence("ACGX", rna)).toThrow("Use only A, C, G and U.");
  expect(() => parseNucleicSequence("ACGU", dna)).toThrow("U is an RNA base");
  expect(() => parseNucleicSequence("ACGT", rna)).toThrow("T is a DNA base");
  expect(parseNucleicSequence("A".repeat(NUCLEIC_ACID_MAX_LENGTH), dna)).toHaveLength(500);
  expect(() => parseNucleicSequence("A".repeat(NUCLEIC_ACID_MAX_LENGTH + 1), dna)).toThrow("at most 500 nucleotides");
  // Z-DNA: strictly alternating pyrimidine/purine, either phase, any of the four bases.
  for (const sequence of ["CGCGCG", "GCGC", "CACACA", "TGTG", "CGTACG", "C", "G"]) expect(parseNucleicSequence(sequence, z)).toBe(sequence);
  expect(() => parseNucleicSequence("CGGC", z)).toThrow("Z-DNA needs alternating pyrimidines and purines, such as CGCG or CACA. Nucleotides 2 and 3 are both purines.");
  expect(() => parseNucleicSequence("CGTTAG", z)).toThrow("Nucleotides 3 and 4 are both pyrimidines.");
  expect(nucleicFormUnavailable("DNA", "Z")).toBeNull();
  expect(nucleicFormUnavailable("RNA", "B")).toBe("RNA is built only as an A-form helix.");
  expect(nucleicFormUnavailable("RNA", "Z")).toBe("Z-form is built only for DNA.");
  expect(() => build("ACGU", { type: "RNA", form: "B" })).toThrow("RNA is built only as an A-form helix.");
  expect(() => build("CGCG", { type: "RNA", form: "Z" })).toThrow("Z-form is built only for DNA.");
  expect(() => build("ACGT", { form: "C" as never })).toThrow("Choose an A-, B- or Z-form helix.");
  expect(() => build("ACGT", { strands: "triple" as never })).toThrow("Choose one or two strands.");
  expect(() => build("ACGT", { fivePrime: "triphosphate" as never })).toThrow("Unsupported 5' end.");
  expect(reverseComplement("AACGTT", "DNA")).toBe("AACGTT");
  expect(reverseComplement("GATTACA", "DNA")).toBe("TGTAATC");
  expect(reverseComplement("GAUUACA", "RNA")).toBe("UGUAAUC");
  expect(nucleicAcidFileStem("ACGT", { type: "DNA", form: "B", strands: "double", fivePrime: "hydroxyl" })).toBe("ACGT-B-DNA-duplex-ideal");
  expect(nucleicAcidFileStem("CGCGCGCGCGCGCG", { type: "DNA", form: "Z", strands: "double", fivePrime: "hydroxyl" })).toBe("CGCGCGCGCGCG-14nt-Z-DNA-duplex-ideal");
});

test("every residue in every form has the atoms, elements, charges and bonds of its CCD component, linked O3'-P", () => {
  for (const options of COMBINATIONS.filter((item) => item.strands === "double")) {
    const model = buildNucleicAcid(sample(options), options);
    const residues = modelResidues(model);
    for (const residue of residues.values()) {
      const ccd = CCD[residue.name];
      // Phosphates are ionised (HOP2/HOP3 removed, OP2/OP3 -1); leaving atoms go where residues link.
      const expected = new Set([...ccd.atoms.keys()].filter((name) => !["HOP2", "HOP3", "OP3", "HO3'"].includes(name)));
      if (residue.seq === 1 && options.fivePrime === "phosphate") expected.add("OP3");
      if (residue.seq === 1 && options.fivePrime === "hydroxyl") { ["P", "OP1", "OP2"].forEach((name) => expected.delete(name)); expected.add("HO5'"); }
      if (residue.seq === 8) expected.add("HO3'");
      expect([residue.chain, residue.seq, [...residue.atoms.keys()].sort()]).toEqual([residue.chain, residue.seq, [...expected].sort()]);
      for (const [name, index] of residue.indices) {
        const atom = model.atoms[index];
        expect([name, atom.element, atom.charge]).toEqual([name, name === "HO5'" ? "H" : ccd.atoms.get(name)!.element, name === "OP2" || name === "OP3" ? -1 : 0]);
      }
      const own = new Set(residue.indices.values());
      const bonds = new Map(model.bonds.filter((bond) => own.has(bond.a) && own.has(bond.b)).map((bond) => [bondKey(model.atoms[bond.a].name, model.atoms[bond.b].name), bond.order]));
      const reference = new Map([...ccd.bonds].filter(([key]) => key.split("-").every((name) => residue.atoms.has(name))));
      if (residue.atoms.has("HO5'")) reference.set(bondKey("O5'", "HO5'"), 1);
      expect(bonds).toEqual(reference);
    }
    const links = model.bonds.filter((bond) => model.atoms[bond.a].seq !== model.atoms[bond.b].seq || model.atoms[bond.a].chain !== model.atoms[bond.b].chain);
    expect(links.map((bond) => [model.atoms[bond.a].chain, model.atoms[bond.a].seq, model.atoms[bond.a].name, model.atoms[bond.b].chain, model.atoms[bond.b].seq, model.atoms[bond.b].name, bond.order]))
      .toEqual(["A", "B"].flatMap((chain) => Array.from({ length: 7 }, (_, i) => [chain, i + 1, "O3'", chain, i + 2, "P", 1])));
  }
});

test("formula, charge, atom count and the full stereo graph equal RDKit's sequence molecules", () => {
  const ATOMIC: Record<string, number> = { H: 1, C: 6, N: 7, O: 8, P: 15 };
  const hill = (model: NucleicAcidModel) => {
    const counts = new Map<string, number>();
    for (const atom of model.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
    return ["C", "H", ...[...counts.keys()].filter((element) => element !== "C" && element !== "H").sort()].map((element) => `${element}${counts.get(element) === 1 ? "" : counts.get(element)}`).join("");
  };
  let checked = 0;
  for (const reference of RDKIT.cases) {
    const forms: HelixForm[] = reference.type === "RNA" ? ["A"] : reference.sequence === "CACGTG" ? ["Z", "B", "A"] : ["B", "A"];
    for (const form of forms) {
      const options: NucleicAcidOptions = { type: reference.type, form, strands: reference.strands, fivePrime: reference.fivePrime };
      const model = buildNucleicAcid(reference.sequence, options);
      expect([hill(model), model.charge, model.atoms.length, nucleicAcidAtomCount(reference.sequence, options)])
        .toEqual([reference.formula.replace(/[+-]\d*$/u, ""), reference.charge, reference.atoms, reference.atoms]);
      // Heavy-atom graph with formal charges; absolute configuration perceived by OpenChemLib from our
      // coordinates. Phosphorus has no configuration: its free oxygens are equivalent by resonance.
      const heavy = model.atoms.flatMap((atom, index) => (atom.element === "H" ? [] : [index]));
      const map = new Map(heavy.map((index, k) => [index, k]));
      const molecule = new Molecule(heavy.length, model.bonds.length);
      for (const index of heavy) {
        const atom = model.atoms[index], k = molecule.addAtom(ATOMIC[atom.element]);
        molecule.setAtomX(k, atom.x); molecule.setAtomY(k, atom.y); molecule.setAtomZ(k, atom.z); molecule.setAtomCharge(k, atom.charge);
      }
      for (const bond of model.bonds) if (map.has(bond.a) && map.has(bond.b)) molecule.setBondType(molecule.addBond(map.get(bond.a)!, map.get(bond.b)!), bond.order === 2 ? Molecule.cBondTypeDouble : Molecule.cBondTypeSingle);
      molecule.ensureHelperArrays(Molecule.cHelperParities);
      for (let k = 0; k < molecule.getAllAtoms(); k++) if (molecule.getAtomicNo(k) === 15) molecule.setAtomParity(k, Molecule.cAtomParityNone, false);
      expect([form, Molecule.fromSmiles(molecule.toIsomericSmiles()).getIDCode()]).toEqual([form, Molecule.fromSmiles(reference.smiles).getIDCode()]);
      checked++;
    }
  }
  expect(checked).toBe(24);
});

test("bond lengths and hydrogen geometry match the CCD ideal components; O3'-P links are 1.60-1.62 A", () => {
  for (const options of COMBINATIONS.filter((item) => item.fivePrime === "phosphate")) {
    let worst = 0;
    const model = buildNucleicAcid(sample(options), options);
    const neighbours = model.atoms.map(() => [] as number[]);
    for (const bond of model.bonds) {
      neighbours[bond.a].push(bond.b); neighbours[bond.b].push(bond.a);
      const a = model.atoms[bond.a], b = model.atoms[bond.b];
      const length = distance(v(a), v(b));
      // fnab links measure 1.601 A; the Z-I CpG and GpC links of 4OCB 1.62 and 1.60 A.
      if (a.seq !== b.seq) { expect(length).toBeGreaterThan(1.595); expect(length).toBeLessThan(1.625); continue; }
      if (a.element === "H" || b.element === "H") {
        const heavy = a.element === "H" ? b : a;
        expect(length).toBeCloseTo({ O: 0.97, N: 1.01, C: heavy.name === "C7" || heavy.name.endsWith("'") ? 1.09 : 1.08 }[heavy.element]!, 6);
        continue;
      }
      const ccd = CCD[a.residue].atoms;
      // The CCD component is the neutral acid (P-OH 1.61 A). A 5' phosphate is the dianion: its three
      // free P-O bonds lie within those of crystalline disodium cytidine 5'-monophosphate (COD 2205273).
      if (a.seq === 1 && [a.name, b.name].some((name) => ["OP1", "OP2", "OP3"].includes(name))) {
        expect(length).toBeGreaterThan(1.516); expect(length).toBeLessThan(1.524); continue;
      }
      // In a phosphodiester OP2 is the anionic, non-bridging oxygen like OP1.
      if ([a.name, b.name].includes("OP2")) { expect(length).toBeGreaterThan(1.46); expect(length).toBeLessThan(1.51); continue; }
      worst = Math.max(worst, Math.abs(length - distance(ccd.get(a.name)!.ideal, ccd.get(b.name)!.ideal)));
    }
    // Fiber-model bases differ from the CCD's generated ideal coordinates by up to 0.056 A (thymine
    // C1'-N1); the 4OCB backbone of the Z form keeps its own 0.75 A crystal bond lengths.
    expect([options.form, worst < 0.06]).toEqual([options.form, true]);
    // Hydrogens: no bond angle at a hydrogen's parent is far from sp2/sp3.
    model.atoms.forEach((atom, index) => {
      if (atom.element !== "H") return;
      const parent = neighbours[index][0];
      expect(neighbours[index]).toHaveLength(1);
      for (const other of neighbours[parent]) if (other !== index) expect(angle(v(atom), v(model.atoms[parent]), v(model.atoms[other]))).toBeGreaterThan(99);
    });
    // OP3 points where the preceding O3' would be: its angles at P are those of the next linkage of the same kind.
    const residues = modelResidues(model);
    for (const chain of options.strands === "double" ? ["A", "B"] : ["A"]) {
      const first = residues.get(`${chain}1`)!.atoms;
      // In Z the residue after a pyrimidine-purine repeat starts the same kind of linkage as residue 1.
      const [linked, second] = options.form === "Z" ? [residues.get(`${chain}2`)!.atoms, residues.get(`${chain}3`)!.atoms] : [first, residues.get(`${chain}2`)!.atoms];
      for (const name of ["O5'", "OP1", "OP2"]) {
        expect(angle(first.get("OP3")!, first.get("P")!, first.get(name)!)).toBeCloseTo(angle(linked.get("O3'")!, second.get("P")!, second.get(name)!), 6);
      }
    }
  }
});

test("sugars keep the beta-D configuration of every CCD component; amino hydrogens keep their CCD names", () => {
  const R = Molecule.cAtomCIPParityRorM, S = Molecule.cAtomCIPParitySorP;
  for (const options of COMBINATIONS.filter((item) => item.strands === "double")) {
    const model = buildNucleicAcid(sample(options), options);
    const heavy = model.atoms.flatMap((atom, index) => (atom.element === "H" ? [] : [index]));
    const map = new Map(heavy.map((index, k) => [index, k]));
    const molecule = new Molecule(heavy.length, model.bonds.length);
    for (const index of heavy) {
      const atom = model.atoms[index], k = molecule.addAtom({ C: 6, N: 7, O: 8, P: 15 }[atom.element]!);
      molecule.setAtomX(k, atom.x); molecule.setAtomY(k, atom.y); molecule.setAtomZ(k, atom.z); molecule.setAtomCharge(k, atom.charge);
    }
    for (const bond of model.bonds) {
      if (map.has(bond.a) && map.has(bond.b)) molecule.setBondType(molecule.addBond(map.get(bond.a)!, map.get(bond.b)!), bond.order === 2 ? Molecule.cBondTypeDouble : Molecule.cBondTypeSingle);
    }
    molecule.ensureHelperArrays(Molecule.cHelperCIP);
    for (const residue of modelResidues(model).values()) {
      const ccd = CCD[residue.name].atoms;
      for (const name of ["C1'", "C2'", "C3'", "C4'"]) {
        const reference = ccd.get(name)!.stereo;
        expect([residue.chain, residue.seq, name, molecule.getAtomCIPParity(map.get(residue.indices.get(name)!)!) ?? 0])
          .toEqual([residue.chain, residue.seq, name, reference === "R" ? R : reference === "S" ? S : 0]);
      }
      // The same centres by signed volume with the CCD's own priority order, hydrogens included.
      const at = (name: string) => residue.atoms.get(name)!;
      expect(volume(at("C1'"), at("O4'"), at(isPurine(residue) ? "N9" : "N1"), at("C2'"))).toBeLessThan(0);
      expect(volume(at("C3'"), at("O3'"), at("C4'"), at("C2'"))).toBeGreaterThan(0);
      expect(volume(at("C4'"), at("O4'"), at("C3'"), at("C5'"))).toBeLessThan(0);
      if (options.type === "RNA") expect(volume(at("C2'"), at("O2'"), at("C1'"), at("C3'"))).toBeLessThan(0);
      for (const [hydrogen, cis, trans] of [["H61", "N1", "C5"], ["H62", "C5", "N1"], ["H41", "N3", "C5"], ["H42", "C5", "N3"], ["H21", "N3", "N1"], ["H22", "N1", "N3"]]) {
        if (!residue.atoms.has(hydrogen)) continue;
        const ideal = (name: string) => ccd.get(name)!.ideal;
        expect(distance(ideal(hydrogen), ideal(cis))).toBeLessThan(distance(ideal(hydrogen), ideal(trans)));
        expect(distance(at(hydrogen), at(cis))).toBeLessThan(distance(at(hydrogen), at(trans)));
      }
    }
  }
});

test("methylene hydrogens are named by IUPAC-IUB 1983: H5' and H2' pro-S, H5'' and H2'' pro-R", () => {
  // OpenChemLib assigns the configuration a centre gets when one of its hydrogens becomes deuterium.
  // Its 3D perception leaves some centres unassigned depending on atom order, so each check runs
  // on the atoms in both orders: every centre must be assigned at least once, and never wrongly.
  const R = Molecule.cAtomCIPParityRorM, S = Molecule.cAtomCIPParitySorP;
  for (const [options, sequence] of COMBINATIONS.filter((item) => item.strands === "double" && item.fivePrime === "phosphate")
    .flatMap((item) => (item.type === "DNA" ? ["AC", "GT"] : ["AC", "GU"]).map((pair) => [item, item.form === "Z" ? [...pair].reverse().join("") : pair] as const))) {
    const model = buildNucleicAcid(sequence, options);
    const last = model.atoms.length - 1;
    const parity = (deuterium: number, center: number, reversed: boolean) => {
      const at = (index: number) => (reversed ? last - index : index);
      const molecule = new Molecule(model.atoms.length, model.bonds.length);
      for (const atom of reversed ? [...model.atoms].reverse() : model.atoms) {
        const k = molecule.addAtom({ H: 1, C: 6, N: 7, O: 8, P: 15 }[atom.element]!);
        molecule.setAtomX(k, atom.x); molecule.setAtomY(k, atom.y); molecule.setAtomZ(k, atom.z); molecule.setAtomCharge(k, atom.charge);
      }
      for (const bond of model.bonds) molecule.setBondType(molecule.addBond(at(bond.a), at(bond.b)), bond.order === 2 ? Molecule.cBondTypeDouble : Molecule.cBondTypeSingle);
      molecule.setAtomMass(at(deuterium), 2);
      molecule.ensureHelperArrays(Molecule.cHelperCIP);
      return molecule.getAtomCIPParity(at(center));
    };
    const checks = [["C5'", "H5'", S], ["C5'", "H5''", R], ...(options.type === "DNA" ? [["C2'", "H2'", S], ["C2'", "H2''", R]] : [])] as [string, string, number][];
    for (const residue of modelResidues(model).values()) {
      for (const [center, hydrogen, expected] of checks) {
        const assigned = [false, true].map((reversed) => parity(residue.indices.get(hydrogen)!, residue.indices.get(center)!, reversed)).filter(Boolean);
        expect([options.form, residue.chain, residue.seq, hydrogen, assigned.length > 0, assigned.every((value) => value === expected)]).toEqual([options.form, residue.chain, residue.seq, hydrogen, true, true]);
      }
    }
  }
});

// --- Independent geometry ------------------------------------------------------------------
const CORES = { "1bna-core": { A: 4, B: 16 }, "1rna-core": { A: 5, B: 19 }, "1dcg-core": { A: 2, B: 8 }, "2f8w-core": { A: 2, B: 8 } } as const;
const referenceResidues = (name: string) => pdbResidues(fixture(`${name}.pdb`), CORES[name as keyof typeof CORES] ?? {});

test("this file's torsion, pucker, screw and pair measurements reproduce the committed MDAnalysis/numpy numbers", () => {
  for (const [name, reference] of Object.entries(REFERENCE.structures)) {
    const residues = pdbResidues(fixture(`${name}.pdb`));
    for (const nucleotide of reference.nucleotides) {
      const ours = torsions(residues, residues.get(`${nucleotide.chain}${nucleotide.resid}`)!);
      for (const key of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "chi", "phase"] as const) {
        if (nucleotide[key] === undefined) continue;
        expect([name, nucleotide.resid, key, angularGap(ours[key]!, nucleotide[key]!) < 0.05]).toEqual([name, nucleotide.resid, key, true]);
      }
    }
    const measured = steps(residues, name.startsWith("1dcg") || name.startsWith("2f8w") ? 2 : 1);
    expect(measured.length).toBe(reference.steps.length);
    measured.forEach((step, i) => expect([name, i, Math.abs(step.twist - reference.steps[i].twist) < 0.01, Math.abs(step.rise - reference.steps[i].rise) < 0.001]).toEqual([name, i, true, true]));
    if (reference.pairs.length) {
      const round = (value: number) => Math.round(value * 1000) / 1000;
      expect(pairs(residues).map(({ pair, hbonds, c1c1 }) => [pair, Object.values(hbonds).map(round), round(c1c1)]))
        .toEqual(reference.pairs.map(({ pair, hbonds, c1c1 }) => [pair, Object.values(hbonds), c1c1]));
    }
  }
});

test("A- and B-form helices reproduce Open-Source PyMOL fnab coordinate for coordinate", () => {
  for (const [file, options] of [
    ["fnab-b-dna", { type: "DNA", form: "B", strands: "double", fivePrime: "phosphate" }],
    ["fnab-a-dna", { type: "DNA", form: "A", strands: "double", fivePrime: "phosphate" }],
    ["fnab-a-rna", { type: "RNA", form: "A", strands: "single", fivePrime: "phosphate" }],
  ] as [string, NucleicAcidOptions][]) {
    const model = buildNucleicAcid(options.type === "DNA" ? "GATTACAGC" : "GAUUACAGC", options);
    const ours = modelResidues(model), reference = pdbResidues(fixture(`${file}.pdb`));
    const shared = [...reference.values()].flatMap((residue) => [...residue.atoms.keys()].map((name) => [name, ours.get(`${residue.chain}${residue.seq}`)!.atoms.get(name)!, residue.atoms.get(name)!] as const));
    expect([shared.length, shared.every(([, own]) => own !== undefined)]).toEqual([[...reference.values()].reduce((sum, residue) => sum + residue.atoms.size, 0), true]);
    // O2' is taken once from PyMOL's uridine fragment; fnab places each base's own, within 0.2 A.
    const rigid = shared.filter(([name]) => name !== "O2'");
    const fit = superpose(rigid.map(([, own]) => own), rigid.map(([, , other]) => other));
    expect([file, fit.rmsd < 0.01]).toEqual([file, true]);
    const placed = (point: Vec) => fit.rotation.map((row, i) => row[0] * point[0] + row[1] * point[1] + row[2] * point[2] + fit.translation[i]) as Vec;
    for (const [, own, other] of shared.filter(([name]) => name === "O2'")) expect(distance(placed(own), other)).toBeLessThan(0.21);
    // The same right-handed screw, backbone torsions, puckers and base pairs as fnab's.
    const expected = REFERENCE.structures[file];
    for (const [own, other] of steps(ours, 1).map((step, i) => [step, expected.steps[i]] as const)) { expect(own.twist).toBeCloseTo(other.twist, 1); expect(own.rise).toBeCloseTo(other.rise, 2); }
    for (const nucleotide of expected.nucleotides) {
      const own = torsions(ours, ours.get(`${nucleotide.chain}${nucleotide.resid}`)!);
      for (const key of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "chi", "phase"] as const) if (nucleotide[key] !== undefined) expect(angularGap(own[key]!, nucleotide[key]!)).toBeLessThan(0.5);
    }
  }
});

test("helices against crystal duplexes: right-handed B and A, left-handed Z with the 1DCG screw", () => {
  const meanStep = (list: { twist: number; rise: number }[]) => ({ twist: mean(list.map((step) => step.twist)), rise: mean(list.map((step) => step.rise)) });
  const duplex = { strands: "double", fivePrime: "phosphate" } as const;
  for (const [core, sequence, options, repeat, twistTolerance, riseTolerance] of [
    ["1bna-core", "GAATTC", { type: "DNA", form: "B" }, 1, 3, 0.15],
    ["1rna-core", "AUAUAU", { type: "RNA", form: "A" }, 1, 3, 0.15],
    ["1dcg-core", "GCGC", { type: "DNA", form: "Z" }, 2, 3, 0.1],
  ] as const) {
    const own = meanStep(steps(modelResidues(buildNucleicAcid(sequence.repeat(2), { ...options, ...duplex })), repeat));
    const crystal = meanStep(REFERENCE.structures[core].steps);
    expect([core, Math.abs(own.twist - crystal.twist) < twistTolerance, Math.abs(own.rise - crystal.rise) < riseTolerance, Math.sign(own.twist)]).toEqual([core, true, true, options.form === "Z" ? -1 : 1]);
  }
  // Z: about 12 base pairs per left-handed turn and 3.7-3.8 A per base pair.
  const z = steps(modelResidues(buildNucleicAcid("CGCGCGCGCGCG", { type: "DNA", form: "Z", ...duplex })), 2);
  expect(z.every((step) => Math.abs(step.twist + 58.06) < 0.01 && Math.abs(step.rise - 7.517) < 0.001)).toBe(true);
  expect(2 * 360 / 58.06).toBeCloseTo(12.4, 1);
  // CA/TG steps of 2F8W are more twisted than CG steps; the template stays within 10 degrees and 0.5 A of them.
  const ca = meanStep(REFERENCE.structures["2f8w-core"].steps);
  expect([Math.abs(ca.twist + 58.06) < 10, Math.abs(ca.rise - 7.517) < 0.5]).toEqual([true, true]);
});

test("Watson-Crick pairs keep crystal-like donor-acceptor distances in every form", () => {
  const crystal = (names: string[]) => names.flatMap((name) => REFERENCE.structures[name].pairs.flatMap((pair) => Object.values(pair.hbonds)));
  const [low, high] = [Math.min(...crystal(["1bna-core", "1rna-core", "1dcg-core", "2f8w-core"])), Math.max(...crystal(["1bna-core", "1rna-core", "1dcg-core", "2f8w-core"]))];
  expect([low > 2.55, high < 3.3]).toEqual([true, true]);
  for (const options of COMBINATIONS.filter((item) => item.strands === "double" && item.fivePrime === "phosphate")) {
    const model = buildNucleicAcid(sample(options), options);
    expect(model.strands).toEqual([{ chain: "A", sequence: sample(options) }, { chain: "B", sequence: reverseComplement(sample(options), options.type) }]);
    for (const { pair, hbonds, c1c1 } of pairs(modelResidues(model))) {
      expect(PAIRS[pair]).toBeDefined();
      for (const value of Object.values(hbonds)) { expect(value).toBeGreaterThan(2.7); expect(value).toBeLessThan(3.0); }
      expect(c1c1).toBeGreaterThan(10.3); expect(c1c1).toBeLessThan(10.9);
    }
  }
});

test("sugar puckers, glycosidic angles and Z backbone torsions follow the crystal structures", () => {
  const duplex = { strands: "double", fivePrime: "phosphate" } as const;
  const north = (phase: number) => phase > 342 || phase < 54, south = (phase: number) => phase > 126 && phase < 198;
  for (const options of COMBINATIONS.filter((item) => item.strands === "double" && item.fivePrime === "phosphate")) {
    const residues = modelResidues(buildNucleicAcid(sample(options), options));
    for (const residue of residues.values()) {
      const { phase, chi } = torsions(residues, residue);
      // B: C2'-endo, anti. A: C3'-endo, anti. Z-I: anti C2'-endo pyrimidines, syn C3'-endo purines.
      const syn = options.form === "Z" && isPurine(residue);
      const sugar = options.form === "B" || (options.form === "Z" && !syn) ? south(phase!) : north(phase!);
      expect([options.form, residue.name, sugar, syn ? chi! > 30 && chi! < 90 : chi! < -90 || chi! > 150]).toEqual([options.form, residue.name, true, true]);
    }
  }
  // Every torsion of the interior nucleotides of a Z duplex lies within 20 degrees of the circular mean
  // of the same nucleotide kind in 1DCG and 2F8W, counting Z-I phosphates only (pyrimidine alpha and
  // purine zeta negative; Z-II steps such as G4pC5 of 1DCG are a different backbone).
  const reference = ["1dcg-core", "2f8w-core"].flatMap((name) => REFERENCE.structures[name].nucleotides)
    .filter((nucleotide) => (["DC", "DT"].includes(nucleotide.resname) ? (nucleotide.alpha ?? -1) < 0 : (nucleotide.zeta ?? -1) < 0));
  for (const sequence of ["CGCGCGCG", "CACGTGCA"]) {
    const residues = modelResidues(buildNucleicAcid(sequence, { type: "DNA", form: "Z", ...duplex }));
    for (const residue of [...residues.values()].filter((item) => item.seq > 1 && item.seq < 8)) {
      const own = torsions(residues, residue);
      const kind = reference.filter((nucleotide) => ["DA", "DG"].includes(nucleotide.resname) === isPurine(residue));
      for (const key of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "chi", "phase"] as const) {
        const values = kind.flatMap((nucleotide) => (nucleotide[key] === undefined ? [] : [nucleotide[key]!]));
        expect([sequence, residue.chain, residue.seq, key, angularGap(own[key]!, circularMean(values)) < 20]).toEqual([sequence, residue.chain, residue.seq, key, true]);
      }
    }
  }
  // A-form RNA against 1RNA in the same way. The Arnott fiber alpha/gamma (-52/+42 degrees) lie 23
  // degrees from 1RNA's means (-75/+64), a correlated crankshaft difference; the rest within 20.
  const rna = REFERENCE.structures["1rna-core"].nucleotides;
  const residues = modelResidues(buildNucleicAcid("AUAUAUAU", { type: "RNA", form: "A", ...duplex }));
  for (const residue of [...residues.values()].filter((item) => item.seq > 1 && item.seq < 8)) {
    const own = torsions(residues, residue);
    for (const key of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "chi", "phase"] as const) {
      const gap = angularGap(own[key]!, circularMean(rna.flatMap((nucleotide) => (nucleotide[key] === undefined ? [] : [nucleotide[key]!]))));
      expect([residue.seq, key, gap < (key === "alpha" || key === "gamma" ? 25 : 20)]).toEqual([residue.seq, key, true]);
    }
  }
});

test("built duplexes superpose on the crystal cores of 1BNA, 1RNA, 1DCG and 2F8W, and the wrong form does not", () => {
  const duplex = { strands: "double", fivePrime: "phosphate" } as const;
  const compare = (model: NucleicAcidModel, core: string) => {
    const ours = modelResidues(model), reference = referenceResidues(core);
    const shared = [...reference.values()].flatMap((residue) => [...residue.atoms].flatMap(([name, position]) => {
      const own = ours.get(`${residue.chain}${residue.seq}`)?.atoms.get(name);
      return own ? [[own, position] as const] : [];
    }));
    return { matched: shared.length, total: [...reference.values()].reduce((sum, residue) => sum + residue.atoms.size, 0), rmsd: superpose(shared.map(([own]) => own), shared.map(([, other]) => other)).rmsd };
  };
  const b = compare(buildNucleicAcid("GAATTC", { type: "DNA", form: "B", ...duplex }), "1bna-core");
  const aOfBna = compare(buildNucleicAcid("GAATTC", { type: "DNA", form: "A", ...duplex }), "1bna-core");
  const rna = compare(buildNucleicAcid("AUAUAU", { type: "RNA", form: "A", ...duplex }), "1rna-core");
  const z = compare(buildNucleicAcid("GCGC", { type: "DNA", form: "Z", ...duplex }), "1dcg-core");
  const bOfZ = compare(buildNucleicAcid("GCGC", { type: "DNA", form: "B", ...duplex }), "1dcg-core");
  const ca = compare(buildNucleicAcid("ACGT", { type: "DNA", form: "Z", ...duplex }), "2f8w-core");
  // Every reference heavy atom has its namesake in the model; OP3 of the 5' ends is extra.
  for (const result of [b, aOfBna, rna, z, bOfZ, ca]) expect(result.matched).toBe(result.total);
  expect(b.rmsd).toBeLessThan(1.1);
  expect(aOfBna.rmsd).toBeGreaterThan(2 * b.rmsd);
  expect(rna.rmsd).toBeLessThan(0.6);
  expect(z.rmsd).toBeLessThan(0.9);
  expect(ca.rmsd).toBeLessThan(0.9);
  expect(bOfZ.rmsd).toBeGreaterThan(3 * z.rmsd);
});

test("no two non-bonded atoms clash for any trinucleotide context in any supported combination", () => {
  for (const options of COMBINATIONS) {
    const model = buildNucleicAcid(contexts(options), options);
    const neighbours = model.atoms.map(() => new Set<number>());
    for (const bond of model.bonds) { neighbours[bond.a].add(bond.b); neighbours[bond.b].add(bond.a); }
    const cells = new Map<string, number[]>();
    const cell = (atom: NucleicAtom) => [atom.x, atom.y, atom.z].map((value) => Math.floor(value / 3));
    model.atoms.forEach((atom, index) => { const key = cell(atom).join(); cells.set(key, [...(cells.get(key) ?? []), index]); });
    let heavyMin = Infinity, hydrogenMin = Infinity;
    model.atoms.forEach((atom, i) => {
      const [x, y, z] = cell(atom);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const j of cells.get([x + dx, y + dy, z + dz].join()) ?? []) {
          if (j <= i || neighbours[i].has(j) || [...neighbours[i]].some((k) => neighbours[k].has(j))) continue;
          const d = distance(v(atom), v(model.atoms[j]));
          if (atom.element === "H" || model.atoms[j].element === "H") hydrogenMin = Math.min(hydrogenMin, d);
          else heavyMin = Math.min(heavyMin, d);
        }
      }
    });
    // Watson-Crick N-H...N/O hydrogen bonds are the closest hydrogen contacts (1.7-1.9 A).
    expect([options, heavyMin > 2.55, hydrogenMin > 1.7]).toEqual([options, true, true]);
  }
});

test("the longest duplex stays within the browser budget", () => {
  for (const [sequence, form] of [["ACGT".repeat(125), "B"], ["CG".repeat(250), "Z"]] as const) {
    const started = performance.now();
    const model = buildNucleicAcid(sequence, { type: "DNA", form, strands: "double", fivePrime: "phosphate" });
    expect(model.atoms.length).toBe(nucleicAcidAtomCount(sequence, model.options));
    expect(model.atoms.length).toBeLessThan(35_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  }
});

test("mmCIF output is read back by Mol* with the same atoms, residues, charges, coordinates and bond graph", async () => {
  for (const [sequence, options] of [
    ["GATTACA", { type: "DNA", form: "B", strands: "double", fivePrime: "phosphate" }],
    ["CGCGCA", { type: "DNA", form: "Z", strands: "double", fivePrime: "hydroxyl" }],
    ["AACGUU", { type: "RNA", form: "A", strands: "double", fivePrime: "hydroxyl" }],
    ["GCAU", { type: "RNA", form: "A", strands: "single", fivePrime: "phosphate" }],
  ] as [string, NucleicAcidOptions][]) {
    const model = buildNucleicAcid(sequence, options);
    const text = nucleicAcidMmcif(model, nucleicAcidFileStem(sequence, options));
    expect(text).toContain(`_struct.title "Ideal ${options.form}-form ${options.type} ${options.strands === "double" ? "duplex" : "single strand"} from helical templates, unrelaxed"`);
    expect(text).toContain('_exptl.method "THEORETICAL MODEL"');
    const parsed = await CIF.parse(text).run();
    expect(parsed.isError).toBe(false);
    const block = parsed.result.blocks[0];
    // A self-complementary duplex is one entity in two chains.
    const selfComplementary = options.strands === "double" && reverseComplement(sequence, options.type) === sequence;
    expect(block.categories.entity.rowCount).toBe(options.strands === "double" && !selfComplementary ? 2 : 1);
    expect(block.categories.entity_poly.getField("type").str(0)).toBe(options.type === "DNA" ? "polydeoxyribonucleotide" : "polyribonucleotide");
    const trajectory = await trajectoryFromMmCIF(block).run();
    const structure = Structure.ofModel(trajectory.representative);
    expect(structure.polymerResidueCount).toBe(model.strands.length * sequence.length);
    const location = StructureElement.Location.create(structure);
    const read: string[] = [];
    const indexOf = new Map<string, number>();
    for (const unit of structure.units) {
      for (let i = 0; i < unit.elements.length; i++) {
        location.unit = unit; location.element = unit.elements[i];
        const key = `${StructureProperties.chain.label_asym_id(location)}${StructureProperties.residue.label_seq_id(location)}${StructureProperties.atom.label_atom_id(location)}`;
        indexOf.set(`${unit.id}:${i}`, read.length);
        read.push([key, StructureProperties.atom.label_comp_id(location), StructureProperties.atom.type_symbol(location), StructureProperties.atom.pdbx_formal_charge(location),
          ...[StructureProperties.atom.x(location), StructureProperties.atom.y(location), StructureProperties.atom.z(location)].map((value: number) => value.toFixed(3))].join(" "));
      }
    }
    const fixed = (value: number) => (Math.abs(value) < 5e-4 ? 0 : value).toFixed(3);
    expect(read).toEqual(model.atoms.map((atom) => [`${atom.chain}${atom.seq}${atom.name}`, atom.residue, atom.element, atom.charge, fixed(atom.x), fixed(atom.y), fixed(atom.z)].join(" ")));
    // Mol* bonds: chem_comp_bond within residues and the polymer O3'-P linkage between them.
    const molstarBonds: string[] = [];
    for (const unit of structure.units) {
      const { a, b, edgeProps } = unit.bonds;
      for (let edge = 0; edge < a.length; edge++) {
        if (a[edge] < b[edge]) molstarBonds.push(`${indexOf.get(`${unit.id}:${a[edge]}`)}-${indexOf.get(`${unit.id}:${b[edge]}`)}-${edgeProps.order[edge]}`);
      }
    }
    expect(structure.interUnitBonds.edgeCount).toBe(0);
    expect(molstarBonds.sort()).toEqual(model.bonds.map((bond) => `${Math.min(bond.a, bond.b)}-${Math.max(bond.a, bond.b)}-${bond.order}`).sort());
  }
});
