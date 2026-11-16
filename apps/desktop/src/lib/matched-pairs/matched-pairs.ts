import type { MainModule as RDKitModule } from "@rdkit/rdkit";

// Matched molecular pairs by single acyclic cuts (Hussain and Rea, J. Chem.
// Inf. Model. 2010, 50, 339), with mmpdb's rules for which bonds are cut and
// which fragmentations are indexed, so a collection gives the transformations
// mmpdb gives for `fragment --num-cuts 1` and a default `index`.

// mmpdb's default cut: an acyclic single bond from an uncharged carbon that is
// not an amide, ester or amidine carbon, and not a CH2-CH2 or CH2-CH3 bond.
const CUT_SMARTS = "[#6+0;!$(*=,#[!#6])]!@!=!#[!#0;!#1;!$([CH2]);!$([CH3][CH2])]";
const ROTATABLE_SMARTS = "[!$([NH]!@C(=O))&!D1&!$(*#*)]-&!@[!$([NH]!@C(=O))&!D1&!$(*#*)]";
const MAX_HEAVIES = 100;
const MAX_ROTATABLE_BONDS = 10;
const MAX_VARIABLE_HEAVIES = 10;
const HYDROGEN_VARIABLE = "[*][H]";
// Each new stereocentre triples the enumerated fragments; past this a cut keeps
// only its plain fragmentation.
const MAX_UP_ENUMERATED_CENTRES = 4;
// Bond stereo and the tags set during up-enumeration are already final in the
// fragment documents; a second perception would drop both.
const FRAGMENT_PARSE = JSON.stringify({ assignStereo: false });

export const MATCHED_PAIR_LIMITS = { molecules: 2_000, fragmentations: 200_000, pairs: 200_000 };

export type MatchedPairInput = { id: number; smiles: string | null; molblock: string | null };

/** "N" is the fragmentation as cut; "C" and "V" carry a stereocentre that the
 * cut created in the constant or the variable part, written out both ways. */
export type Fragmentation = {
  label: "N" | "C" | "V";
  variable: string;
  constant: string;
  variableHeavies: number;
};

export type FragmentedMolecule = { id: number; smiles: string; fragmentations: Fragmentation[] };

export type MatchedPair = { fromId: number; toId: number; constant: number };

export type Transformation = { from: string; to: string; pairs: MatchedPair[] };

export type MatchedPairsResult = {
  /** Molecules that were fragmented, with the SMILES the pairs refer to. */
  molecules: Array<{ id: number; smiles: string }>;
  constants: string[];
  transformations: Transformation[];
  /** Unreadable, multi-component, too large or too flexible to fragment. */
  skippedMolecules: number;
  capped: { molecules: boolean; fragmentations: boolean; pairs: boolean };
};

export type TransformationStatistics = {
  /** Pairs in which both molecules have a value. */
  count: number;
  mean: number;
  /** Sample standard deviation; null for a single pair. */
  sd: number | null;
  min: number;
  max: number;
};

type JsonAtom = { z: number; impHs: number; chg: number; isotope: number; stereo: string; [key: string]: unknown };
type JsonBond = { atoms: [number, number]; bo: number; stereo?: string; stereoAtoms?: [number, number]; [key: string]: unknown };
type JsonDocument = {
  defaults?: { atom?: Partial<JsonAtom>; bond?: Partial<JsonBond> };
  molecules: Array<{
    atoms: Array<Partial<JsonAtom>>;
    bonds: Array<Partial<JsonBond> & { atoms: [number, number] }>;
    extensions?: Array<{ name?: string; aromaticBonds?: number[]; cipCodes?: Array<[number, string]> }>;
  }>;
  [key: string]: unknown;
};

type Graph = {
  header: Omit<JsonDocument, "molecules">;
  atoms: JsonAtom[];
  bonds: JsonBond[];
  /** Per atom: [neighbour, bond index], in bond order. */
  neighbours: Array<Array<[number, number]>>;
  atomSeeds: string[];
  bondSeeds: string[];
};

