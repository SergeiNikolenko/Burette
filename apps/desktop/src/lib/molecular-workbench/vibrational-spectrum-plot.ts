import type { VibrationalMode } from "./scientific-types";

export type VibrationalPlotKind = "ir" | "raman";
export type VibrationalPlotOptions = { scale: number; offsetCm1: number; fwhmCm1: number; axisStartCm1: number; axisEndCm1: number };

/** Display defaults; raw source quantities and exported spectra are never transformed. */
export const VIBRATIONAL_PLOT_DEFAULTS: Readonly<Record<VibrationalPlotKind, Readonly<VibrationalPlotOptions>>> = {
  ir: { scale: 1, offsetCm1: 0, fwhmCm1: 30, axisStartCm1: 4000, axisEndCm1: 400 },
  raman: { scale: 1, offsetCm1: 0, fwhmCm1: 30, axisStartCm1: 0, axisEndCm1: 4000 },
};

// Bounds are checked before allocation; do not silently coarsen the 1 cm^-1 grid.
const MAX_POINTS = 20_000;
const MAX_EVALUATIONS = 20_000_000;
const float = Math.fround;

/**
 * Gaussian peak-height display, sampled at integer cm^-1, upper endpoint excluded.
 * Centers are (source frequency - offset) / scale; FWHM is in displayed cm^-1.
 * IR uses the conventional display transform 100 * (1 - sum / 125), not a physical
 * transmittance prediction. Overlap may give negative display values; never clamp.
 * Raman retains source activity units. Both arrays follow increasing wavenumber;
 * axisStart/End retain the requested display direction. Raw sticks use the same
 * center transformation and a strict half-grid-width membership test.
 */
export function plotVibrationalSpectrum(modes: readonly VibrationalMode[], kind: VibrationalPlotKind, options: VibrationalPlotOptions = VIBRATIONAL_PLOT_DEFAULTS[kind]) {
  const { scale, offsetCm1, fwhmCm1, axisStartCm1, axisEndCm1 } = options;
  if (![scale, offsetCm1, fwhmCm1, axisStartCm1, axisEndCm1].every((value) => Number.isFinite(float(value))) || scale <= 0 || float(scale) <= 0 || fwhmCm1 < 0.01 || axisStartCm1 < 0 || axisEndCm1 < 0) {
    throw new Error("Spectrum display needs finite nonnegative axes, a positive scale and FWHM of at least 0.01 cm^-1.");
  }
  const start = Math.round(Math.min(float(axisStartCm1), float(axisEndCm1)));
  const end = Math.round(Math.max(float(axisStartCm1), float(axisEndCm1)));
  const count = end - start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || count < 1 || count > MAX_POINTS || modes.length > 10_000 || count * modes.length > MAX_EVALUATIONS || end > 2 ** 24) {
    throw new Error("Spectrum display exceeds the bounded integer-wavenumber grid or evaluation budget.");
  }
  const peaks = modes.map((mode) => {
    const value = kind === "ir" ? mode.intensityKmMol : mode.ramanActivityAngstrom4Amu;
    if (value === undefined || value < 0 || !Number.isFinite(float(value)) || !Number.isFinite(float(mode.frequencyCm1))) {
      throw new Error("Every mode must carry a finite source quantity for this spectrum; missing intensities are not zero.");
    }
    const center = float(float(float(mode.frequencyCm1) - float(offsetCm1)) / float(scale));
    if (!Number.isFinite(center)) throw new Error("The transformed spectrum frequency is not finite.");
    return { center, value: float(value) };
  });
  const sigma = float(float(fwhmCm1) / float(2 * Math.sqrt(2 * Math.log(2))));
  const denominator = float(float(2 * sigma) * sigma);
  if (!Number.isFinite(denominator) || denominator <= 0) throw new Error("Spectrum width exceeds the numerical display range.");
  const wavenumbers = new Float32Array(count), smoothed = new Float32Array(count), raw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = start + i;
    let smooth = 0, stick = 0;
    for (const peak of peaks) {
      const delta = float(x - peak.center);
      const exponent = float(-float(delta * delta) / denominator);
      smooth = float(smooth + float(peak.value * float(Math.exp(exponent))));
      if (Math.abs(delta) < 0.5) stick = float(stick + peak.value);
    }
    if (!Number.isFinite(smooth) || !Number.isFinite(stick)) throw new Error("Spectrum intensities overflow the display range.");
    wavenumbers[i] = x;
    smoothed[i] = kind === "ir" ? float(float(1 - smooth / 125) * 100) : smooth;
    raw[i] = kind === "ir" ? float(float(1 - stick / 100) * 100) : stick;
    if (!Number.isFinite(smoothed[i]) || !Number.isFinite(raw[i])) throw new Error("Spectrum display transformation overflows the finite range.");
  }
  return { wavenumbers, smoothed, raw, axisStartCm1, axisEndCm1 };
}
