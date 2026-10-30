import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readOrcaNmrTables } from "../apps/desktop/src/lib/molecular-workbench/orca-nmr-spectra";
import { checkScientificSpectra, scientificSpectrumCsv, type ScientificSpectra } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";
import { plotScientificSpectrum, spectralPlotDefaults } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra-plot";

const original = readFileSync(new URL("./fixtures/quantum/spectra-orca-nmr.out", import.meta.url), "utf8");
const numbers = Object.freeze([6, 8, 1, 1]);
const table = (rows: string) => `CHEMICAL SHIELDING SUMMARY (ppm)\n---\n\nNucleus Element Isotropic Anisotropy\n------- ------- ------------ ------------\n${rows}\n\n`;
function sourceData(text = original, atoms: readonly number[] = numbers): ScientificSpectra {
  return { kind: "scientific-spectra", version: 1, source: { name: "nmr.out", format: "orca-output", scope: "file" },
    atomicNumbers: atoms, spectra: [readOrcaNmrTables(text, atoms)[0].spectrum] };
}

test("real ORCA table preserves atom identities, shielding and anisotropy instead of upstream's mixed-base overwrite", () => {
  const [parsed] = readOrcaNmrTables(original, numbers), data = sourceData();
  expect(parsed.indexBase).toBe(0);
  expect(parsed.spectrum).toEqual({ kind: "nmr", quantity: "isotropic-shielding", atomIndices: [0, 1, 2, 3],
    valuesPpm: [8.356, -394.078, 21.901, 21.901], auxiliary: [
      { name: "source nucleus index", unit: null, values: [0, 1, 2, 3] },
      { name: "anisotropy", unit: "ppm", values: [153.085, -1105.763, 0.965, 0.965] },
    ] });
  expect(original.slice(parsed.start, parsed.end)).toContain("      3       H           21.901");
  expect(checkScientificSpectra(data)).toBe(data);
  expect(scientificSpectrumCsv(data, "nmr")).toContain("0,6,8.356,0,153.085\n1,8,-394.078,1,-1105.763\n");
  const options = { ...spectralPlotDefaults({ kind: "nmr", atomicNumber: 6 }), axisStart: 183, axisEnd: 185 };
  const plot = plotScientificSpectrum(data, { kind: "nmr", atomicNumber: 6 }, options);
  expect(plot.sourceAtomIndices).toEqual([0]);
  expect(plot.positions[plot.raw.findIndex(value => value !== 0)]).toBeCloseTo(183.68, 3);
  expect(data.spectra[0]).toEqual(parsed.spectrum); // reference was applied once, only to display.
});

test("one-based permuted and sparse tables retain source order and omit uncomputed atoms", () => {
  const text = table("4 H 2.1901D1 .965\n2 O -3.94078e2 -1105.763\n1 C +8.356 153.085");
  const [parsed] = readOrcaNmrTables(text, numbers);
  expect(parsed.indexBase).toBe(1);
  expect(parsed.spectrum.atomIndices).toEqual([3, 1, 0]);
  expect(parsed.spectrum.valuesPpm).toEqual([21.901, -394.078, 8.356]);
  expect(parsed.spectrum.auxiliary?.[0].values).toEqual([4, 2, 1]);
  expect(checkScientificSpectra(sourceData(text)).spectra[0]).toEqual(parsed.spectrum);
});

test("source offsets survive CRLF/CR and every table is returned separately without a final-frame guess", () => {
  const text = `unrelated log\r\n${table("0 C -0 1").replace(/\n/g, "\r\n")}next geometry\r${table("2 O 4 -2").replace(/\n/g, "\r")}`;
  const before = text, tables = readOrcaNmrTables(text, numbers);
  expect(tables.map(item => [item.indexBase, item.spectrum.atomIndices])).toEqual([[0, [0]], [1, [1]]]);
  expect(tables.map(item => text.slice(item.start, item.end).includes("CHEMICAL SHIELDING SUMMARY (ppm)"))).toEqual([true, true]);
  expect(tables[0].end).toBeLessThan(tables[1].start);
  expect(Object.is(tables[0].spectrum.valuesPpm[0], -0)).toBe(true);
  expect(text).toBe(before);
  expect(readOrcaNmrTables("no shielding summary", numbers)).toEqual([]);
});

test("ambiguous sparse identity, wrong elements, mixed bases and malformed rows refuse the complete read", () => {
  const malformed = [
    [table("1 H 1 2"), [1, 1, 1]], // both index bases fit: do not guess.
    [table("0 C 1 2\n4 H 3 4"), numbers],
    [table("0 O 1 2"), numbers],
    [table("0 C 1 2\n0 C 3 4"), numbers],
    [table("0 C 1 2\n1 O NaN 4"), numbers],
    [table("0 C 1 2\n1 O 3 Infinity"), numbers],
    [table("0 C 1 2\n1 O 3 4 EXTRA"), numbers],
    [table("0 C 1 2\nX O 3 4"), numbers],
    [table("1.5 O 1 2"), numbers],
    [table("-1 C 1 2"), numbers],
    [table(""), numbers],
    [table("0 C 1 2").replace("Anisotropy", "unknown"), numbers],
  ] as const;
  for (const [text, atoms] of malformed) {
    expect(() => readOrcaNmrTables(text, atoms)).toThrow();
    if (atoms === numbers) expect(() => readOrcaNmrTables(original + text, atoms)).toThrow();
  }
  expect(() => readOrcaNmrTables(original, [6, 8, 1, NaN])).toThrow();
  expect(() => readOrcaNmrTables(original, Array(4))).toThrow();
});

test("whole-file UTF8, binary and accumulated row bounds reject without partial table publication", () => {
  expect(() => readOrcaNmrTables(original + "\0", numbers)).toThrow();
  expect(() => readOrcaNmrTables("é".repeat(8 * 1024 * 1024) + "a", numbers)).toThrow("16 MiB");
  const atoms = Object.freeze(Array(10_000).fill(1) as number[]);
  const full = table(atoms.map((_, i) => `${i} H ${i / 100} 1`).join("\n"));
  expect(readOrcaNmrTables(full, atoms)[0].spectrum.atomIndices.length).toBe(10_000);
  expect(() => readOrcaNmrTables(full + table("0 H 1 2"), atoms)).toThrow("10,000");
  expect(atoms[9999]).toBe(1);
});
