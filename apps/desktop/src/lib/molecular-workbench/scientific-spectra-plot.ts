import { checkScientificSpectra, type AdditionalSpectrumKind, type ScientificSpectra } from "./scientific-spectra";

export type SpectralPlotSelection = { kind: Exclude<AdditionalSpectrumKind, "nmr"> } | { kind: "nmr"; atomicNumber: number };
export type SpectralPlotOptions = { scale: number; offset: number; fwhm: number; axisStart: number; axisEnd: number };
const float = Math.fround;
const MAX_POINTS = 200_000, MAX_EVALUATIONS = 100_000_000;
const PRESETS = {
  vcd: [0, 4000, 30], mcd: [10000, 75000, 99.99],
  electronic: [5, 1, 0.1], ecd: [5, 1, 0.1], dos: [-50, 50, 0.1],
} as const;
// The approximate references authored by Avogadro; no isotope/calibration inference.
// Negative ranges and out-of-widget references require the documented range repair.
const NMR: Readonly<Record<number, readonly [number, number, number]>> = {
  1: [12, 0, 31.876], 3: [-16, 11, 0], 5: [100, -120, 109.774],
  6: [200, 0, 192.038], 7: [800, 0, -106.738], 8: [1600, -50, 347.782],
  9: [60, -300, 206.735], 14: [50, -200, 400.876], 15: [250, -250, 392.841],
};

export function spectralPlotDefaults(selection: SpectralPlotSelection): SpectralPlotOptions {
  if (selection.kind === "nmr") {
    if (!Number.isInteger(selection.atomicNumber) || selection.atomicNumber < 1 || selection.atomicNumber > 118) throw new Error("Choose an NMR source element.");
    const [axisStart, axisEnd, offset] = NMR[selection.atomicNumber] ?? [100, -100, 0];
    return { scale: 1, offset, fwhm: 0.1, axisStart, axisEnd };
  }
  const preset = PRESETS[selection.kind];
  if (!preset) throw new Error("Unknown scientific spectrum type.");
  return { scale: 1, offset: 0, fwhm: preset[2], axisStart: preset[0], axisEnd: preset[1] };
}

const roundIndex = (value: number) => value < 0 ? -Math.round(-value) : Math.round(value);

/**
 * Peak-height Gaussian/nearest-grid display for all six additional spectra.
 * Float32 operations follow the pinned Avogadro kernel. Signed indices repair
 * its negative-range loss; output is half-open and retains requested direction.
 * Native eV/ppm grids have step0.01; VCD/MCD cm^-1 and DOS eV grids have step1.
 * Source values, units, auxiliary columns and NMR atom identities stay unchanged.
 */