type RDKitMol = NonNullable<ReturnType<RDKitModule["get_mol"]>>;

export type MatchedPairQueries = { cut: RDKitMol; rotatable: RDKitMol };

export function createMatchedPairQueries(rdkit: RDKitModule): MatchedPairQueries {
  const cut = rdkit.get_qmol(CUT_SMARTS);
  const rotatable = rdkit.get_qmol(ROTATABLE_SMARTS);
  if (!cut || !rotatable) throw new Error("The cut patterns could not be compiled.");
  return { cut, rotatable };
}

function matchedAtoms(mol: RDKitMol, query: RDKitMol): number[][] {
  const matches = JSON.parse(mol.get_substruct_matches(query)) as Array<{ atoms?: number[] }> | Record<string, never>;
  return Array.isArray(matches) ? matches.flatMap((match) => (match.atoms ? [match.atoms] : [])) : [];
}

function readGraph(mol: RDKitMol): Graph {
  const { molecules, ...header } = JSON.parse(mol.get_json()) as JsonDocument;
  const molecule = molecules[0];
  const atoms = molecule.atoms.map((atom) => ({ z: 6, impHs: 0, chg: 0, isotope: 0, stereo: "unspecified", ...header.defaults?.atom, ...atom }));
  const bonds = molecule.bonds.map((bond) => ({ bo: 1, ...header.defaults?.bond, ...bond }));
  const representation = molecule.extensions?.find((extension) => extension.name === "rdkitRepresentation");
  const aromaticBonds = new Set(representation?.aromaticBonds ?? []);
  const cipCodes = new Map(representation?.cipCodes ?? []);
  const neighbours: Graph["neighbours"] = atoms.map(() => []);
  bonds.forEach((bond, index) => {
    neighbours[bond.atoms[0]].push([bond.atoms[1], index]);
    neighbours[bond.atoms[1]].push([bond.atoms[0], index]);
  });
  return {
    header,
    atoms,
    bonds,
    neighbours,
    atomSeeds: atoms.map((atom, index) => `${atom.z}.${atom.chg}.${atom.isotope}.${atom.impHs}.${cipCodes.get(index) ?? ""}`),
    bondSeeds: bonds.map((bond, index) => (aromaticBonds.has(index) ? "a" : String(bond.bo))),
  };
}

// Atoms that the molecule's symmetry maps onto each other share a class: the
// partition RDKit's CanonicalRankAtoms(breakTies=False) gives, by refinement.
// `cut` removes one bond and gives each of its atoms a wildcard neighbour.
function symmetryClasses(graph: Graph, cut: number | null): number[] {
  const rank = (keys: string[]) => {
    const ids = new Map<string, number>();
    return { classes: keys.map((key) => ids.get(key) ?? (ids.set(key, ids.size), ids.size - 1)), size: ids.size };
  };
  let current = rank(graph.atomSeeds);
  for (;;) {
    const next = rank(graph.atoms.map((_, atom) => `${current.classes[atom]}|${graph.neighbours[atom]
      .map(([neighbour, bond]) => (bond === cut ? "*" : `${graph.bondSeeds[bond]}${current.classes[neighbour]}`))
      .sort().join(",")}`));
    if (next.size === current.size) return current.classes;
    current = next;
  }
}

// mmpdb's is_potential_chiral_center: three or four neighbours, no two of them
// equivalent. The wildcard a cut leaves behind is unlike any other neighbour.
function isPotentialStereocentre(graph: Graph, classes: number[], atom: number, cut: number | null): boolean {
  const neighbours = graph.neighbours[atom];
  const degree = neighbours.length + graph.atoms[atom].impHs;
  if (degree !== 3 && degree !== 4) return false;
  const seen = new Set(neighbours.map(([neighbour, bond]) => (bond === cut ? -1 : classes[neighbour])));
  if (seen.size !== neighbours.length || seen.size < 3) return false;
  if (seen.size === 4 || graph.atoms[atom].impHs === 1) return true;
  const { z, chg, impHs } = graph.atoms[atom];
  if (z !== 16 && z !== 34) return false;
  const valence = impHs + neighbours.reduce((sum, [, bond]) => sum + graph.bonds[bond].bo, 0);
  return valence === 4 || (valence === 3 && chg === 1);
}

