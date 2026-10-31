import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { computeScientificSpectrum, type ScientificSpectrumRequest } from "../apps/desktop/src/lib/workbench/scientific-spectrum-task";
import { spectralPlotDefaults } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra-plot";
import { scientificSpectrumCsv, scientificSpectraJson } from "../apps/desktop/src/lib/molecular-workbench/scientific-spectra";

type Golden = ScientificSpectrumRequest & { name: string; rows: number[][] };
const golden: Golden[] = JSON.parse(readFileSync(new URL("./fixtures/quantum/scientific-spectra-golden.json", import.meta.url), "utf8"));
for (const reference of golden) test(`real spectrum worker matches pinned entire C++ grid: ${reference.name}`, async () => {
  const before = scientificSpectraJson(reference.data), csv = scientificSpectrumCsv(reference.data, reference.selection.kind);
  const result = await computeScientificSpectrum(reference);
  expect(Array.from(result.positions)).toEqual(reference.rows.map(row => Math.fround(row[0])));
  for (const [column, actual] of [[1, result.smoothed], [2, result.raw]] as const) {
    const worst = Array.from(actual, (value, index) => Math.abs(value - reference.rows[index][column]) / Math.max(1, Math.abs(reference.rows[index][column])));
    expect(Math.max(...worst)).toBeLessThan(2e-6);
  }
  expect(result.settings.parameters).toEqual(reference.options);
  expect([scientificSpectraJson(reference.data), scientificSpectrumCsv(reference.data, reference.selection.kind)]).toEqual([before, csv]);
});

test("signed envelope retains negative and positive extrema without changing exact output or source row identity", async () => {
  const data: ScientificSpectrumRequest["data"] = { kind: "scientific-spectra", version: 1, source: { name: "signed.dos", format: "avogadro-matrix", scope: "file" }, atomicNumbers: [],
    spectra: [{ kind: "dos", xUnit: "eV", positions: [-315, -314, 122], values: [-4, 3, 8], valueUnit: "states/eV", sourceRowIds: ["negative", "positive", "later"] }] };
  const result = await computeScientificSpectrum({ data, selection: { kind: "dos" }, options: { scale: 1, offset: 0, fwhm: 0.1, axisStart: -1000, axisEnd: 1000 } });
  expect(result.positions.length).toBe(2000);
  expect(result.renderIndices.length).toBeLessThanOrEqual(1026);
  expect(result.renderIndices[0]).toBe(0);
  expect(result.renderIndices.at(-1)).toBe(1999);
  expect([685, 686, 1122].every(index => result.renderIndices.includes(index))).toBe(true);
  expect(result.peaks).toEqual([{ center: -315, value: -4 }, { center: -314, value: 3 }, { center: 122, value: 8 }]);
  expect(result.sourceRowIndices).toEqual([0, 1, 2]);
  expect(scientificSpectrumCsv(data, "dos")).toContain('negative,-315,-4');
});

test("NMR worker retains explicit source atoms and referenced reversed ranges", async () => {
  const selection = { kind: "nmr", atomicNumber: 6 } as const;
  const data: ScientificSpectrumRequest["data"] = { kind: "scientific-spectra", version: 1, source: { name: "nmr.out", format: "orca-output", scope: "frame", frameIndex: 1, frameCount: 2 }, atomicNumbers: [6, 1, 6],
    spectra: [{ kind: "nmr", quantity: "isotropic-shielding", atomIndices: [2, 1, 0], valuesPpm: [180.038, 29.876, 182.038] }] };
  const result = await computeScientificSpectrum({ data, selection, options: spectralPlotDefaults(selection) });
  expect([result.sourceRowIndices, result.sourceAtomIndices, result.raw[1000], result.raw[1200], result.axisStart, result.axisEnd]).toEqual([[0, 2], [2, 0], 1, 1, 200, 0]);
  expect(result.settings.nmr).toEqual({ sourceQuantity: "isotropic-shielding", referencePpm: 192.038, formula: "(referencePpm-sourcePpm)/scale" });
});

test("real calculation aborts and independent successor succeeds; oversized inputs fail", async () => {
  const reference = golden[0], abort = new AbortController();
  const pending = computeScientificSpectrum(reference, { signal: abort.signal });
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(computeScientificSpectrum(reference, { signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
  const next = await computeScientificSpectrum(reference);
  expect(next.positions.length).toBe(reference.rows.length);
  await expect(computeScientificSpectrum({ ...reference, data: { ...reference.data, atomicNumbers: Array(10001).fill(1) } })).rejects.toThrow("source atoms");
  await expect(computeScientificSpectrum({ ...reference, options: { ...reference.options, axisStart: 0, axisEnd: 1e9 } })).rejects.toThrow("bounded signed grid");
});
