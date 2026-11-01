import { BACKBONE_BONDS, BASE_BONDS, HELIX_TEMPLATES, Z_DNA_TEMPLATE, type TemplateAtom, type TemplateBase } from "./nucleic-templates";
import type { MolecularAtom, MolecularBond, Vec3 } from "./types";

export type NucleicAcidType = "DNA" | "RNA";
export type HelixForm = "B" | "A" | "Z";
export type StrandCount = "single" | "double";
/** The 3' end is always a free hydroxyl. */
export type FivePrimeEnd = "hydroxyl" | "phosphate";
export type NucleicAcidOptions = { type: NucleicAcidType; form: HelixForm; strands: StrandCount; fivePrime: FivePrimeEnd };

export const NUCLEIC_ACID_MAX_LENGTH = 500;
/** Helix forms with verified templates: RNA is built only in the A form, Z only for DNA. */
export const NUCLEIC_ACID_FORMS: Record<NucleicAcidType, readonly HelixForm[]> = { DNA: ["B", "A", "Z"], RNA: ["A"] };

/** Why a nucleic acid cannot be built in a helix form, or null when it can. */
export function nucleicFormUnavailable(type: NucleicAcidType, form: HelixForm): string | null {
  if (NUCLEIC_ACID_FORMS[type].includes(form)) return null;
  return form === "Z" ? "Z-form is built only for DNA." : `${type} is built only as an ${NUCLEIC_ACID_FORMS[type].join(" or ")}-form helix.`;
}

export type NucleicAtom = MolecularAtom & { name: string; residue: string; chain: string; seq: number; charge: number };
export type NucleicStrand = { chain: string; sequence: string };
/**
 * Ideal helical-template geometry with explicit hydrogens, never relaxed. Phosphodiesters are
 * monoanions (OP2 -1) and a 5'-terminal phosphate is a dianion (OP2 and OP3 -1), as at pH 7.
 */
export type NucleicAcidModel = {
  atoms: NucleicAtom[];
  bonds: MolecularBond[];
  strands: NucleicStrand[];
  options: NucleicAcidOptions;
  charge: number;
  geometry: "ideal";
};

const ALPHABET: Record<NucleicAcidType, string> = { DNA: "ACGT", RNA: "ACGU" };
const PURINES = "AG";
type NucleotideKind = "pyrimidine" | "purine";
const kindOf = (code: string): NucleotideKind => (PURINES.includes(code) ? "purine" : "pyrimidine");
const PARTNER: Record<NucleicAcidType, Record<string, string>> = {
  DNA: { A: "T", C: "G", G: "C", T: "A" },
  RNA: { A: "U", C: "G", G: "C", U: "A" },
};

/**
 * Canonical one-letter sequence, 5' to 3'; whitespace and case are ignored. Z-DNA needs
 * strictly alternating pyrimidines and purines, as in (CG)n or (CA)n, so that every
 * nucleotide is an anti pyrimidine or a syn purine of the Z-I repeat.
 */
export function parseNucleicSequence(text: string, { type, form }: Pick<NucleicAcidOptions, "type" | "form">): string {
  const sequence = text.replace(/\s+/gu, "").toUpperCase();
  if (!sequence) throw new Error("Enter a sequence.");
  const wrong = [...sequence].find((code) => !ALPHABET[type].includes(code));
  if (wrong === "U" && type === "DNA") throw new Error("U is an RNA base. Use T, or choose RNA.");
  if (wrong === "T" && type === "RNA") throw new Error("T is a DNA base. Use U, or choose DNA.");
  if (wrong) throw new Error(`Use only ${type === "DNA" ? "A, C, G and T" : "A, C, G and U"}.`);
  if (sequence.length > NUCLEIC_ACID_MAX_LENGTH) throw new Error(`Use at most ${NUCLEIC_ACID_MAX_LENGTH} nucleotides per strand.`);
  if (form === "Z") {
    const repeat = [...sequence].findIndex((code, i) => i > 0 && kindOf(code) === kindOf(sequence[i - 1]));
    if (repeat > 0) throw new Error(`Z-DNA needs alternating pyrimidines and purines, such as CGCG or CACA. Nucleotides ${repeat} and ${repeat + 1} are both ${kindOf(sequence[repeat])}s.`);
  }
  return sequence;
}

