import type { ScientificSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import { waterScience, XYZ } from "./scientific-data-fixture";

/** Authored schema cases, not measured quantum results or a six-type QC reference. */
export function frameSpectra(frameIndex: number, frameCount = 2): ScientificSpectra {
  return { kind: "scientific-spectra", version: 1, source: { name: "authored-source-matrices", format: "avogadro-matrix", scope: "frame", frameIndex, frameCount },
    atomicNumbers: [8, 1, 1], spectra: [
      { kind: "vcd", xUnit: "cm^-1", positions: [-24, 1648.2], values: [-0.002, 0.015], valueUnit: null, sourceRowIds: ["5", "6"] },
      { kind: "mcd", xUnit: "cm^-1", positions: [15000, 22000], values: [-2.5, 3.25], valueUnit: null, auxiliary: [{ name: "absorption", unit: null, values: [0.2, 0.7] }] },
      { kind: "nmr", quantity: "native-input", atomIndices: [2, 0], valuesPpm: [20.125 + frameIndex, -35.25] },
      { kind: "electronic", xUnit: "nm", positions: [250, 310], values: [0.1, 0.3], valueUnit: null, sourceRowIds: ["0-1A -> 1-1A", "0-1A -> 2-1A"] },
      { kind: "ecd", xUnit: "eV", positions: [4.96, 4], values: [-4.2, 1.1], valueUnit: "source declared unit" },
      { kind: "dos", xUnit: "eV", positions: [-3, 2], values: [1.25, 0.25], valueUnit: null },
    ] };
}
export function spectralDocument() {
  const atoms = waterScience().atoms, second = atoms.map(atom => ({ ...atom, x: atom.x + 0.25 }));
  const spectra = frameSpectra(0);
  spectra.source = { name: "file-scoped-property-source", format: "avogadro-matrix", scope: "file" };
  spectra.spectra = spectra.spectra.filter(signal => signal.kind === "dos");
  const document: ScientificDocument = { format: "orca", atoms, modes: [], orbitals: [], spectra,
    frames: [{ atoms, spectra: frameSpectra(0) }, { atoms: second, spectra: frameSpectra(1) }] };
  const text = XYZ + `3\nsecond source frame\n${second.map(atom => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join("\n")}\n`;
  return { document, text };
}
