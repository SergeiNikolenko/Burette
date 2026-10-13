// Coordinate-only PDB needs chemical perception before entering an editor.
// Keep the conversion bounded and reject changes to the selected atom set.
export function validatePdbMolecule(text: string) {
  if (text.length > 512 * 1024) throw new Error("Select a molecule with at most 300 atoms.");
  const lines = text.split(/\r?\n/u);
  if (lines.filter(line => line.startsWith("MODEL ")).length > 1) {
    throw new Error("Select one model before opening the molecule in Ketcher.");
  }
  const atoms = lines.filter(line => /^(ATOM  |HETATM)/u.test(line)).map(line => ({
    serial: Number(line.slice(6, 11)),
    element: line.slice(76, 78).trim().toUpperCase(),
    position: [30, 38, 46].map(offset => line.slice(offset, offset + 8).trim() ? Number(line.slice(offset, offset + 8)) : NaN),
    alternate: line.slice(16, 17).trim(),
  }));
  if (!atoms.length || atoms.length > 300 || atoms.some(atom => atom.position.some(value => !Number.isFinite(value)))) {
    throw new Error("Select a molecule with 1–300 atoms and valid coordinates.");
  }
  if (new Set(atoms.map(atom => atom.serial)).size !== atoms.length || atoms.some(atom => atom.alternate)) {
    throw new Error("Select a single conformation before opening the molecule in Ketcher.");
  }
  return atoms;
}

export function validatePdbConversion(pdb: string, sdf: string) {
  const atoms = validatePdbMolecule(pdb);
  const lines = sdf.replace(/\r\n?/gu, "\n").split("\n");
  const count = Number(lines[3]?.slice(0, 3));
  const bonds = Number(lines[3]?.slice(3, 6));
  if (!lines[3]?.includes("V2000") || count !== atoms.length || !Number.isInteger(bonds) || bonds < 0 || bonds > 999
    || lines.length < 5 + count + bonds || !lines.slice(4 + count + bonds).includes("M  END") || lines.filter(line => line === "$$$$").length !== 1) {
    throw new Error("Could not reconstruct the selected molecule's bonds.");
  }
  for (let i = 0; i < count; i++) {
    const line = lines[4 + i] ?? "";
    const coordinates = [0, 10, 20].map(offset => Number(line.slice(offset, offset + 10)));
    if ((atoms[i].element && line.slice(31, 34).trim().toUpperCase() !== atoms[i].element)
      || coordinates.some((value, axis) => !Number.isFinite(value) || Math.abs(value - atoms[i].position[axis]) > 0.001)) {
      throw new Error("Molecule conversion changed the selected atoms or coordinates.");
    }
  }
  for (const line of lines.slice(4 + count, 4 + count + bonds)) {
    const [a, b, order] = [0, 3, 6].map(offset => Number(line.slice(offset, offset + 3)));
    if (![a, b, order].every(Number.isInteger) || a < 1 || b < 1 || a > count || b > count || a === b || order < 1 || order > 4) {
      throw new Error("Molecule conversion returned an invalid bond.");
    }
  }
  return sdf;
}
