import { expect, test } from "bun:test";
import { checkScientificSpectra, scientificSpectraJson, parseScientificSpectraJson, scientificSpectrumCsv, type ScientificSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
import { plotScientificSpectrum } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra-plot";
function data(): ScientificSpectra {
  return { kind: "scientific-spectra", version: 1, source: { name: "ORCA original", format: "orca-output", scope: "file" }, atomicNumbers: [], spectra: [
    { kind: "electronic", xUnit: "eV", positions: [4, 5], values: [0.2, 0.4], valueUnit: null, sourceRowIds: ["0-1A -> 1-1A", "0-1A -> 2-1A"],
      auxiliary: [
        { name: "wavenumber", unit: "cm-1", values: [32262.176, 40327.72] },
        { name: "wavelength", unit: "nm", values: [309.960496, 247.9683968] },
        { name: "D2", unit: "au**2", values: [0.00359, 0.01709] },
        { name: "DX", unit: "au", values: [-0.01533, -0.11448] },
        { name: "DY", unit: "au", values: [0.00985, 0.05664] },
        { name: "DZ", unit: "au", values: [0.05711, -0.0279] },
      ] },
  ] };
}

test("optical source transition identities and all six auxiliary source columns survive raw exports without changing plots", () => {
  const input = data(), before = structuredClone(input);
  const signal = input.spectra[0];
  Object.freeze(input); Object.freeze(signal);
  expect(checkScientificSpectra(input)).toBe(input);
  expect(parseScientificSpectraJson(scientificSpectraJson(input))).toEqual(before);
  const csv = scientificSpectrumCsv(input, "electronic").split("\n");
  expect(csv[3]).toBe("source_row_id,position (eV),signal (source unit unspecified),wavenumber (cm-1),wavelength (nm),D2 (au**2),DX (au),DY (au),DZ (au)");
  expect(csv[4]).toBe("0-1A -> 1-1A,4,0.2,32262.176,309.960496,0.00359,-0.01533,0.00985,0.05711");
  const plain = data();
  if (plain.spectra[0].kind !== "nmr") delete plain.spectra[0].sourceRowIds;
  expect(plotScientificSpectrum(input, { kind: "electronic" }).smoothed).toEqual(plotScientificSpectrum(plain, { kind: "electronic" }).smoothed);
  expect(input).toEqual(before);
});

test("source row identities are unique, bounded and complete; more than six auxiliary columns still refuse", () => {
  for (const ids of [["x"], ["x", "x"], ["x", ""], ["x", "z".repeat(129)], Array(2)] as string[][]) {
    const input = data(), signal = input.spectra[0];
    if (signal.kind === "nmr") throw new Error("Wrong fixture kind");
    signal.sourceRowIds = ids;
    expect(() => checkScientificSpectra(input)).toThrow();
  }
  const extended = data();
  extended.spectra[0].auxiliary = [...extended.spectra[0].auxiliary!, { name: "extra", unit: null, values: [1, 2] }];
  expect(() => checkScientificSpectra(extended)).toThrow();
  const input = data();
  input.spectra = [{ kind: "nmr", quantity: "native-input", atomIndices: [0], valuesPpm: [1], sourceRowIds: ["unrelated"] } as unknown as typeof input.spectra[0]];
  input.atomicNumbers = [1];
  expect(() => checkScientificSpectra(input)).toThrow("unknown fields");
});
