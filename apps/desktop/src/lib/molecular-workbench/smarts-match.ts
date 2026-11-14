import type { MainModule as RDKitModule } from "@rdkit/rdkit";

/**
 * Atoms of `molfile` matched by any occurrence of `smarts`, in molfile order.
 * Hydrogens stay explicit so the indices are the file's own atom numbers.
 */
export function smartsMatchAtoms(rdkit: RDKitModule, molfile: string, smarts: string): number[] {
  const pattern = smarts.trim();
  if (!pattern) throw new Error("Enter a SMARTS pattern.");
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }));
  if (!mol) throw new Error("The structure could not be read.");
  try {
    let query: ReturnType<RDKitModule["get_qmol"]> | null = null;
    try { query = rdkit.get_qmol(pattern); } catch { query = null; }
    if (!query) throw new Error("This is not a valid SMARTS pattern.");
    try {
      const matches = JSON.parse(mol.get_substruct_matches(query)) as unknown;
      const atoms = Array.isArray(matches) ? matches.flatMap((match: { atoms?: number[] }) => match.atoms ?? []) : [];
      return [...new Set(atoms)].sort((a, b) => a - b);
    } finally { query.delete(); }
  } finally { mol.delete(); }
}
