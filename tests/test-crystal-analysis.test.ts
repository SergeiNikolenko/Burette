import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readCrystalDocument } from "../apps/desktop/src/lib/molecular-workbench/crystal-io";
import { computePairDistribution, selectPairs } from "../apps/desktop/src/lib/molecular-workbench/pair-distribution/pair-distribution";
import { analyzePointGroup } from "../apps/desktop/src/lib/molecular-workbench/symmetry/point-group";
import { instantiateStandaloneWasm } from "../apps/desktop/src/lib/molecular-workbench/symmetry/wasm-module";
import { computePowderPattern, type XrdEngineExports } from "../apps/desktop/src/lib/molecular-workbench/xrd/powder-xrd";
import { loadXrdEngine } from "../apps/desktop/src/lib/molecular-workbench/xrd/xrd-engine";
import { parseXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { fixtureText, reference } from "./crystal-reference";

// g(r) and powder patterns of the full cells Burette reads, against ASE neighbour
// lists and pymatgen's XRDCalculator; molecular point groups against pymatgen's
// PointGroupAnalyzer. See tests/fixtures/crystals/generate-reference.py.
const analysed = Object.entries(reference.fixtures).filter(([, fixture]) => fixture.pairDistribution && fixture.xrd);
const read = (name: string) => readCrystalDocument({ format: name.endsWith(".cif") ? "cif" : name.endsWith(".xyz") ? "xyz" : "vasp", text: fixtureText(name) });

let xrd: XrdEngineExports;
beforeAll(async () => {
  xrd = await loadXrdEngine(readFileSync(new URL("../apps/desktop/src/lib/molecular-workbench/xrd/burette-xrd.wasm", import.meta.url)));
});

test("the reference set covers molecular, ionic and network crystals", () => {
  expect(analysed.map(([name]) => name)).toEqual(["urea.cif", "rutile.cif", "quartz.cif"]);
});

test.each(analysed)("%s: periodic g(r) pair counts match ASE bin for bin, total and partial", async (_, fixture) => {
  const expected = fixture.pairDistribution!;
  const { atoms, cell } = await read(_);
  const result = computePairDistribution({ atoms, cell, rMax: expected.rMax, binWidth: expected.binWidth });
  expect(result.volume).toBeCloseTo(expected.volume, 6);
  const total = selectPairs(result, null, null);
  expect(Array.from(total.counts)).toEqual(expected.total);
  total.g.forEach((value, bin) => expect(value).toBeCloseTo(expected.gTotal[bin], 4));
  for (const [pair, partial] of Object.entries(expected.partial)) {
    const [centre, neighbour] = pair.split("-");
    const selection = selectPairs(result, centre, neighbour);
    expect(Array.from(selection.counts)).toEqual(partial.counts);
    selection.g.forEach((value, bin) => expect(value).toBeCloseTo(partial.g[bin], 4));
  }
});

/**
 * pymatgen's scattering-factor fits differ from the IT92 tables, slowly with sin θ/λ;
 * for hydrogen by about 5% at sin θ/λ = 0.2, which moves weak, partly cancelling
 * urea reflections by a few tenths on the 100 scale.
 */
test.each(analysed)("%s: powder pattern peaks, d-spacings and multiplicities match pymatgen", async (_, fixture) => {
  const expected = fixture.xrd!;
  const { atoms, cell } = await read(_);
  const pattern = computePowderPattern(xrd, { atoms, cell, wavelength: 1.5405929, twoThetaMin: 10, twoThetaMax: 90 });
  const peaks = pattern.peaks.filter(peak => peak.relativeIntensity > 1e-3);
  expect(peaks.length).toBe(expected.length);
  peaks.forEach((peak, index) => {
    const other = expected[index];
    expect(Math.abs(peak.twoTheta - other.twoTheta)).toBeLessThan(1e-6);
    expect(Math.abs(peak.d - other.d)).toBeLessThan(1e-7);
    // pymatgen also counts systematically absent families that coincide with a peak,
    // e.g. urea (500), absent by the 2_1 screw, under (430); Burette counts contributing reflections.
    // Hexagonal families come as Miller-Bravais (h k i l), i = -(h + k).
    const hexagonal = other.families[0].length === 4;
    const sorted = (values: number[]) => values.map(Math.abs).sort((a, b) => a - b).join(" ");
    const family = (hkl: readonly number[]) => hexagonal ? `${sorted([hkl[0], hkl[1], hkl[0] + hkl[1]])}|${Math.abs(hkl[2])}` : sorted([...hkl]);
    const ours = new Set(peak.reflections.map(family)), theirs = new Set(other.families.map(hkl => family(hexagonal ? [hkl[0], hkl[1], hkl[3]] : hkl)));
    expect([...ours].every(key => theirs.has(key))).toBe(true);
    if (ours.size === theirs.size) expect(peak.multiplicity).toBe(other.multiplicity);
    else expect(peak.multiplicity).toBeLessThan(other.multiplicity);
    expect(Math.abs(peak.relativeIntensity - other.relativeIntensity)).toBeLessThan(0.6);
    const stol = Math.sin(peak.twoTheta * Math.PI / 360) / pattern.wavelength;
    if (other.relativeIntensity >= 10 && stol <= 0.45) expect(Math.abs(peak.relativeIntensity / other.relativeIntensity - 1)).toBeLessThan(0.03);
  });
});

test.each(Object.entries(reference.molecules))("%s has the point group pymatgen assigns", async (_, molecule) => {
  const msym = await instantiateStandaloneWasm(new URL("../apps/desktop/src/lib/molecular-workbench/symmetry/burette-msym.wasm", import.meta.url));
  const { atoms } = parseXyz(fixtureText(molecule.file));
  expect(analyzePointGroup(msym, { atoms }, "detect").pointGroup).toBe(molecule.schoenflies.replace("*", "∞"));
});
