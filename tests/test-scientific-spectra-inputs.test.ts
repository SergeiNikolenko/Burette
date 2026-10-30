import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readAvogadroSpectra, readCjsonSpectra, readQcschemaSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra-inputs";
import { scientificSpectraJson, parseScientificSpectraJson, scientificSpectrumCsv, type SpectralSource } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
import { plotScientificSpectrum } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra-plot";
const source = (format: SpectralSource["format"]): SpectralSource => ({ name: "original source", format, scope: "frame", frameIndex: 1, frameCount: 2 });
function native() {
  return { VibrationalCD: [[-15, -2], [1200, 3]], MagneticCD: [[15000, -5, 0.4], [23000, 8, 0.7]],
    NMR: [[8.356, 1], [-394.078, 1]], Electronic: [[4, 0.2, -1.5], [5, 0.4, 2.5]],
    CircularDichroism: [[4, -10], [5, 20]], DensityOfStates: [[-10, 2], [0, 0.25]], IR: [[100, 1]] };
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
}

test("all six native matrix keys preserve units, signed source quantities and native third-column CD priority", () => {
  const matrices = native(), before = structuredClone(matrices), atoms = Object.freeze([6, 8]); freeze(matrices);
  const data = readAvogadroSpectra(matrices, source("avogadro-matrix"), atoms)!;
  expect(data.atomicNumbers).toBe(atoms);
  expect(data.spectra.map(spectrum => spectrum.kind)).toEqual(["vcd", "mcd", "electronic", "dos", "ecd", "nmr"]);
  expect(data.spectra.find(spectrum => spectrum.kind === "ecd")).toEqual({ kind: "ecd", xUnit: "eV", positions: [4, 5], values: [-1.5, 2.5], valueUnit: null,
    auxiliary: [{ name: "native CD signal", unit: null, values: [-10, 20] }] });
  expect(data.spectra.find(spectrum => spectrum.kind === "mcd")?.auxiliary).toEqual([{ name: "absorption", unit: null, values: [0.4, 0.7] }]);
  expect(scientificSpectrumCsv(data, "dos")).toContain("-10,2\n0,0.25\n");
  expect(parseScientificSpectraJson(scientificSpectraJson(data))).toEqual(data);
  expect(matrices).toEqual(before);
});

test("native CD uses its own declared axis when standalone and refuses conflicting paired axes", () => {
  const standalone = readAvogadroSpectra({ CircularDichroism: [[3, -4]] }, source("avogadro-matrix"), [])!;
  expect(standalone.spectra).toEqual([{ kind: "ecd", xUnit: "eV", positions: [3], values: [-4], valueUnit: null }]);
  const separate = readAvogadroSpectra({ Electronic: [[3, 0.1]], CircularDichroism: [[3, -4]] }, source("avogadro-matrix"), [])!;
  expect(separate.spectra.find(spectrum => spectrum.kind === "ecd")).toEqual(standalone.spectra[0]);
  expect(() => readAvogadroSpectra({ Electronic: [[3, 0.1]], CircularDichroism: [[4, -4]] }, source("avogadro-matrix"), [])).toThrow("identities");
});

test("real CJSON NMR raw source fields are not pre-referenced or rebound to another atom count", () => {
  const input = JSON.parse(readFileSync(new URL("./fixtures/quantum/spectra-native-nmr.cjson", import.meta.url), "utf8"));
  const before = structuredClone(input); freeze(input);
  const data = readCjsonSpectra(input.spectra, source("cjson"), input.atoms.elements.number)!;
  expect(data.spectra).toEqual([{ kind: "nmr", quantity: "native-input", atomIndices: [0, 1, 2, 3], valuesPpm: [8.356, -394.078, 21.901, 21.901] }]);
  expect(data.spectra[0].kind === "nmr" && data.spectra[0].valuesPpm).toBe(input.spectra.nmr.shifts);
  expect(input).toEqual(before);
  expect(() => readCjsonSpectra(input.spectra, source("cjson"), [6, 8])).toThrow("atoms");
});