/** The Watson-Crick partner strand, written 5' to 3'. */
export function reverseComplement(sequence: string, type: NucleicAcidType): string {
  return [...sequence].reverse().map((code) => PARTNER[type][code]).join("");
}

function checkOptions(options: NucleicAcidOptions) {
  if (options.type !== "DNA" && options.type !== "RNA") throw new Error("Choose DNA or RNA.");
  if (!["A", "B", "Z"].includes(options.form)) throw new Error("Choose an A-, B- or Z-form helix.");
  const unavailable = nucleicFormUnavailable(options.type, options.form);
  if (unavailable) throw new Error(unavailable);
  if (options.strands !== "single" && options.strands !== "double") throw new Error("Choose one or two strands.");
  if (options.fivePrime !== "hydroxyl" && options.fivePrime !== "phosphate") throw new Error("Unsupported 5' end.");
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3) => scale(a, 1 / Math.hypot(...a));
const radians = (degrees: number) => degrees * Math.PI / 180;

const helix = (form: HelixForm) => (form === "Z" ? Z_DNA_TEMPLATE : HELIX_TEMPLATES[form]);
const backboneOf = (form: HelixForm, kind: NucleotideKind) => (form === "Z" ? Z_DNA_TEMPLATE.backbone[kind] : HELIX_TEMPLATES[form].backbone);
const o3Of = (atoms: readonly TemplateAtom[]): Vec3 => { const [, x, y, z] = atoms.find(([name]) => name === "O3'")!; return [x, y, z]; };

/** Helix screw: `steps` repeats (nucleotides; dinucleotides for Z) toward the 3' end of the template strand. */
function screw(point: Vec3, form: HelixForm, steps: number): Vec3 {
  const { twistDegrees, riseAngstrom } = helix(form);
  const angle = radians(-twistDegrees * steps), cos = Math.cos(angle), sin = Math.sin(angle);
  return [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos, point[2] - riseAngstrom * steps];
}

/** Atom d bonded to c with angle b-c-d and dihedral a-b-c-d (NeRF). */
function place(a: Vec3, b: Vec3, c: Vec3, length: number, angle: number, dihedral: number): Vec3 {
  const bc = unit(sub(c, b));
  const n = unit(cross(sub(b, a), bc));
  const m = cross(n, bc);
  const theta = radians(angle), phi = radians(dihedral);
  return add(c, add(scale(bc, -length * Math.cos(theta)), add(scale(m, length * Math.sin(theta) * Math.cos(phi)), scale(n, length * Math.sin(theta) * Math.sin(phi)))));
}

const signedVolume = (center: Vec3, a: Vec3, b: Vec3, c: Vec3) => dot(cross(sub(a, center), sub(b, center)), sub(c, center));
const TETRAHEDRAL = 109.4712;
const CH = 1.09, AROMATIC_CH = 1.08, NH = 1.01, OH = 0.97;
/**
 * P-O of a nucleoside 5'-monophosphate dianion: mean of the six free P-O bonds (1.516-1.524 A)
 * in crystalline disodium cytidine 5'-monophosphate (COD 2205273, Acta Cryst. E61, m554, 2005).
 */
const TERMINAL_PHOSPHATE_PO = 1.52;

type LocalResidue = { names: string[]; positions: Vec3[]; charges: number[]; bonds: [number, number, number][] };
type Terminus = { phosphate: boolean; fivePrimeHydroxyl: boolean; fivePrimePhosphate: boolean; threePrimeHydroxyl: boolean };

const cache = new Map<string, LocalResidue>();

/**
 * One nucleotide in its template frame with hydrogens. Hydrogen positions follow ideal
 * VSEPR geometry. Methylene hydrogens are named by IUPAC-IUB (1983): H5' and H2' are pro-S,
 * H5'' and H2'' pro-R (the CCD's own coordinates are not consistent about this). Amino
 * hydrogens follow the CCD: H61 cis to N1, H41 cis to N3, H21 cis to N3.
 */
