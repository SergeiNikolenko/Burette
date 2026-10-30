import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readOrcaOpticalTables } from "../apps/desktop/src/lib/molecular-workbench/orca-optical-spectra";
import { checkScientificSpectra, scientificSpectraJson, parseScientificSpectraJson, scientificSpectrumCsv, type ScientificSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
import { plotScientificSpectrum } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra-plot";
const original = readFileSync(new URL("./fixtures/quantum/spectra-orca-camphor.out", import.meta.url), "utf8");
function data(text = original): ScientificSpectra {
  return { kind: "scientific-spectra", version: 1, source: { name: "camphor.out", format: "orca-output", scope: "file" }, atomicNumbers: [],
    spectra: readOrcaOpticalTables(text).map(table => table.spectrum) };
}
function legacy(kind: "electronic" | "ecd", rows: string) {
  return kind === "electronic"
    ? `ABSORPTION SPECTRUM VIA TRANSITION ELECTRIC DIPOLE MOMENTS\n---\nState Energy Wavelength fosc T2 TX TY TZ\n(cm-1) (nm) (au**2) (au) (au) (au)\n---\n${rows}\n\n`
    : `CD SPECTRUM VIA TRANSITION ELECTRIC DIPOLE MOMENTS\n---\nState Energy Wavelength R MX MY MZ\n(cm-1) (nm) (1e40*cgs) (au) (au) (au)\n---\n${rows}\n\n`;
}

test("real pinned ORCA6 absorption/CD retains all transition identities, signed rotation and complete numeric rows", () => {
  const tables = readOrcaOpticalTables(original), input = data(), before = structuredClone(input);
  expect(tables.map(table => [table.spectrum.kind, table.spectrum.positions.length])).toEqual([["electronic", 15], ["ecd", 15]]);
  expect(tables[0].spectrum.sourceRowIds).toEqual(Array.from({ length: 15 }, (_, i) => `0-1A -> ${i + 1}-1A`));
  expect(tables[0].spectrum).toMatchObject({ xUnit: "eV", valueUnit: null, positions: [4.316565, 6.427507, 6.73405, 7.086805, 7.164234, 7.293429, 7.316968, 7.391227, 7.632354, 7.688583, 7.93288, 7.969222, 8.061219, 8.077, 8.329179] });
  expect(tables[0].spectrum.values.slice(0, 2)).toEqual([0.000380032, 0.002691669]);
  expect(tables[0].spectrum.auxiliary?.map(column => [column.name, column.unit, column.values[0]])).toEqual([
    ["wavenumber", "cm-1", 34815.4], ["wavelength", "nm", 287.2], ["D2", "au**2", 0.00359], ["DX", "au", -0.01533], ["DY", "au", 0.00985], ["DZ", "au", 0.05711],
  ]);
  expect(tables[1].spectrum.values.slice(0, 3)).toEqual([4.19641, -3.1042, -2.14472]);
  expect(tables[1].spectrum.valueUnit).toBe("1e40*cgs");
  expect(checkScientificSpectra(input)).toBe(input);
  expect(parseScientificSpectraJson(scientificSpectraJson(input))).toEqual(before);
  expect(scientificSpectrumCsv(input, "electronic")).toContain("0-1A -> 1-1A,4.316565,0.000380032,34815.4,287.2,0.00359,-0.01533,0.00985,0.05711\n");
  expect(scientificSpectrumCsv(input, "ecd")).toContain("signal (1e40*cgs)");
});

test("legacy 8/7-column layouts retain source cm^-1 and labels, with conversion only at display", () => {
  const text = legacy("electronic", "2 32262.176 309.960496 .5 .1 -.2 .3 -.4") + legacy("ecd", "2 32262.176 309.960496 -3.2 -.1 .2 -.3");
  const tables = readOrcaOpticalTables(text), input = data(text);
  expect(tables.map(table => [table.spectrum.xUnit, table.spectrum.sourceRowIds, table.spectrum.values])).toEqual([["cm^-1", ["2"], [0.5]], ["cm^-1", ["2"], [-3.2]]]);
  expect(tables[0].spectrum.auxiliary?.map(column => column.values)).toEqual([[309.960496], [0.1], [-0.2], [0.3], [-0.4]]);
  const plot = plotScientificSpectrum(input, { kind: "electronic" }, { scale: 1, offset: 0, fwhm: 0.1, axisStart: 3.99, axisEnd: 4.02 });
  expect(Array.from(plot.raw)).toEqual([0, 0.5, 0]);
  expect(input.spectra[0]).toEqual(tables[0].spectrum);
});

test("table offsets retain original CRLF/CR and CD uses its own declared rows without count-based zipping", () => {
  const text = `😀 prefix\r\n${legacy("electronic", "1 10000 1000 1 2 3 4 5").replace(/\n/g, "\r\n")}${legacy("ecd", "4 25000 400 -2 3 4 5").replace(/\n/g, "\r")}`;
  const tables = readOrcaOpticalTables(text);
  expect(tables.map(table => table.spectrum.sourceRowIds)).toEqual([["1"], ["4"]]);
  expect(tables.map(table => table.spectrum.positions)).toEqual([[10000], [25000]]);
  expect(text.slice(tables[0].start, tables[0].end)).toContain("1 10000 1000 1 2 3 4 5\r\n");
  expect(text.slice(tables[1].start, tables[1].end)).toContain("4 25000 400 -2 3 4 5\r");
  const velocity = original.replaceAll("ELECTRIC", "VELOCITY");
  expect(readOrcaOpticalTables(velocity)).toEqual([]);
});

test("invalid row identities, units, numbers or incomplete source columns refuse the complete read", () => {
  const mutations = [
    (text: string) => text.replace("0-1A  ->  2-1A", "0-1A  ->  1-1A"),
    (text: string) => text.replace("0-1A  ->  1-1A", "0-1A  xx  1-1A"),
    (text: string) => text.replace("0.000380032", "NaN"),
    (text: string) => text.replace("0.000380032", "1e999"),
    (text: string) => text.replace("0.000380032", "0.000380032 EXTRA"),
    (text: string) => text.replace("(eV)", "(hartree)"),
    (text: string) => text.replace("(au**2)", "(unknown)"),
    (text: string) => text.replace("fosc(D2)", "unknown"),
  ];
  for (const mutate of mutations) expect(() => readOrcaOpticalTables(mutate(original))).toThrow();
  expect(() => readOrcaOpticalTables(legacy("electronic", "1 10000 1000 1 2 3 4 5\n2 12000 800 1 2 3 4 BAD"))).toThrow();
  expect(() => readOrcaOpticalTables(original + "\0")).toThrow();
  expect(() => readOrcaOpticalTables("é".repeat(8 * 1024 * 1024) + "a")).toThrow("16 MiB");
  const many = Array.from({ length: 10_000 }, (_, i) => `${i} 10000 1000 1 2 3 4 5`).join("\n");
  expect(readOrcaOpticalTables(legacy("electronic", many))[0].spectrum.sourceRowIds?.length).toBe(10_000);
  expect(() => readOrcaOpticalTables(legacy("electronic", many) + legacy("ecd", "1 10000 1000 1 2 3 4"))).toThrow("10,000");
});
