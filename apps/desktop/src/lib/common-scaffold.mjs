// The fragment a set of molecules all contain, folded pairwise: MCS of the
// first two, then MCS of that against the third, and so on. openchemlib's MCS
// answers two molecules at a time, and the running query only ever shrinks, so
// the fold is both correct and cheaper as it goes.
export function foldCommonScaffold(ocl, molecules) {
  if (molecules.length < 2) return null;
  let common = molecules[0];
  for (let index = 1; index < molecules.length; index += 1) {
    const search = new ocl.MCS();
    search.set(common, molecules[index]);
    const next = search.getMCS();
    if (!next || next.getAllAtoms() === 0) return null;
    common = next;
  }
  return common;
}

// Parses whichever of the two forms a grid row carries. A row that parses in
// neither is skipped rather than failing the whole search: one bad SMILES in a
// lasso of fifty should not cost the answer.
export function scaffoldMoleculesFromRows(ocl, rows) {
  return rows.flatMap((row) => {
    // Trimmed only to ask whether there is anything there: a molfile's first
    // line is its name and is usually blank, so trimming what gets parsed
    // shifts the header block and yields an empty molecule.
    const hasMolblock = typeof row.molblock === "string" && row.molblock.trim() !== "";
    const smiles = typeof row.smiles === "string" ? row.smiles.trim() : "";
    try {
      if (hasMolblock) return [ocl.Molecule.fromMolfile(row.molblock)];
      if (smiles) return [ocl.Molecule.fromSmiles(smiles)];
    } catch {
      return [];
    }
    return [];
  });
}
