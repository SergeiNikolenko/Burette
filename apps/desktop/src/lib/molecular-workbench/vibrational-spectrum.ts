import type { CartesianHessian } from "./hessian";
import type { ScientificDocument, VibrationalMode } from "./quantum";
import type { MolecularAtom } from "./types";

/** Where a saved spectrum or Hessian came from: the file, its format and the geometry (one-based frame, or the final one). */
export type SpectrumProvenance = { sourceName: string; format: ScientificDocument["format"]; frame: number | null; frameCount: number };

/**
 * Columns of a saved spectrum, each with its unit. A missing value is empty in CSV and
 * null in JSON, never 0. Raman activity is a computed scattering activity, not a measured
 * intensity; the transition dipole is ORCA's T² in the atomic units it prints.
 */
const COLUMNS = [
  { csv: "mode", json: "mode", unit: "source numbering", value: (mode: VibrationalMode) => mode.index },
  { csv: "frequency_cm-1", json: "frequencyCm1", unit: "cm^-1 (negative: imaginary)", value: (mode: VibrationalMode) => mode.frequencyCm1 },
  { csv: "symmetry", json: "symmetry", unit: "irreducible representation", value: (mode: VibrationalMode) => mode.symmetry },
  { csv: "ir_intensity_km/mol", json: "irIntensityKmMol", unit: "km/mol", value: (mode: VibrationalMode) => mode.intensityKmMol },
  { csv: "transition_dipole_squared_au", json: "transitionDipoleSquaredAu", unit: "atomic units", value: (mode: VibrationalMode) => mode.transitionDipoleSquared },
  { csv: "raman_activity_A^4/amu", json: "ramanActivityAngstrom4Amu", unit: "angstrom^4/amu", value: (mode: VibrationalMode) => mode.ramanActivityAngstrom4Amu },
  { csv: "raman_depolarization_plane", json: "ramanDepolarizationPlane", unit: "dimensionless, plane-polarized incident light", value: (mode: VibrationalMode) => mode.ramanDepolarizationRatio },
  { csv: "raman_depolarization_unpolarized", json: "ramanDepolarizationUnpolarized", unit: "dimensionless, unpolarized incident light", value: (mode: VibrationalMode) => mode.ramanDepolarizationRatioUnpolarized },
  { csv: "reduced_mass_amu", json: "reducedMassAmu", unit: "amu", value: (mode: VibrationalMode) => mode.reducedMassAmu },
  { csv: "force_constant_mdyn/A", json: "forceConstantMdynAngstrom", unit: "mDyne/angstrom", value: (mode: VibrationalMode) => mode.forceConstantMdynAngstrom },
] as const;

function geometry(provenance: SpectrumProvenance) {
  return provenance.frame === null ? "final geometry" : `frame ${provenance.frame} of ${provenance.frameCount}`;
}

// One line per header field: a file name cannot start a new CSV row.
const oneLine = (text: string) => text.replace(/\p{Cc}+/gu, " ");

function csvCell(value: string | number | undefined) {
  if (value === undefined) return "";
  // String(number) is the shortest text that reads back as the same double.
  const text = String(value);
  // Irreps such as A" carry a quote.
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** Every mode of the geometry, in source order, with `#` header lines naming the source and units. */
export function spectrumCsv(modes: readonly VibrationalMode[], provenance: SpectrumProvenance) {
  const lines = [
    `# source: ${oneLine(provenance.sourceName)}`,
    `# format: ${provenance.format}`,
    `# geometry: ${geometry(provenance)}`,
    `# units: ${COLUMNS.map((column) => `${column.csv} = ${column.unit}`).join("; ")}`,
    COLUMNS.map((column) => column.csv).join(","),
    ...modes.map((mode) => COLUMNS.map((column) => csvCell(column.value(mode))).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

export function spectrumJson(modes: readonly VibrationalMode[], provenance: SpectrumProvenance) {
  return `${JSON.stringify({
    kind: "vibrational-spectrum",
    source: { name: provenance.sourceName, format: provenance.format, frame: provenance.frame, frameCount: provenance.frameCount },
    units: Object.fromEntries(COLUMNS.map((column) => [column.json, column.unit])),
    modes: modes.map((mode) => Object.fromEntries(COLUMNS.map((column) => [column.json, column.value(mode) ?? null]))),
  }, null, 2)}\n`;
}

/** The full matrix, row by row, with the atoms (Å) and masses (amu) its rows and columns refer to. */
export function hessianJson(hessian: CartesianHessian, atoms: readonly MolecularAtom[], provenance: SpectrumProvenance) {
  const rows = Array.from({ length: hessian.dimension }, (_, row) => Array.from(hessian.values.subarray(row * hessian.dimension, (row + 1) * hessian.dimension)));
  return `${JSON.stringify({
    kind: "cartesian-hessian",
    source: { name: provenance.sourceName, format: provenance.format, frame: provenance.frame, frameCount: provenance.frameCount },
    units: hessian.units,
    order: "atom-major; x, y, z of atom 1, then atom 2, ...",
    atoms: atoms.map(({ element, x, y, z }) => ({ element, xAngstrom: x, yAngstrom: y, zAngstrom: z })),
    massesAmu: hessian.massesAmu ?? null,
    dimension: hessian.dimension,
    matrix: rows,
  })}\n`;
}

export type LineShape = "gaussian" | "lorentzian";
export const MAX_BROADENED_POINTS = 2000;

/**
 * Sticks broadened into a curve sampled at `points` evenly spaced wavenumbers from `fromCm1`
 * to `toCm1`. Each stick at `scale × ν` becomes a line of full width at half maximum
 * `fwhmCm1` with unit area, so the curve is in the sticks' unit per cm⁻¹ and integrates to
 * their sum (Gaussian: 2·√(ln2/π)/w · exp(−4 ln2 x²/w²); Lorentzian: (w/2π)/(x² + w²/4)).
 */
export function broadenSpectrum(sticks: readonly { frequencyCm1: number; value: number }[], shape: LineShape, fwhmCm1: number, scale: number, fromCm1: number, toCm1: number, points: number) {
  if (!Number.isFinite(fwhmCm1) || fwhmCm1 <= 0 || !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(fromCm1) || !Number.isFinite(toCm1) || toCm1 <= fromCm1) {
    throw new Error("Broadening needs a positive width and scale and an increasing range.");
  }
  if (!Number.isInteger(points) || points < 2 || points > MAX_BROADENED_POINTS) throw new Error(`Broadened spectra have 2 to ${MAX_BROADENED_POINTS} points.`);
  const wavenumbers = new Float64Array(points);
  const values = new Float64Array(points);
  const step = (toCm1 - fromCm1) / (points - 1);
  const gaussianHeight = 2 * Math.sqrt(Math.LN2 / Math.PI) / fwhmCm1;
  const gaussianExponent = -4 * Math.LN2 / (fwhmCm1 * fwhmCm1);
  const halfWidth = fwhmCm1 / 2;
  for (let index = 0; index < points; index++) {
    const at = fromCm1 + index * step;
    let sum = 0;
    for (const { frequencyCm1, value } of sticks) {
      const offset = at - scale * frequencyCm1;
      sum += value * (shape === "gaussian" ? gaussianHeight * Math.exp(gaussianExponent * offset * offset) : halfWidth / Math.PI / (offset * offset + halfWidth * halfWidth));
    }
    wavenumbers[index] = at;
    values[index] = sum;
  }
  return { wavenumbers, values };
}