export function plotScientificSpectrum(data: ScientificSpectra, selection: SpectralPlotSelection, options = spectralPlotDefaults(selection)) {
  checkScientificSpectra(data);
  const spectrum = data.spectra.find(item => item.kind === selection.kind);
  if (!spectrum) throw new Error("The source does not contain this spectrum.");
  const { scale, offset, fwhm, axisStart, axisEnd } = options;
  if (![scale, offset, fwhm, axisStart, axisEnd].every(value => Number.isFinite(float(value))) || scale <= 0 || float(scale) <= 0 || fwhm < 0.01) {
    throw new Error("Spectrum display needs finite axes, a positive scale and FWHM of at least0.01.");
  }
  const fine = selection.kind === "nmr" || selection.kind === "electronic" || selection.kind === "ecd";
  const xScale = fine ? float(1 / float(0.01)) : 1;
  const first = roundIndex(float(Math.min(float(axisStart), float(axisEnd)) * xScale));
  const end = roundIndex(float(Math.max(float(axisStart), float(axisEnd)) * xScale));
  const count = end - first;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(end) || Math.abs(first) > 2 ** 24 || Math.abs(end) > 2 ** 24 || count < 1 || count > MAX_POINTS) {
    throw new Error("Spectrum display exceeds the bounded signed grid; it is never silently resampled.");
  }
  let rowIndices: number[], sourcePositions: readonly number[], sourceValues: readonly number[];
  let xUnit: "ppm" | "eV" | "cm^-1", sourceAtomIndices: number[] | null = null;
  if (spectrum.kind === "nmr") {
    if (selection.kind !== "nmr" || !Number.isInteger(selection.atomicNumber) || selection.atomicNumber < 1 || selection.atomicNumber > 118) throw new Error("Choose an NMR source element.");
    rowIndices = spectrum.atomIndices.flatMap((atom, row) => data.atomicNumbers[atom] === selection.atomicNumber ? [row] : []);
    if (rowIndices.length === 0) throw new Error("No NMR source values exist for this element.");
    sourceAtomIndices = rowIndices.map(row => spectrum.atomIndices[row]);
    sourcePositions = rowIndices.map(row => spectrum.valuesPpm[row]);
    sourceValues = rowIndices.map(() => 1); // Display weight, not a synthesized source measurement.
    xUnit = "ppm";
  } else {
    rowIndices = spectrum.positions.map((_, index) => index);
    sourcePositions = spectrum.positions;
    sourceValues = spectrum.values;
    xUnit = spectrum.kind === "vcd" || spectrum.kind === "mcd" ? "cm^-1" : "eV";
  }
  if (count * sourcePositions.length > MAX_EVALUATIONS) throw new Error("Spectrum display exceeds the bounded evaluation budget.");
  const signedScale = selection.kind === "nmr" ? -float(scale) : float(scale);
  const peaks = sourcePositions.map((position, index) => {
    // Reader conversions are double precision; only the native plot input casts to float.
    if (spectrum.kind !== "nmr" && spectrum.xUnit === "nm") position = 1239.841984 / position;
    else if (spectrum.kind !== "nmr" && spectrum.xUnit === "cm^-1" && xUnit === "eV") position /= 8065.544;
    const center = float(float(float(position) - float(offset)) / signedScale), value = float(sourceValues[index]);
    if (!Number.isFinite(center) || !Number.isFinite(value)) throw new Error("Source quantities exceed the finite Float32 display range.");
    return { center, value };
  });
  const sigma = float(float(fwhm) / float(2 * Math.sqrt(2 * Math.log(2))));
  const denominator = float(float(2 * sigma) * sigma);
  if (!Number.isFinite(denominator) || denominator <= 0) throw new Error("Spectrum width exceeds the finite display range.");
  const positions = new Float32Array(count), smoothed = new Float32Array(count), raw = new Float32Array(count);
  const halfStep = float(1 / xScale) / 2;
  for (let index = 0; index < count; index++) {
    const x = float(float(first + index) / xScale);
    let smooth = 0, stick = 0;
    for (const peak of peaks) {
      const delta = float(x - peak.center), exponent = float(-float(delta * delta) / denominator);
      smooth = float(smooth + float(peak.value * float(Math.exp(exponent))));
      if (Math.abs(delta) < halfStep) stick = float(stick + peak.value);
    }
    if (!Number.isFinite(smooth) || !Number.isFinite(stick)) throw new Error("Spectrum display overflows the finite range.");
    positions[index] = x; smoothed[index] = smooth; raw[index] = stick;
  }
  const settings = {
    kind: "scientific-spectrum-display-settings" as const, version: 1 as const,
    arithmetic: "float32-peak-height" as const,
    source: { ...data.source }, selection: { ...selection },
    sourceXUnit: spectrum.kind === "nmr" ? "ppm" : spectrum.xUnit, displayXUnit: xUnit,
    parameters: { scale, offset, fwhm, axisStart, axisEnd },
    nmr: spectrum.kind === "nmr" ? { sourceQuantity: spectrum.quantity, referencePpm: offset, formula: "(referencePpm-sourcePpm)/scale" } : null,
  };
  return { positions, smoothed, raw, xUnit, axisStart, axisEnd, sourceRowIndices: rowIndices, sourceAtomIndices, peaks, settings };
}

/** Small file export of the actual display settings, separate from raw source exports. */
export function spectralPlotSettingsJson(plot: Pick<ReturnType<typeof plotScientificSpectrum>, "settings">) {
  return `${JSON.stringify(plot.settings, null, 2)}\n`;
}
