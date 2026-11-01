import { writeExtendedXyz, type CrystalFormat } from "./molecular-workbench/crystal-io";
import { runReaderTask } from "./workbench/reader-task";

// Small-molecule CIF lists fractional sites (DDL1 `_atom_site_fract_x` or DDLm
// `_atom_site.fract_x`); macromolecular mmCIF never does and keeps its own route.
const FRACTIONAL_SITES = /^\s*_atom_site[._]fract_[xyz]\b/imu;

function crystalFormat(extension: string, text: string): CrystalFormat | null {
  if (extension === "vasp") return "vasp";
  return (extension === "cif" || extension === "mcif" || extension === "mmcif") && FRACTIONAL_SITES.test(text) ? "cif" : null;
}

/**
 * What the viewer shows of a crystal file: its full P1 cell with whole molecules, as
 * extended XYZ with the exact Lattice, so Mol* draws the unit cell and every bond. A
 * CIF the crystal reader refuses (partial occupancy, disorder, ambiguous elements)
 * returns null and keeps the ordinary asymmetric-unit preview.
 */
export async function crystalPreviewData(text: string, extension: string) {
  const format = crystalFormat(extension, text);
  if (!format) return null;
  try {
    const view = await runReaderTask({ action: "crystal", format, text });
    return { bytes: new TextEncoder().encode(writeExtendedXyz(view.atoms, view.cell, view.title)), molstarFormat: "xyz" as const };
  } catch {
    return null;
  }
}
