import { atomicNumber } from "./elements";
import { readOrcaNmrTables } from "./orca-nmr-spectra";
import { readOrcaOpticalTables } from "./orca-optical-spectra";
import { checkScientificSpectra, type AdditionalSpectrum } from "./scientific-spectra";
import type { ScientificFrame } from "./scientific-types";

export type OrcaSourceSpectrum = { start: number; spectrum: AdditionalSpectrum };

/** Coordinate offsets come from the same parser pass that constructed these frames. */
export function withOrcaSourceSpectra(name: string, text: string, frames: ScientificFrame[], geometryStarts: readonly number[], latestVcd: readonly (OrcaSourceSpectrum | undefined)[]): ScientificFrame[] {
  if (geometryStarts.length !== frames.length || geometryStarts.some((offset, i) => !Number.isSafeInteger(offset) || offset < 0 || offset >= text.length || (i > 0 && offset <= geometryStarts[i - 1]))) throw new Error("ORCA spectral source frames are inconsistent.");
  const tables: OrcaSourceSpectrum[] = latestVcd.filter((table): table is OrcaSourceSpectrum => table !== undefined);
  if (text.includes("CHEMICAL SHIELDING SUMMARY (ppm)")) tables.push(...readOrcaNmrTables(text, frames[0].atoms.map(atom => atomicNumber(atom.element))));
  if (/^(?:[\t ]*)(?:ABSORPTION|CD) SPECTRUM VIA TRANSITION ELECTRIC DIPOLE MOMENTS/m.test(text)) tables.push(...readOrcaOpticalTables(text));
  if (!tables.length) return frames;
  const sets = frames.map(() => new Map<AdditionalSpectrum["kind"], AdditionalSpectrum>());
  let owner = -1;
  for (const table of tables.sort((a, b) => a.start - b.start)) {
    while (owner + 1 < geometryStarts.length && geometryStarts[owner + 1] < table.start) owner++;
    if (owner < 0) throw new Error("ORCA spectrum has no preceding source geometry.");
    sets[owner].set(table.spectrum.kind, table.spectrum);
  }
  return frames.map((frame, frameIndex) => sets[frameIndex].size ? { ...frame,
    spectra: checkScientificSpectra({ kind: "scientific-spectra", version: 1,
      source: { name, format: "orca-output", scope: "frame", frameIndex, frameCount: frames.length },
      atomicNumbers: frame.atoms.map(atom => atomicNumber(atom.element)), spectra: [...sets[frameIndex].values()] }) } : frame);
}