function canonicalSmiles(rdkit: RDKitModule, smiles: string): string | null {
  const mol = rdkit.get_mol(smiles);
  if (!mol) return null;
  try { return mol.get_smiles(); } finally { mol.delete(); }
}

// One side of a cut as its own molecule: its atoms in their original order,
// then the wildcard. The cut bond keeps its place in the bond list, so the
// atom it left keeps its neighbour order and with it its chirality.
function fragmentSmiles(
  rdkit: RDKitModule,
  graph: Graph,
  side: number[],
  cut: number,
  stereo: Map<number, string> | null,
): string | null {
  const local = new Map(side.map((atom, index) => [atom, index]));
  const wildcard = side.length;
  const [first, second] = graph.bonds[cut].atoms;
  const outside = local.has(first) ? second : first;
  const index = (atom: number) => (atom === outside ? wildcard : local.get(atom) as number);
  const atoms: Array<Partial<JsonAtom>> = side.map((atom) => (stereo?.has(atom) ? { ...graph.atoms[atom], stereo: stereo.get(atom) } : graph.atoms[atom]));
  atoms.push({ z: 0, impHs: 0, chg: 0, isotope: 0, stereo: "unspecified" });
  const bonds = graph.bonds.flatMap((bond, bondIndex) => {
    if (bondIndex === cut) return [{ atoms: [index(first), index(second)], bo: 1 }];
    if (!local.has(bond.atoms[0])) return [];
    return [{
      ...bond,
      atoms: [index(bond.atoms[0]), index(bond.atoms[1])],
      ...(bond.stereoAtoms ? { stereoAtoms: [index(bond.stereoAtoms[0]), index(bond.stereoAtoms[1])] } : {}),
    }];
  });
  const mol = rdkit.get_mol(JSON.stringify({ ...graph.header, molecules: [{ atoms, bonds }] }), FRAGMENT_PARSE);
  if (!mol) return null;
  // Written without perception, ring stereo can come out in either of two
  // equivalent spellings; reading the SMILES back settles on the canonical one.
  try { return canonicalSmiles(rdkit, mol.get_smiles()); } finally { mol.delete(); }
}

