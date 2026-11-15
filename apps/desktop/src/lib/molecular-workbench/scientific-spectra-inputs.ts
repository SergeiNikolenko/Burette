import { checkScientificSpectra, type AdditionalSpectrum, type ScientificSpectra, type SpectralSource } from "./scientific-spectra";

type RecordValue = Record<string, unknown>;
const MAX_ROWS = 10_000;
function fail(message: string): never { throw new Error(`Invalid source spectra: ${message}`); }
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object.");
  return value as RecordValue;
}
function keys(value: RecordValue, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail("unsupported source quantities must not be silently reinterpreted.");
}
function vector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ROWS) fail("expected 1–10,000 source values.");
  for (const item of value) if (typeof item !== "number" || !Number.isFinite(item)) fail("source values must be finite.");
  return value;
}
function result(source: SpectralSource, format: SpectralSource["format"], atomicNumbers: readonly number[], spectra: AdditionalSpectrum[]) {
  if (source.format !== format) fail("source format does not match its reader.");
  const data = checkScientificSpectra({ kind: "scientific-spectra", version: 1, source, atomicNumbers, spectra });
  return spectra.length ? data : undefined;
}
function denseNmr(values: readonly number[], atomicNumbers: readonly number[]): AdditionalSpectrum {
  if (values.length !== atomicNumbers.length) fail("dense NMR values do not match the source atoms.");
  return { kind: "nmr", quantity: "native-input", atomIndices: values.map((_, i) => i), valuesPpm: values };
}
function columns(value: unknown, minimum: number, maximum: number): readonly (readonly number[])[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ROWS) fail("matrix must list 1–10,000 rows.");
  let width: number | undefined;
  for (const row of value) {
    const numbers = vector(row);
    if (numbers.length < minimum || numbers.length > maximum || (width !== undefined && numbers.length !== width)) fail("unsupported or inconsistent matrix columns.");
    width = numbers.length;
  }
  return value;
}
const column = (rows: readonly (readonly number[])[], index: number) => rows.map(row => row[index]);

/** Project the six native setSpectra matrix keys, not unrelated molecule properties. */
export function readAvogadroSpectra(value: unknown, source: SpectralSource, atomicNumbers: readonly number[]): ScientificSpectra | undefined {
  const input = object(value), spectra: AdditionalSpectrum[] = [];
  let electronic: readonly (readonly number[])[] | undefined;
  for (const [key, kind] of [
    ["VibrationalCD", "vcd"], ["MagneticCD", "mcd"],
    ["Electronic", "electronic"], ["DensityOfStates", "dos"],
  ] as const) {
    if (!(key in input)) continue;
    const rows = columns(input[key], 2, kind === "mcd" || kind === "electronic" ? 3 : 2);
    if (kind === "electronic") electronic = rows;
    const extra = rows[0].length === 3 ? [{ name: kind === "mcd" ? "absorption" : "rotatory strength", unit: null, values: column(rows, 2) }] : [];
    const signal = { positions: column(rows, 0), values: column(rows, 1), valueUnit: null, ...(extra.length ? { auxiliary: extra } : {}) };
    spectra.push(kind === "vcd" || kind === "mcd" ? { kind, xUnit: "cm^-1", ...signal } : { kind, xUnit: "eV", ...signal });
  }
  if ("CircularDichroism" in input) {
    const rows = columns(input.CircularDichroism, 2, 2);
    if (electronic && (rows.length !== electronic.length || rows.some((row, i) => row[0] !== electronic![i][0]))) fail("CD and electronic transitions have different source identities.");
    const useThird = electronic?.[0].length === 3;
    spectra.push({ kind: "ecd", xUnit: "eV", positions: column(rows, 0), values: column(useThird ? electronic! : rows, useThird ? 2 : 1), valueUnit: null,
      ...(useThird ? { auxiliary: [{ name: "native CD signal", unit: null, values: column(rows, 1) }] } : {}) });
  }
  if ("NMR" in input) {
    const rows = columns(input.NMR, 1, 2), nmr = denseNmr(column(rows, 0), atomicNumbers);
    if (rows[0].length === 2) nmr.auxiliary = [{ name: "native weight", unit: null, values: column(rows, 1) }];
    spectra.push(nmr);
  }
  return result(source, "avogadro-matrix", atomicNumbers, spectra);
}

/** CJSON's declared spectra subtree; source atom order comes from its molecule reader. */
export function readCjsonSpectra(value: unknown, source: SpectralSource, atomicNumbers: readonly number[]): ScientificSpectra | undefined {
  const spectra: AdditionalSpectrum[] = [];
  if (value !== undefined) {
    const input = object(value);
    keys(input, ["electronic", "nmr"]);
    if (input.electronic !== undefined) {
      const electronic = object(input.electronic);
      keys(electronic, ["energies", "intensities", "rotation"]);
      const positions = vector(electronic.energies);
      if (electronic.intensities !== undefined) spectra.push({ kind: "electronic", xUnit: "eV", positions, values: vector(electronic.intensities), valueUnit: null });
      if (electronic.rotation !== undefined) spectra.push({ kind: "ecd", xUnit: "eV", positions, values: vector(electronic.rotation), valueUnit: null });
      if (electronic.intensities === undefined && electronic.rotation === undefined) fail("electronic energies have no source signal.");
    }
    if (input.nmr !== undefined) {
      const nmr = object(input.nmr); keys(nmr, ["shifts"]);
      // The native field name alone does not establish a physical reference.
      spectra.push(denseNmr(vector(nmr.shifts), atomicNumbers));
    }
  }
  return result(source, "cjson", atomicNumbers, spectra);
}

/** The pinned Avogadro QCSchema property extensions, retaining the original x units. */
export function readQcschemaSpectra(value: unknown, source: SpectralSource, atomicNumbers: readonly number[]): ScientificSpectra | undefined {
  const spectra: AdditionalSpectrum[] = [];
  if (value !== undefined) {
    const input = object(value);
    if (input.excited_states !== undefined) {
      const excited = object(input.excited_states);
      keys(excited, ["units", "transition_energies", "intensities"]);
      const xUnit = excited.units === undefined ? "nm" : excited.units;
      if (xUnit !== "nm" && xUnit !== "cm^-1" && xUnit !== "eV") fail("unsupported excitation energy units.");
      spectra.push({ kind: "electronic", xUnit, positions: vector(excited.transition_energies), values: vector(excited.intensities), valueUnit: null });
    }
    if (input.nmr_shifts !== undefined) {
      const nmr = object(input.nmr_shifts); keys(nmr, ["isotropic"]);
      spectra.push(denseNmr(vector(nmr.isotropic), atomicNumbers));
    }
  }
  return result(source, "qcschema", atomicNumbers, spectra);
}