test("CJSON E/CD source energies stay eV and standalone rotation needs no invented absorption", () => {
  const input = { electronic: { energies: [4, 3], intensities: [0.1, 0.3], rotation: [-2, 5] } }; freeze(input);
  const data = readCjsonSpectra(input, source("cjson"), [])!;
  expect(data.spectra).toEqual([
    { kind: "electronic", xUnit: "eV", positions: [4, 3], values: [0.1, 0.3], valueUnit: null },
    { kind: "ecd", xUnit: "eV", positions: [4, 3], values: [-2, 5], valueUnit: null },
  ]);
  expect(data.spectra[0].kind === "electronic" && data.spectra[0].positions).toBe(input.electronic.energies);
  expect(readCjsonSpectra({ electronic: { energies: [4], rotation: [-2] } }, source("cjson"), [])!.spectra.map(item => item.kind)).toEqual(["ecd"]);
});

test("QCSchema source nm/cm^-1/eV stays raw while display uses eV and NMR quantity remains explicit native input", () => {
  const spectra = (["nm", "cm^-1", "eV"] as const).map(units => {
    const properties = { unrelated_energy: -40, excited_states: { units, transition_energies: [units === "nm" ? 309.960496 : units === "cm^-1" ? 32262.176 : 4], intensities: [0.5] },
      nmr_shifts: { isotropic: [8.356] } }; freeze(properties);
    const data = readQcschemaSpectra(properties, source("qcschema"), [6])!;
    expect(data.spectra[0].kind === "electronic" && data.spectra[0].positions).toBe(properties.excited_states.transition_energies);
    expect(data.spectra[1]).toEqual({ kind: "nmr", quantity: "native-input", atomIndices: [0], valuesPpm: [8.356] });
    expect(scientificSpectrumCsv(data, "electronic")).toContain(`position (${units})`);
    return plotScientificSpectrum(data, { kind: "electronic" }, { scale: 1, offset: 0, fwhm: 0.1, axisStart: 3.9, axisEnd: 4.1 });
  });
  expect(spectra[0].smoothed).toEqual(spectra[1].smoothed);
  expect(spectra[1].smoothed).toEqual(spectra[2].smoothed);
  expect(readQcschemaSpectra({ excited_states: { transition_energies: [310], intensities: [1] } }, source("qcschema"), [])!.spectra[0]).toHaveProperty("xUnit", "nm");
});

test("whole-source refusal covers unsupported reference semantics, units, shapes and accumulated bounds", () => {
  const badNative: unknown[] = [ { NMR: [[1]] }, { NMR: [[1], [2]] }, { Electronic: [[4, 1, 2, 3]] },
    { VibrationalCD: [[1, 2], [3]] }, { DensityOfStates: [[-1, Infinity]] }, { MagneticCD: [] }, { Electronic: Array(1) } ];
  for (const input of badNative) expect(() => readAvogadroSpectra(input, source("avogadro-matrix"), [])).toThrow();
  for (const input of [{ nmr: { shifts: [1], reference: 31.876 } }, { electronic: { energies: [1, 2], intensities: [1] } }, { electronic: { intensities: [1] } }]) {
    expect(() => readCjsonSpectra(input, source("cjson"), [1])).toThrow();
  }
  for (const input of [{ nmr_shifts: { isotropic: [1], quantity: "chemical-shift" } }, { excited_states: { units: "hartree", transition_energies: [1], intensities: [1] } },
    { excited_states: { units: "nm", transition_energies: [0], intensities: [1] } }]) expect(() => readQcschemaSpectra(input, source("qcschema"), [1])).toThrow();
  const row = Array.from({ length: 5001 }, (_, i) => [i, 1]);
  expect(() => readAvogadroSpectra({ VibrationalCD: row, DensityOfStates: row }, source("avogadro-matrix"), [])).toThrow("budget");
  expect(() => readCjsonSpectra(undefined, source("qcschema"), [])).toThrow("format");
  expect(readQcschemaSpectra({ unrelated_energy: -40 }, source("qcschema"), [])).toBeUndefined();
  expect(readCjsonSpectra(undefined, source("cjson"), [])).toBeUndefined();
});
