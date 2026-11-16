import { expect, test } from "bun:test";
import { readOrcaVcdTables, readOrcaMcdBlocks } from "../apps/desktop/src/lib/molecular-workbench/orca-circular-spectra";
import { checkScientificSpectra, scientificSpectrumCsv, type ScientificSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
const vcd = (rows: string, units = "cm**-1") => `VCD SPECTRUM\n---\nMode Freq R\n${units}\n---\n${rows}\n\n`;
const modes = Object.freeze([{ index: 6, frequencyCm1: -24.125 }, { index: 7, frequencyCm1: 1040.252 }, { index: 8, frequencyCm1: 1100.5 }]);

test("VCD uses explicit source mode identity/frequency, signed source values and omits absent calculations", () => {
  const text = vcd("7: 1040.25 -2.345D-3\n6: -24.13 1.25"), before = text;
  const [table] = readOrcaVcdTables(text, modes);
  expect(table.spectrum).toEqual({ kind: "vcd", xUnit: "cm^-1", positions: [1040.252, -24.125], values: [-0.002345, 1.25], valueUnit: null,
    sourceRowIds: ["7", "6"], auxiliary: [{ name: "printed frequency", unit: "cm^-1", values: [1040.25, -24.13] }] });
  const data: ScientificSpectra = { kind: "scientific-spectra", version: 1, source: { name: "source mode set", format: "orca-output", scope: "frame", frameIndex: 1, frameCount: 3 },
    atomicNumbers: [6, 1, 1], spectra: [table.spectrum] };
  expect(checkScientificSpectra(data)).toBe(data);
  expect(scientificSpectrumCsv(data, "vcd")).toContain("7,1040.252,-0.002345,1040.25\n6,-24.125,1.25,-24.13\n");
  expect(text.slice(table.start, table.end)).toContain("6: -24.13 1.25");
  expect(text).toBe(before);
  expect(readOrcaVcdTables(vcd("8 1100.5 -1", "(cm^-1) (source declared unit)"), modes)[0].spectrum.valueUnit).toBe("source declared unit");
});

test("VCD malformed, duplicate, foreign and mismatched modes refuse a complete read", () => {
  for (const rows of ["9: 1100.5 1", "8: 1100.5 1\n8: 1100.5 2", "8: 1101.5 1", "8: 1100.5 NaN", "8.5 1100.5 1", "8: 1100.5 1 EXTRA", `${"0".repeat(129)}8: 1100.5 1`, ""]) {
    expect(() => readOrcaVcdTables(vcd(rows), modes)).toThrow();
  }
  expect(() => readOrcaVcdTables(vcd("8: 1100.5 1", "eV"), modes)).toThrow("centimetres");
  expect(() => readOrcaVcdTables(vcd("8: 1100.5 1"), [...modes, modes[0]])).toThrow("identity");
  expect(() => readOrcaVcdTables(vcd("8: 1100.5 1"), [{ index: 8, frequencyCm1: NaN }])).toThrow("identity");
  expect(readOrcaVcdTables("no VCD table", modes)).toEqual([]);
});

test("explicit MCD companion preserves all triples and separates decreasing-frequency blocks without normalization", () => {
  const text = "  10000 -2.25 .12\r\n10001 -0 .25\r\n 10000 3.5 .7\r\n10002 -4.2 1.5\n";
  const blocks = readOrcaMcdBlocks(text);
  expect(blocks.map(block => block.spectrum)).toEqual([
    { kind: "mcd", xUnit: "cm^-1", positions: [10000, 10001], values: [-2.25, -0], valueUnit: null, auxiliary: [{ name: "absorption", unit: null, values: [0.12, 0.25] }] },
    { kind: "mcd", xUnit: "cm^-1", positions: [10000, 10002], values: [3.5, -4.2], valueUnit: null, auxiliary: [{ name: "absorption", unit: null, values: [0.7, 1.5] }] },
  ]);
  expect(Object.is(blocks[0].spectrum.values[1], -0)).toBe(true);
  expect(blocks.map(block => text.slice(block.start, block.end))).toEqual(["10000 -2.25 .12\r\n10001 -0 .25", "10000 3.5 .7\r\n10002 -4.2 1.5"]);
  expect(readOrcaMcdBlocks("10000 -2.25 .12 10001 -0 .25")[0].spectrum).toEqual(blocks[0].spectrum); // native stream is whitespace-delimited.
  const data: ScientificSpectra = { kind: "scientific-spectra", version: 1, source: { name: "explicit.cis-el.dipole-length.1.mcd", format: "orca-mcd", scope: "file" }, atomicNumbers: [], spectra: [blocks[0].spectrum] };
  expect(checkScientificSpectra(data)).toBe(data);
  expect(scientificSpectrumCsv(data, "mcd")).toContain("10000,-2.25,0.12\n10001,0,0.25\n");
});

test("MCD malformed, non-finite, binary, oversized and over-budget input never publishes a partial first block", () => {
  for (const text of ["", "10000 1", "10000 1 2 EXTRA", "10000 NaN 2", "10000 1 Infinity", "10000 1 2\n9000 3 BAD", "10000 1 2\0"]) {
    expect(() => readOrcaMcdBlocks(text)).toThrow();
  }
  expect(() => readOrcaMcdBlocks("é".repeat(8 * 1024 * 1024) + "a")).toThrow("16 MiB");
  const full = Array.from({ length: 10_000 }, (_, i) => `${i} -1 .5`).join("\n");
  expect(readOrcaMcdBlocks(full)[0].spectrum.positions.length).toBe(10_000);
  expect(() => readOrcaMcdBlocks(full + "\n10000 1 2")).toThrow("10,000");
});