function sideOf(graph: Graph, start: number, cut: number): number[] {
  const seen = new Set([start]);
  const queue = [start];
  for (let atom = queue.pop(); atom !== undefined; atom = queue.pop()) {
    for (const [neighbour, bond] of graph.neighbours[atom]) {
      if (bond === cut || seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** Every single-cut fragmentation of one molecule, or null when mmpdb would
 * not fragment it: unreadable, several components, a wildcard atom, fewer than
 * two or more than 100 heavy atoms, more than 10 rotatable bonds. */
export function fragmentMolecule(rdkit: RDKitModule, queries: MatchedPairQueries, input: MatchedPairInput): FragmentedMolecule | null {
  let source: RDKitMol | null = null;
  let mol: RDKitMol | null = null;
  try {
    source = rdkit.get_mol(input.molblock?.trim() ? input.molblock : input.smiles ?? "");
    const smiles = source?.get_smiles() ?? "";
    if (!smiles || smiles.includes(".")) return null;
    // Fragment the canonical SMILES rather than the record, so the atom order
    // does not depend on how the file listed the atoms.
    mol = rdkit.get_mol(smiles);
    if (!mol) return null;
    const graph = readGraph(mol);
    const heavies = graph.atoms.filter((atom) => atom.z > 1).length;
    if (graph.atoms.some((atom) => atom.z === 0) || heavies < 2 || heavies > MAX_HEAVIES) return null;
    if (matchedAtoms(mol, queries.rotatable).length > MAX_ROTATABLE_BONDS) return null;

    const parentClasses = symmetryClasses(graph, null);
    const fragmentations: Fragmentation[] = [];
    const seen = new Set<string>();
    const add = (label: Fragmentation["label"], variable: string, constant: string, variableHeavies: number) => {
      const key = `${variable} ${constant}`;
      if (seen.has(key)) return;
      seen.add(key);
      fragmentations.push({ label, variable, constant, variableHeavies });
    };
    for (const [a, b] of matchedAtoms(mol, queries.cut)) {
      const cut = graph.neighbours[a].find(([neighbour]) => neighbour === b)?.[1];
      if (cut === undefined) continue;
      // mmpdb names the fragment with the first atom "1"; only its new
      // stereocentres are enumerated.
      const first = sideOf(graph, 0, cut);
      const firstHasA = first.includes(a);
      const second = sideOf(graph, firstHasA ? b : a, cut);
      if (first.length + second.length !== graph.atoms.length) continue;
      const firstSmiles = fragmentSmiles(rdkit, graph, first, cut, null);
      const secondSmiles = fragmentSmiles(rdkit, graph, second, cut, null);
      if (!firstSmiles || !secondSmiles) continue;
      const firstHeavies = first.filter((atom) => graph.atoms[atom].z > 1).length;
      const secondHeavies = heavies - firstHeavies;
      add("N", secondSmiles, firstSmiles, secondHeavies);

      // A cut can make a stereocentre out of an atom whose two equal branches
      // it tells apart. Writing that atom both ways lets the fragment meet the
      // same fragment from a molecule in which the centre is already defined.
      const cutClasses = symmetryClasses(graph, cut);
      const centres = first.filter((atom) => graph.atoms[atom].stereo === "unspecified"
        && !isPotentialStereocentre(graph, parentClasses, atom, null)
        && isPotentialStereocentre(graph, cutClasses, atom, cut));
      const enumerated = new Set<string>();
      if (centres.length > 0 && centres.length <= MAX_UP_ENUMERATED_CENTRES) {
        for (let code = 1; code < 3 ** centres.length; code += 1) {
          const stereo = new Map(centres.map((atom, position) => [atom, ["unspecified", "cw", "ccw"][Math.floor(code / 3 ** position) % 3]]));
          const smiles = fragmentSmiles(rdkit, graph, first, cut, stereo);
          if (smiles) enumerated.add(smiles);
        }
      }
      for (const smiles of enumerated) add("C", secondSmiles, smiles, secondHeavies);
      add("N", firstSmiles, secondSmiles, firstHeavies);
      for (const smiles of enumerated) add("V", smiles, secondSmiles, firstHeavies);
    }
    return { id: input.id, smiles, fragmentations };
  } catch {
    return null;
  } finally {
    mol?.delete();
    source?.delete();
  }
}

const labelled = (smiles: string) => smiles.replace(/\[\*\]|\*/g, "[*:1]");

/** Pairs molecules that share a constant part. A molecule that equals a
 * constant capped with hydrogen joins it with the variable part `[*:1][H]`. */
export function indexMatchedPairs(
  rdkit: RDKitModule,
  molecules: FragmentedMolecule[],
  maxPairs = MATCHED_PAIR_LIMITS.pairs,
): Pick<MatchedPairsResult, "constants" | "transformations"> & { capped: boolean } {
  type Entry = { id: number; variable: string; label: Fragmentation["label"] };
  const index = new Map<string, Entry[]>();
  const idsBySmiles = new Map<string, number[]>();
  for (const molecule of molecules) {
    idsBySmiles.set(molecule.smiles, [...(idsBySmiles.get(molecule.smiles) ?? []), molecule.id]);
    for (const { label, variable, constant, variableHeavies } of molecule.fragmentations) {
      if (variableHeavies > MAX_VARIABLE_HEAVIES) continue;
      const entries = index.get(constant) ?? [];
      if (!entries.length) index.set(constant, entries);
      entries.push({ id: molecule.id, variable, label });
    }
  }
  for (const [constant, entries] of index) {
    const capped = canonicalSmiles(rdkit, constant.replace(/\[\*\]|\*/, "[H]"));
    for (const id of (capped && idsBySmiles.get(capped)) || []) entries.push({ id, variable: HYDROGEN_VARIABLE, label: "N" });
  }

  const constants: string[] = [];
  const transformations = new Map<string, Transformation>();
  let pairCount = 0;
  for (const constant of [...index.keys()].sort()) {
    const entries = index.get(constant) as Entry[];
    if (entries.length < 2) continue;
    let constantIndex = -1;
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        let from = entries[i];
        let to = entries[j];
        // Two enumerated fragments never pair: neither molecule has the centre.
        if (from.id === to.id || from.variable === to.variable || (from.label !== "N" && to.label !== "N")) continue;
        if (pairCount >= maxPairs) return { constants, transformations: [...transformations.values()], capped: true };
        if (from.variable > to.variable) [from, to] = [to, from];
        const key = `${from.variable}>>${to.variable}`;
        let transformation = transformations.get(key);
        if (!transformation) {
          transformation = { from: labelled(from.variable), to: labelled(to.variable), pairs: [] };
          transformations.set(key, transformation);
        }
        if (constantIndex < 0) constantIndex = constants.push(labelled(constant)) - 1;
        transformation.pairs.push({ fromId: from.id, toId: to.id, constant: constantIndex });
        pairCount += 1;
      }
    }
  }
  return { constants, transformations: [...transformations.values()], capped: false };
}

export function findMatchedPairs(
  rdkit: RDKitModule,
  inputs: MatchedPairInput[],
  onProgress?: (done: number, total: number) => void,
): MatchedPairsResult {
  const queries = createMatchedPairQueries(rdkit);
  try {
    const rows = inputs.slice(0, MATCHED_PAIR_LIMITS.molecules);
    const molecules: FragmentedMolecule[] = [];
    let fragmentationCount = 0;
    let fragmentationsCapped = false;
    let skippedMolecules = 0;
    for (const [position, row] of rows.entries()) {
      const molecule = fragmentMolecule(rdkit, queries, row);
      if (!molecule) skippedMolecules += 1;
      else {
        if (fragmentationCount + molecule.fragmentations.length > MATCHED_PAIR_LIMITS.fragmentations) {
          fragmentationsCapped = true;
          break;
        }
        fragmentationCount += molecule.fragmentations.length;
        molecules.push(molecule);
      }
      onProgress?.(position + 1, rows.length);
    }
    const { capped, ...pairs } = indexMatchedPairs(rdkit, molecules);
    return {
      molecules: molecules.map(({ id, smiles }) => ({ id, smiles })),
      ...pairs,
      skippedMolecules,
      capped: { molecules: inputs.length > rows.length, fragmentations: fragmentationsCapped, pairs: capped },
    };
  } finally {
    queries.cut.delete();
    queries.rotatable.delete();
  }
}

/** Change of a value along a transformation, to minus from, over its pairs. */
export function transformationStatistics(transformation: Transformation, values: ReadonlyMap<number, number>): TransformationStatistics | null {
  const deltas = transformation.pairs.flatMap(({ fromId, toId }) => {
    const from = values.get(fromId);
    const to = values.get(toId);
    return from === undefined || to === undefined ? [] : [to - from];
  });
  if (!deltas.length) return null;
  const mean = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
  const sd = deltas.length > 1
    ? Math.sqrt(deltas.reduce((sum, delta) => sum + (delta - mean) ** 2, 0) / (deltas.length - 1))
    : null;
  return {
    count: deltas.length,
    mean,
    sd,
    min: deltas.reduce((low, delta) => Math.min(low, delta)),
    max: deltas.reduce((high, delta) => Math.max(high, delta)),
  };
}