function residueTemplate(type: NucleicAcidType, form: HelixForm, code: string, end: Terminus): LocalResidue {
  const key = `${type}${form}${code}${end.phosphate ? 1 : 0}${end.fivePrimeHydroxyl ? 1 : 0}${end.fivePrimePhosphate ? 1 : 0}${end.threePrimeHydroxyl ? 1 : 0}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const base = (code === "U" ? "T" : code) as TemplateBase;
  const kind = kindOf(code);
  const heavy: TemplateAtom[] = [
    ...backboneOf(form, kind).filter(([name]) => end.phosphate || !["P", "OP1", "OP2"].includes(name)),
    ...(type === "RNA" ? [HELIX_TEMPLATES.A.o2] : []),
    ...helix(form).bases[base].filter(([name]) => code !== "U" || name !== "C7"),
  ];
  const names = heavy.map(([name]) => name);
  const positions = heavy.map(([, x, y, z]) => [x, y, z] as Vec3);
  const index = new Map(names.map((name, i) => [name, i]));
  const at = (name: string) => positions[index.get(name)!];
  const bonds: [number, number, number][] = [];
  const bond = (a: string, b: string, order: number) => bonds.push([index.get(a)!, index.get(b)!, order]);
  const addAtom = (name: string, position: Vec3, parent: string) => {
    index.set(name, names.length);
    names.push(name);
    positions.push(position);
    bond(parent, name, 1);
  };
  for (const [a, b, order] of [...BACKBONE_BONDS, ...BASE_BONDS[code as TemplateBase | "U"]]) if (index.has(a) && index.has(b)) bond(a, b, order);
  if (type === "RNA") bond("C2'", "O2'", 1);
  // A 5' phosphate is a dianion whose three free oxygens are equivalent by resonance and
  // longer than a phosphodiester's two. They keep the fiber directions, OP3 pointing to where
  // the preceding nucleotide's O3' would be, at the P-O length of TERMINAL_PHOSPHATE_PO.
  if (end.fivePrimePhosphate) {
    const phosphorus = at("P");
    const freeOxygen = (toward: Vec3) => add(phosphorus, scale(unit(sub(toward, phosphorus)), TERMINAL_PHOSPHATE_PO));
    positions[index.get("OP1")!] = freeOxygen(at("OP1"));
    positions[index.get("OP2")!] = freeOxygen(at("OP2"));
    // The 5' neighbour of a Z purine is the pyrimidine of its own repeat; that of a Z
    // pyrimidine is the purine of the previous repeat.
    const previousO3 = form !== "Z" ? screw(at("O3'"), form, -1)
      : kind === "purine" ? o3Of(Z_DNA_TEMPLATE.backbone.pyrimidine) : screw(o3Of(Z_DNA_TEMPLATE.backbone.purine), form, -1);
    addAtom("OP3", freeOxygen(previousO3), "P");
  }

  // Methine: opposite the sum of its three bond directions.
  const methine = (name: string, parent: string, neighbours: string[]) => {
    const center = at(parent);
    addAtom(name, add(center, scale(unit(neighbours.reduce<Vec3>((sum, other) => add(sum, unit(sub(center, at(other)))), [0, 0, 0])), CH)), parent);
  };
  // Planar ring hydrogen: on the external bisector of its two ring bonds.
  const ring = (name: string, parent: string, a: string, b: string, length: number) => {
    const center = at(parent);
    addAtom(name, add(center, scale(unit(add(unit(sub(center, at(a))), unit(sub(center, at(b))))), length)), parent);
  };
  // Methylene: `higher` outranks `lower` by CIP. A hydrogen promoted over its twin makes the
  // centre S, so pro-S, when (higher, lower, H) has a positive signed volume.
  const methylene = (parent: string, higher: string, lower: string, [proS, proR]: [string, string]) => {
    const center = at(parent);
    const u = unit(add(unit(sub(center, at(higher))), unit(sub(center, at(lower))))), w = unit(cross(sub(at(higher), center), sub(at(lower), center)));
    const half = radians(TETRAHEDRAL / 2);
    const candidates = [1, -1].map((sign) => add(center, scale(add(scale(u, Math.cos(half)), scale(w, sign * Math.sin(half))), CH)));
    const ordered = signedVolume(center, at(higher), at(lower), candidates[0]) > 0 ? candidates : [candidates[1], candidates[0]];
    addAtom(proS, ordered[0], parent);
    addAtom(proR, ordered[1], parent);
  };
  // Planar amino group: the first name is cis to `cis`, the second cis to the other ring neighbour.
  const amino = (nitrogen: string, carbon: string, cis: string, [first, second]: [string, string]) => {
    addAtom(first, place(at(cis), at(carbon), at(nitrogen), NH, 120, 0), nitrogen);
    addAtom(second, place(at(cis), at(carbon), at(nitrogen), NH, 120, 180), nitrogen);
  };
  const hydroxyl = (name: string, oxygen: string, carbon: string, anti: string) => addAtom(name, place(at(anti), at(carbon), at(oxygen), OH, TETRAHEDRAL, 180), oxygen);

  methylene("C5'", "O5'", "C4'", ["H5'", "H5''"]);
  methine("H4'", "C4'", ["C5'", "O4'", "C3'"]);
  methine("H3'", "C3'", ["C4'", "O3'", "C2'"]);
  if (type === "RNA") methine("H2'", "C2'", ["C3'", "C1'", "O2'"]);
  else methylene("C2'", "C1'", "C3'", ["H2'", "H2''"]);
  methine("H1'", "C1'", ["O4'", "C2'", kind === "purine" ? "N9" : "N1"]);
  if (base === "A") {
    ring("H8", "C8", "N9", "N7", AROMATIC_CH);
    ring("H2", "C2", "N1", "N3", AROMATIC_CH);
    amino("N6", "C6", "N1", ["H61", "H62"]);
  } else if (base === "G") {
    ring("H8", "C8", "N9", "N7", AROMATIC_CH);
    ring("H1", "N1", "C6", "C2", NH);
    amino("N2", "C2", "N3", ["H21", "H22"]);
  } else if (base === "C") {
    amino("N4", "C4", "N3", ["H41", "H42"]);
    ring("H5", "C5", "C4", "C6", AROMATIC_CH);
    ring("H6", "C6", "C5", "N1", AROMATIC_CH);
  } else {
    ring("H3", "N3", "C2", "C4", NH);
    if (code === "U") ring("H5", "C5", "C4", "C6", AROMATIC_CH);
    // H71 eclipses C6 in the base plane. The staggered rotor would put a methyl hydrogen 1.46 A
    // from H2' of the 5'-neighbouring purine in Z-DNA (C7...C2' 3.45 A).
    else for (const [name, dihedral] of [["H71", 0], ["H72", 120], ["H73", 240]] as const) addAtom(name, place(at("C6"), at("C5"), at("C7"), CH, TETRAHEDRAL, dihedral), "C7");
    ring("H6", "C6", "C5", "N1", AROMATIC_CH);
  }
  if (type === "RNA") hydroxyl("HO2'", "O2'", "C2'", "C3'");
  if (end.fivePrimeHydroxyl) hydroxyl("HO5'", "O5'", "C5'", "C4'");
  if (end.threePrimeHydroxyl) hydroxyl("HO3'", "O3'", "C3'", "C4'");

  const charges = names.map((name) => (name === "OP2" || name === "OP3" ? -1 : 0));
  const residue = { names, positions, charges, bonds };
  cache.set(key, residue);
  return residue;
}

function terminus(position: number, length: number, fivePrime: FivePrimeEnd): Terminus {
  const first = position === 0;
  return {
    phosphate: !first || fivePrime === "phosphate",
    fivePrimeHydroxyl: first && fivePrime === "hydroxyl",
    fivePrimePhosphate: first && fivePrime === "phosphate",
    threePrimeHydroxyl: position === length - 1,
  };
}

function strandsFor(sequence: string, options: NucleicAcidOptions): NucleicStrand[] {
  return [{ chain: "A", sequence }, ...(options.strands === "double" ? [{ chain: "B", sequence: reverseComplement(sequence, options.type) }] : [])];
}

/** Atoms the builder will write, hydrogens included, without building coordinates. */
export function nucleicAcidAtomCount(sequence: string, options: NucleicAcidOptions): number {
  checkOptions(options);
  const parsed = parseNucleicSequence(sequence, options);
  let count = 0;
  for (const strand of strandsFor(parsed, options)) {
    [...strand.sequence].forEach((code, position) => { count += residueTemplate(options.type, options.form, code, terminus(position, parsed.length, options.fivePrime)).names.length; });
  }
  return count;
}

/**
 * Screw steps and dyad of the nucleotide at helix `level`, the position in chain A of the
 * nucleotide or of its partner. In A and B every nucleotide is one repeat and the dyad
 * (x axis) passes through base pair 0. In Z a repeat is a pyrimidine-purine dinucleotide
 * and the dyad lies between levels 1 and 2, so chain B at level L is the dyad image of
 * the chain A nucleotide at level 3 - L. `phase` is 1 when chain A starts with a purine.
 */
function placement(form: HelixForm, chainB: boolean, level: number, phase: number) {
  if (form !== "Z") return { steps: level, mirrored: chainB };
  const repeat = Math.floor((chainB ? 3 - level - phase : level + phase) / 2);
  return { steps: chainB ? -repeat : repeat, mirrored: chainB };
}

/**
 * Builds an ideal helix from canonical templates: right-handed A or B, left-handed Z.
 * Strand A follows the sequence 5' to 3'; with two strands, chain B is its reverse
 * complement, antiparallel and base paired. Coordinates are the helix frame (axis along
 * z) centred on the molecule along the axis.
 */
export function buildNucleicAcid(sequence: string, options: NucleicAcidOptions): NucleicAcidModel {
  checkOptions(options);
  const parsed = parseNucleicSequence(sequence, options);
  const strands = strandsFor(parsed, options);
  const length = parsed.length, phase = kindOf(parsed[0]) === "purine" ? 1 : 0;
  const atoms: NucleicAtom[] = [];
  const bonds: MolecularBond[] = [];
  strands.forEach(({ chain, sequence: codes }, strandIndex) => {
    let previousO3: number | null = null;
    [...codes].forEach((code, position) => {
      const local = residueTemplate(options.type, options.form, code, terminus(position, length, options.fivePrime));
      // Chain B nucleotide `position` pairs with chain A nucleotide `length - 1 - position`.
      const { steps, mirrored } = placement(options.form, strandIndex === 1, strandIndex === 0 ? position : length - 1 - position, phase);
      const offset = atoms.length;
      const residue = options.type === "DNA" ? `D${code}` : code;
      local.names.forEach((name, i) => {
        const [x, y, z] = local.positions[i];
        const [px, py, pz] = screw(mirrored ? [x, -y, -z] : [x, y, z], options.form, steps);
        atoms.push({ element: name[0], x: px, y: py, z: pz, name, residue, chain, seq: position + 1, charge: local.charges[i] });
      });
      for (const [a, b, order] of local.bonds) bonds.push({ a: offset + a, b: offset + b, order });
      if (previousO3 !== null) bonds.push({ a: previousO3, b: offset + local.names.indexOf("P"), order: 1 });
      previousO3 = offset + local.names.indexOf("O3'");
    });
  });
  let low = Infinity, high = -Infinity;
  for (const atom of atoms) { low = Math.min(low, atom.z); high = Math.max(high, atom.z); }
  for (const atom of atoms) atom.z -= (low + high) / 2;
  return { atoms, bonds, strands, options, charge: atoms.reduce((sum, atom) => sum + atom.charge, 0), geometry: "ideal" };
}

/** Short document name; "ideal" marks unrelaxed builder geometry. */
export function nucleicAcidFileStem(sequence: string, options: NucleicAcidOptions) {
  const head = sequence.length > 12 ? `${sequence.slice(0, 12)}-${sequence.length}nt` : sequence;
  return `${head}-${options.form}-${options.type}${options.strands === "double" ? "-duplex" : ""}-ideal`;
}

const cifValue = (value: string) => (/^[^\s'"_#$;[\]][^\s]*$/u.test(value) && !/'/u.test(value) && value !== "." && value !== "?" ? value : `"${value}"`);
const coordinate = (value: number) => (Math.abs(value) < 5e-4 ? 0 : value).toFixed(3);

/**
 * mmCIF with one entity per distinct strand sequence, standard CCD residue and atom names,
 * formal charges, and every intra-residue bond in chem_comp_bond so readers need no
 * dictionary. Inter-residue O3'-P links are standard polymer linkages at 1.60 A.
 */
export function nucleicAcidMmcif(model: NucleicAcidModel, name: string): string {
  const id = name.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 64) || "nucleic_acid";
  const { type, form, strands } = model.options;
  const polymer = type === "DNA" ? "polydeoxyribonucleotide" : "polyribonucleotide";
  const entities: string[] = [];
  const entityOf = new Map<string, number>();
  for (const strand of model.strands) {
    if (!entityOf.has(strand.sequence)) { entities.push(strand.sequence); entityOf.set(strand.sequence, entities.length); }
  }
  const residueName = (code: string) => (type === "DNA" ? `D${code}` : code);
  const title = `Ideal ${form}-form ${type} ${strands === "double" ? "duplex" : "single strand"} from helical templates, unrelaxed`;
  const lines = [
    `data_${id}`, "#", `_entry.id ${id}`, `_struct.entry_id ${id}`, `_struct.title "${title}"`, `_exptl.entry_id ${id}`, `_exptl.method "THEORETICAL MODEL"`, "#",
    "loop_", "_entity.id", "_entity.type", "_entity.pdbx_description",
    ...entities.map((_, i) => `${i + 1} polymer "${type} strand ${i + 1}"`), "#",
    "loop_", "_entity_poly.entity_id", "_entity_poly.type", "_entity_poly.nstd_linkage", "_entity_poly.nstd_monomer", "_entity_poly.pdbx_strand_id",
    ...entities.map((sequence, i) => `${i + 1} ${polymer} no no ${model.strands.filter((strand) => strand.sequence === sequence).map((strand) => strand.chain).join(",")}`), "#",
    "loop_", "_entity_poly_seq.entity_id", "_entity_poly_seq.num", "_entity_poly_seq.mon_id", "_entity_poly_seq.hetero",
    ...entities.flatMap((sequence, i) => [...sequence].map((code, position) => `${i + 1} ${position + 1} ${residueName(code)} n`)), "#",
    "loop_", "_struct_asym.id", "_struct_asym.entity_id",
    ...model.strands.map((strand) => `${strand.chain} ${entityOf.get(strand.sequence)}`), "#",
  ];
  // Every residue variant's bonds, keyed by component and atom names.
  const componentBonds = new Map<string, Map<string, MolecularBond & { names: [string, string] }>>();
  const residueOf = (atom: NucleicAtom) => `${atom.chain}:${atom.seq}`;
  for (const bond of model.bonds) {
    const a = model.atoms[bond.a], b = model.atoms[bond.b];
    if (residueOf(a) !== residueOf(b)) continue;
    const bondsOf = componentBonds.get(a.residue) ?? new Map();
    componentBonds.set(a.residue, bondsOf);
    const key = [a.name, b.name].sort().join("\u0000");
    if (!bondsOf.has(key)) bondsOf.set(key, { ...bond, names: [a.name, b.name] });
  }
  const components = [...componentBonds.keys()].sort();
  lines.push("loop_", "_chem_comp.id", "_chem_comp.type", "_chem_comp.mon_nstd_flag",
    ...components.map((component) => `${component} "${type} linking" y`), "#");
  lines.push("loop_", "_chem_comp_bond.comp_id", "_chem_comp_bond.atom_id_1", "_chem_comp_bond.atom_id_2", "_chem_comp_bond.value_order", "_chem_comp_bond.pdbx_aromatic_flag", "_chem_comp_bond.pdbx_ordinal");
  for (const component of components) {
    [...componentBonds.get(component)!.values()].forEach((bond, i) => lines.push(`${component} ${cifValue(bond.names[0])} ${cifValue(bond.names[1])} ${bond.order === 2 ? "DOUB" : "SING"} N ${i + 1}`));
  }
  lines.push("#", "loop_", ...["group_PDB", "id", "type_symbol", "label_atom_id", "label_alt_id", "label_comp_id", "label_asym_id", "label_entity_id", "label_seq_id",
    "pdbx_PDB_ins_code", "Cartn_x", "Cartn_y", "Cartn_z", "occupancy", "B_iso_or_equiv", "pdbx_formal_charge", "auth_seq_id", "auth_comp_id", "auth_asym_id", "auth_atom_id", "pdbx_PDB_model_num"]
    .map((field) => `_atom_site.${field}`));
  const strandEntity = new Map(model.strands.map((strand) => [strand.chain, entityOf.get(strand.sequence)!]));
  model.atoms.forEach((atom, i) => {
    const atomName = cifValue(atom.name);
    lines.push(`ATOM ${i + 1} ${atom.element} ${atomName} . ${atom.residue} ${atom.chain} ${strandEntity.get(atom.chain)} ${atom.seq} ? ${coordinate(atom.x)} ${coordinate(atom.y)} ${coordinate(atom.z)} 1.00 0.00 ${atom.charge} ${atom.seq} ${atom.residue} ${atom.chain} ${atomName} 1`);
  });
  lines.push("#", "");
  return lines.join("\n");
}
