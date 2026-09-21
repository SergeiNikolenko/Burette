export function molstarContextEntryExtension(format: string | undefined) {
  const value = String(format || "pdb").toLowerCase();
  if (value === "cif" || value === "mmcif" || value === "mcif") return "cif";
  if (value === "sd") return "sdf";
  return value || "pdb";
}
