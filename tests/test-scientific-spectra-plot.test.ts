import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { scientificSpectraJson, type AdditionalSpectrum, type ScientificSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
import { plotScientificSpectrum, spectralPlotDefaults, spectralPlotSettingsJson, type SpectralPlotOptions, type SpectralPlotSelection } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra-plot";

type Golden = { name: string; data: ScientificSpectra; selection: SpectralPlotSelection; options: SpectralPlotOptions; rows: number[][] };
const golden: Golden[] = JSON.parse(readFileSync(new URL("./fixtures/quantum/scientific-spectra-golden.json", import.meta.url), "utf8"));
const data = (spectrum: AdditionalSpectrum, atomicNumbers: number[] = []): ScientificSpectra => ({
  kind: "scientific-spectra", version: 1, source: { name: "explicit source data", format: "avogadro-matrix", scope: "file" }, atomicNumbers, spectra: [spectrum],
});
const dos = () => data({ kind: "dos", xUnit: "eV", positions: [-3], values: [2], valueUnit: "states/eV" });

for (const reference of golden) test(`pinned positive C++ entire grid: ${reference.name}`, () => {
  const before = scientificSpectraJson(reference.data);
  const result = plotScientificSpectrum(reference.data, reference.selection, reference.options);
  expect(result.positions).toEqual(Float32Array.from(reference.rows.map(row => row[0])));
  for (const [column, actual] of [[1, result.smoothed], [2, result.raw]] as const) {
    const errors = Array.from(actual, (value, index) => Math.abs(value - reference.rows[index][column]) / Math.max(1, Math.abs(reference.rows[index][column])));
    expect(Math.max(...errors)).toBeLessThan(2e-6);
  }
  expect(result.settings.parameters).toEqual(reference.options);
  expect(scientificSpectraJson(reference.data)).toBe(before);
});

test("signed DOS keeps negative energies, source peak height, FWHM and half-open endpoint", () => {
  const settings = { ...spectralPlotDefaults({ kind: "dos" }), fwhm: 2, axisStart: 1, axisEnd: -6 };
  const result = plotScientificSpectrum(dos(), { kind: "dos" }, settings);
  expect(Array.from(result.positions)).toEqual([-6, -5, -4, -3, -2, -1, 0]);
  expect([result.axisStart, result.axisEnd, result.smoothed[3], result.raw[3]]).toEqual([1, -6, 2, 2]);
  expect(result.smoothed[2]).toBeCloseTo(1, 6);
  expect(result.smoothed[4]).toBeCloseTo(1, 6);
});

test("signed rounding is half-away-from-zero and raw sticks retain strict half-grid membership", () => {
  const source = data({ kind: "vcd", xUnit: "cm^-1", positions: [-1.5], values: [-2], valueUnit: null });
  const result = plotScientificSpectrum(source, { kind: "vcd" }, { scale: 1, offset: 0, fwhm: 1, axisStart: -1.5, axisEnd: 1.5 });
  expect(Array.from(result.positions)).toEqual([-2, -1, 0, 1]);
  expect(Array.from(result.raw)).toEqual([0, 0, 0, 0]);
  expect(result.smoothed.every(value => value <= 0)).toBe(true);
  const fine = plotScientificSpectrum(data({ kind: "electronic", xUnit: "eV", positions: [0.005], values: [1], valueUnit: null }), { kind: "electronic" },
    { scale: 1, offset: 0, fwhm: 0.01, axisStart: 0, axisEnd: 0.03 });
  expect(Array.from(fine.raw)).toEqual([0, 0, 0]);
});

test("NMR filters explicit source atoms, uses one display weight and repairs negative chemical-shift ranges", () => {
  const source = data({ kind: "nmr", quantity: "isotropic-shielding", atomIndices: [2, 1, 0], valuesPpm: [180.038, 29.876, 182.038] }, [6, 1, 6]);
  const result = plotScientificSpectrum(source, { kind: "nmr", atomicNumber: 6 });
  expect([result.sourceRowIndices, result.sourceAtomIndices]).toEqual([[0, 2], [2, 0]]);
  expect([result.raw[1000], result.raw[1200], result.raw[200]]).toEqual([1, 1, 0]);
  expect(() => plotScientificSpectrum(source, { kind: "nmr", atomicNumber: 9 })).toThrow("No NMR source values");
  const fluorine = data({ kind: "nmr", quantity: "isotropic-shielding", atomIndices: [0], valuesPpm: [210.735] }, [9]);
  const negative = plotScientificSpectrum(fluorine, { kind: "nmr", atomicNumber: 9 });
  expect([negative.positions.length, negative.positions[0], negative.positions[29600], negative.raw[29600]]).toEqual([36000, -300, -4, 1]);
});

test("native MCD and repaired O17 default grids fit without coarsening; explicit width100 is distinct", () => {
  const source = data({ kind: "mcd", xUnit: "cm^-1", positions: [20000], values: [1], valueUnit: null });
  const result = plotScientificSpectrum(source, { kind: "mcd" });
  expect([result.positions.length, result.positions[0], result.positions.at(-1), result.settings.parameters.fwhm]).toEqual([65000, 10000, 74999, 99.99]);
  const options = { ...spectralPlotDefaults({ kind: "mcd" }), axisStart: 20050, axisEnd: 20051 };
  const native = plotScientificSpectrum(source, { kind: "mcd" }, options), explicit = plotScientificSpectrum(source, { kind: "mcd" }, { ...options, fwhm: 100 });
  expect(native.smoothed[0]).toBeLessThan(0.5);
  expect(explicit.smoothed[0]).toBeCloseTo(0.5, 6);
  const oxygen = data({ kind: "nmr", quantity: "isotropic-shielding", atomIndices: [0], valuesPpm: [347.782] }, [8]);
  const o17 = plotScientificSpectrum(oxygen, { kind: "nmr", atomicNumber: 8 });
  expect([o17.positions.length, o17.positions[0], o17.positions[5000], o17.raw[5000]]).toEqual([165000, -50, 0, 1]);
  expect(o17.positions.at(-1)!).toBeCloseTo(1599.99, 3);
});

test("actual reference, scale, offset and source units export separately from unchanged raw measurements", () => {
  const source = data({ kind: "nmr", quantity: "isotropic-shielding", atomIndices: [0], valuesPpm: [180] }, [6]);
  const before = scientificSpectraJson(source), options = { scale: 2, offset: 192, fwhm: 0.1, axisStart: 5, axisEnd: 7 };
  const result = plotScientificSpectrum(source, { kind: "nmr", atomicNumber: 6 }, options);
  const settings = JSON.parse(spectralPlotSettingsJson(result));
  expect(result.raw[100]).toBe(1);
  expect(settings).toMatchObject({ arithmetic: "float32-peak-height", sourceXUnit: "ppm", displayXUnit: "ppm", parameters: options,
    nmr: { sourceQuantity: "isotropic-shielding", referencePpm: 192, formula: "(referencePpm-sourcePpm)/scale" } });
  expect(scientificSpectraJson(source)).toBe(before);
  source.source.name = "later unrelated source";
  expect(JSON.parse(spectralPlotSettingsJson(result)).source.name).toBe("explicit source data");
});

test("bounds and Float32 overflow refuse a curve instead of normalizing, resampling or partial output", () => {
  const base = spectralPlotDefaults({ kind: "dos" });
  for (const change of [{ scale: 0 }, { scale: 1e-100 }, { offset: Infinity }, { fwhm: 0.001 }, { fwhm: 1e30 }, { axisStart: 0, axisEnd: 200001 }, { axisEnd: 2 ** 24 + 2 }]) {
    expect(() => plotScientificSpectrum(dos(), { kind: "dos" }, { ...base, ...change })).toThrow();
  }
  const crowded = data({ kind: "mcd", xUnit: "cm^-1", positions: Array.from({ length: 2000 }, (_, i) => 20000 + i), values: Array(2000).fill(1), valueUnit: null });
  expect(() => plotScientificSpectrum(crowded, { kind: "mcd" })).toThrow("evaluation budget");
  const maximum = new Float32Array(new Uint32Array([0x7f7fffff]).buffer)[0];
  const overflow = data({ kind: "dos", xUnit: "eV", positions: [1, 1], values: [maximum, maximum], valueUnit: null });
  expect(() => plotScientificSpectrum(overflow, { kind: "dos" }, { ...base, axisStart: 1, axisEnd: 2 })).toThrow("overflows");
  const doubleSource = data({ kind: "electronic", xUnit: "nm", positions: [1e-320], values: [1], valueUnit: null });
  expect(() => plotScientificSpectrum(doubleSource, { kind: "electronic" })).toThrow("Float32");
  expect(scientificSpectraJson(doubleSource)).toContain("1e-320");
});
