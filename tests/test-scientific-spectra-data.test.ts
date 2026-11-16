import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkScientificSpectra, parseScientificSpectraJson, scientificSpectraJson, scientificSpectrumCsv, type ScientificSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";

function sourceData(): ScientificSpectra {
  return {
    kind: "scientific-spectra", version: 1,
    source: { name: "source, one\nsecond line", format: "avogadro-matrix", scope: "frame", frameIndex: 1, frameCount: 3 },
    atomicNumbers: [6, 8, 1, 1],
    spectra: [
      { kind: "vcd", xUnit: "cm^-1", positions: [-20.5, 1000], values: [-1, 2.5], valueUnit: "source rotatory unit" },
      { kind: "mcd", xUnit: "cm^-1", positions: [15000, 22000], values: [-3, 4], valueUnit: null,
        auxiliary: [{ name: "absorption, source", unit: null, values: [0.1, 0.3] }] },
      { kind: "nmr", quantity: "isotropic-shielding", atomIndices: [3, 0], valuesPpm: [21.901, 8.356] },
      { kind: "electronic", xUnit: "nm", positions: [250, 400], values: [0.2, 0.8], valueUnit: "dimensionless" },
      { kind: "ecd", xUnit: "eV", positions: [5, 3], values: [-2, 4], valueUnit: null },
      { kind: "dos", xUnit: "eV", positions: [-3, -1, 0, 1], values: [1e-300, 0.25, 1, 0.5], valueUnit: "states/eV" },
    ],
  };
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
}

test("all six raw source datasets retain signs, units, doubles, scope and object identity", () => {
  const data = sourceData(), before = structuredClone(data);
  freeze(data);
  expect(checkScientificSpectra(data)).toBe(data);
  expect(checkScientificSpectra(data).spectra).toBe(data.spectra);
  const reopened = parseScientificSpectraJson(scientificSpectraJson(data));
  expect(reopened).toEqual(before);
  expect(reopened.spectra.map(item => item.kind)).toEqual(["vcd", "mcd", "nmr", "electronic", "ecd", "dos"]);
  expect(data).toEqual(before);
  expect(scientificSpectrumCsv(data, "electronic").split("\n").slice(-3)).toEqual(["250,0.2", "400,0.8", ""]);
  expect(scientificSpectrumCsv(data, "dos")).toContain("-3,1e-300\n");
});

test("NMR export uses original sparse source atom identity and ppm, never default references or filled zeros", () => {
  const text = scientificSpectrumCsv(sourceData(), "nmr");
  expect(text.split("\n")).toEqual([
    "# source: source, one second line", "# format: avogadro-matrix", "# scope: frame 2 of 3",
    "atom_index_0_based,atomic_number,source_ppm (isotropic-shielding)", "3,1,21.901", "0,6,8.356", "",
  ]);
});

test("MCD keeps its auxiliary absorption column and honestly unspecified signal unit", () => {
  const data = sourceData(), text = scientificSpectrumCsv(data, "mcd");
  expect(text).toContain('position (cm^-1),signal (source unit unspecified),"absorption, source (source unit unspecified)"\n');
  expect(text.split("\n").slice(-3)).toEqual(["15000,-3,0.1", "22000,4,0.3", ""]);
  expect(text).not.toContain("a.u.");
  expect(data.spectra[1]).toEqual(sourceData().spectra[1]);
});

test("real pinned CJSON NMR source rows and atoms survive data admission and raw JSON/CSV export", () => {
  const text = readFileSync(new URL("./fixtures/quantum/spectra-native-nmr.cjson", import.meta.url), "utf8");
  const input = JSON.parse(text);
  const shifts: number[] = input.spectra.nmr.shifts;
  const data: ScientificSpectra = { kind: "scientific-spectra", version: 1,
    source: { name: "nmr.cjson", format: "cjson", scope: "file" }, atomicNumbers: input.atoms.elements.number,
    spectra: [{ kind: "nmr", quantity: "native-input", atomIndices: shifts.map((_, index) => index), valuesPpm: shifts }] };
  expect(checkScientificSpectra(data)).toBe(data);
  expect(parseScientificSpectraJson(scientificSpectraJson(data))).toEqual(data);
  expect(scientificSpectrumCsv(data, "nmr").split("\n").slice(-5)).toEqual(["0,6,8.356", "1,8,-394.078", "2,1,21.901", "3,1,21.901", ""]);
  expect(input.spectra.nmr.shifts).toEqual([8.356, -394.078, 21.901, 21.901]);
});

test("malformed or ambiguous data fails as a whole without mutation or silent field removal", () => {
  const changes: Array<(data: any) => void> = [
    data => { data.source.frameIndex = 3; },
    data => { data.source.scope = "file"; },
    data => { data.source.format = "guessed-from-name"; },
    data => { data.atomicNumbers[0] = 6.5; },
    data => { data.spectra.push(structuredClone(data.spectra[0])); },
    data => { data.spectra[0].values = [1]; },
    data => { data.spectra[0].values[0] = NaN; },
    data => { data.spectra[0].values[0] = Infinity; },
    data => { data.spectra[0].positions = Array(2); },
    data => { data.spectra[0].normalizedValues = [1, 2]; },
    data => { data.spectra[1].auxiliary[0].values = [0]; },
    data => { data.spectra[1].auxiliary.push(structuredClone(data.spectra[1].auxiliary[0])); },
    data => { data.spectra[2].atomIndices = [0, 0]; },
    data => { data.spectra[2].atomIndices = [0, 4]; },
    data => { data.spectra[2].quantity = "already-referenced-chemical-shift"; },
    data => { data.spectra[3].positions[0] = 0; },
    data => { data.spectra[3].valueUnit = undefined; },
    data => { data.spectra[5].xUnit = "hartree"; },
  ];
  for (const change of changes) {
    const data = sourceData(); change(data);
    expect(() => checkScientificSpectra(data)).toThrow();
  }
  const absent = sourceData(); absent.spectra = absent.spectra.filter(item => item.kind !== "dos");
  expect(() => scientificSpectrumCsv(absent, "dos")).toThrow("absent");
});

test("row and serialized file bounds reject work rather than dropping or replacing source rows", () => {
  const data: ScientificSpectra = { kind: "scientific-spectra", version: 1,
    source: { name: "DOS source", format: "avogadro-matrix", scope: "file" }, atomicNumbers: [],
    spectra: [{ kind: "dos", xUnit: "eV", positions: Array.from({ length: 10000 }, (_, i) => i), values: Array(10000).fill(0), valueUnit: null }] };
  expect(checkScientificSpectra(data)).toBe(data);
  expect(parseScientificSpectraJson(scientificSpectraJson(data))).toEqual(data);
  const over = structuredClone(data);
  const spectrum = over.spectra[0];
  if (spectrum.kind !== "nmr") { spectrum.positions = [...spectrum.positions, 10000]; spectrum.values = [...spectrum.values, 0]; }
  expect(() => checkScientificSpectra(over)).toThrow();
  expect(() => parseScientificSpectraJson(" ".repeat(9 * 1024 * 1024))).toThrow("8 MiB");
});
