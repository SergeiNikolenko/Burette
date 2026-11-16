export type ResidueChirality = "L" | "D";
export type PeptideOptions = {
  chirality?: ResidueChirality | ResidueChirality[];
  nTerminus?: "amine" | "acetyl";
  cTerminus?: "acid" | "amide";
};

// Neutral residue graphs, canonical proteinogenic side chains. Backbone L alpha
// centers use @@ in N[C@@H](sidechain)C(=O) order; Cys is consequently R.
// Ile is (2S,3S), Thr (2S,3R); D mirrors every residue stereocenter.
// Reference stereochemistry: PubChem CIDs 5950 (L-Ala), 5862 (L-Cys),
// 6288 (L-Thr), 6306 (L-Ile), verified against OCL absolute CIP assignments.
const residues: Record<string, { name: string; side: string; atoms: number }> = {
  A: { name: "Alanine", side: "C", atoms: 10 },
  R: { name: "Arginine", side: "CCCNC(=N)N", atoms: 23 },
  N: { name: "Asparagine", side: "CC(=O)N", atoms: 14 },
  D: { name: "Aspartate", side: "CC(=O)O", atoms: 13 },
  C: { name: "Cysteine", side: "CS", atoms: 11 },
  E: { name: "Glutamate", side: "CCC(=O)O", atoms: 16 },
  Q: { name: "Glutamine", side: "CCC(=O)N", atoms: 17 },
  G: { name: "Glycine", side: "", atoms: 7 },
  H: { name: "Histidine", side: "Cc1cnc[nH]1", atoms: 17 },
  I: { name: "Isoleucine", side: "[C@@H](C)CC", atoms: 19 },
  L: { name: "Leucine", side: "CC(C)C", atoms: 19 },
  K: { name: "Lysine", side: "CCCCN", atoms: 21 },
  M: { name: "Methionine", side: "CCSC", atoms: 17 },
  F: { name: "Phenylalanine", side: "Cc1ccccc1", atoms: 20 },
  P: { name: "Proline", side: "CCC1", atoms: 14 },
  S: { name: "Serine", side: "CO", atoms: 11 },
  T: { name: "Threonine", side: "[C@H](O)C", atoms: 14 },
  W: { name: "Tryptophan", side: "Cc1c[nH]c2ccccc12", atoms: 24 },
  Y: { name: "Tyrosine", side: "Cc1ccc(O)cc1", atoms: 21 },
  V: { name: "Valine", side: "C(C)C", atoms: 16 },
};

export const PEPTIDE_RESIDUES = Object.entries(residues).map(([code, { name }]) => ({ code, name }));

export function buildPeptideSmiles(sequence: string, options: PeptideOptions = {}): string {
  const compact = sequence.replace(/\s+/g, ""), codes = compact.toUpperCase();
  if (!/^[A-Za-z]+$/.test(compact) || codes.length > 64 || [...codes].some(code => !residues[code])) throw new Error("Use 1–64 standard amino-acid one-letter codes.");
  const chirality = options.chirality ?? "L";
  const stereos = Array.isArray(chirality) ? chirality : [...codes].map(() => chirality);
  if (stereos.length !== codes.length || Array.from(stereos).some(value => value !== "L" && value !== "D")) throw new Error("Specify L or D for each residue.");
  const nTerminus = options.nTerminus ?? "amine", cTerminus = options.cTerminus ?? "acid";
  if (!["amine", "acetyl"].includes(nTerminus) || !["acid", "amide"].includes(cTerminus)) throw new Error("Unsupported peptide terminal group.");
  const atomCount = [...codes].reduce((sum, code) => sum + residues[code].atoms, 3) + (nTerminus === "acetyl" ? 5 : 0) + (cTerminus === "amide" ? 1 : 0);
  if (atomCount > 256) throw new Error("The peptide exceeds the browser limit of 256 atoms including hydrogens.");
  const fragments = [...codes].map((code, index) => {
    const fragment = code === "G" ? "NCC(=O)" : `${code === "P" ? "N1" : "N"}[C@@H](${residues[code].side})C(=O)`;
    return stereos[index] === "D" ? fragment.replace(/@@|@/g, value => value === "@@" ? "@" : "@@") : fragment;
  });
  return `${nTerminus === "acetyl" ? "CC(=O)" : ""}${fragments.join("")}${cTerminus === "acid" ? "O" : "N"}`;
}
