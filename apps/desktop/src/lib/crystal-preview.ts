import { periodicCrystalFormat, writeExtendedXyz } from "./molecular-workbench/crystal-io";
import { runReaderTask } from "./workbench/reader-task";

/**
 * What the viewer shows of a crystal file: its full P1 cell with whole molecules, as
 * extended XYZ with the exact Lattice, so Mol* draws the unit cell and every bond. A
 * CIF the crystal reader refuses (partial occupancy, disorder, ambiguous elements)
 * returns null and keeps the ordinary asymmetric-unit preview.
 */
export async function crystalPreviewData(text: string, extension: string) {
  // An extended XYZ already reaches the viewer with its Lattice.
  const format = periodicCrystalFormat(extension, text);
  if (!format || format === "xyz") return null;
  try {
    const view = await runReaderTask({ action: "crystal", format, text });
    return { bytes: new TextEncoder().encode(writeExtendedXyz(view.atoms, view.cell, view.title)), molstarFormat: "xyz" as const };
  } catch {
    return null;
  }
}
