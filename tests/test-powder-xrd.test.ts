import { afterEach, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readCifCrystal } from "../apps/desktop/src/lib/molecular-workbench/cif-crystal";
import { cellFromParameters, fractionalToCartesian } from "../apps/desktop/src/lib/molecular-workbench/crystal";
import type { MolecularAtom, UnitCell, Vec3 } from "../apps/desktop/src/lib/molecular-workbench/types";
import {
  broadenPattern, computePowderPattern, powderPatternCsv, powderPatternJson, powderSettingsProblem, PROFILE_LIMITS,
  type PowderPattern, type PowderXrdRequest, type XrdEngineExports,
} from "../apps/desktop/src/lib/molecular-workbench/xrd/powder-xrd";
import { loadXrdEngine, XRD_ENGINE } from "../apps/desktop/src/lib/molecular-workbench/xrd/xrd-engine";
import { runPowderXrdTask } from "../apps/desktop/src/lib/workbench/xrd-task";

const CU = 1.5405929;
const MO = 0.7093171;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/xrd/${name}`, import.meta.url), "utf8");
type ReferencePeak = { twoTheta: number; d: number; relativeIntensity: number; multiplicity: number };
type ReferenceCase = { wavelength: number; twoThetaMin: number; twoThetaMax: number; lattice: UnitCell; sites: { element: string; fractional: Vec3 }[]; peaks: ReferencePeak[] };
const reference = JSON.parse(fixture("pymatgen-reference.json")) as { generator: string; cases: Record<string, ReferenceCase> };

let engine: XrdEngineExports;
beforeAll(async () => {
  engine = await loadXrdEngine(readFileSync(new URL("../apps/desktop/src/lib/molecular-workbench/xrd/burette-xrd.wasm", import.meta.url)));
});

const place = (cell: UnitCell, sites: [string, Vec3][]): MolecularAtom[] => sites.map(([element, f]) => {
  const [x, y, z] = fractionalToCartesian(f, cell);
  return { element, x, y, z };
});
const cubic = (a: number) => cellFromParameters({ a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 });
const FCC: Vec3[] = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
const run = (request: Omit<PowderXrdRequest, "wavelength" | "twoThetaMin" | "twoThetaMax"> & Partial<PowderXrdRequest>) =>
  computePowderPattern(engine, { wavelength: CU, twoThetaMin: 10, twoThetaMax: 120, ...request });
const visible = (pattern: PowderPattern) => pattern.peaks.filter((peak) => peak.relativeIntensity > 1e-3);
const families = (pattern: PowderPattern) => pattern.peaks.map((peak) => peak.hkl.join(" "));
const bragg = (d: number, wavelength: number) => 2 * Math.asin(wavelength / (2 * d)) * 180 / Math.PI;

/** International Tables Vol. C (1992), Table 6.1.1.4, carbon. */
const CARBON_IT92 = { a: [2.31, 1.02, 1.5886, 0.865], b: [20.8439, 10.2075, 0.5687, 51.6512], c: 0.2156 };
const carbonFactor = (stol2: number) => CARBON_IT92.c + CARBON_IT92.a.reduce((sum, a, i) => sum + a * Math.exp(-CARBON_IT92.b[i] * stol2), 0);

test("one atom in P1: every lattice reflection appears with its multiplicity and the tabulated form factor", () => {
  const a = 4;
  const pattern = run({ atoms: place(cubic(a), [["C", [0.3, 0.1, 0.7]]]), cell: cubic(a) });
  expect(pattern.absentReflections).toBe(0);
  expect(pattern.peaks.slice(0, 8).map((peak) => [peak.hkl.join(""), peak.multiplicity])).toEqual([
    ["100", 6], ["110", 12], ["111", 8], ["200", 6], ["210", 24], ["211", 24], ["220", 12], ["300", 30],
  ]);
  for (const peak of pattern.peaks) {
    const [h, k, l] = peak.hkl;
    const d = a / Math.hypot(h, k, l);
    expect(peak.d).toBeCloseTo(d, 10);
    expect(peak.twoTheta).toBeCloseTo(bragg(d, CU), 9);
    // A single atom's |F|^2 is f^2 whatever its position.
    expect(peak.structureFactorSquared / peak.multiplicity).toBeCloseTo(carbonFactor(1 / (4 * d * d)) ** 2, 9);
    const theta = peak.twoTheta * Math.PI / 360;
    expect(peak.intensity).toBeCloseTo(peak.structureFactorSquared * (1 + Math.cos(2 * theta) ** 2) / (Math.sin(theta) ** 2 * Math.cos(theta)), 6);
  }
  expect(Math.max(...pattern.peaks.map((peak) => peak.relativeIntensity))).toBe(100);
});

test("peaks aggregate reflections of equal d once each, and the enumeration matches a brute-force count", () => {
  const a = 4;
  const pattern = run({ atoms: place(cubic(a), [["C", [0, 0, 0]]]), cell: cubic(a), twoThetaMin: 20, twoThetaMax: 150 });
  const all = pattern.peaks.flatMap((peak) => peak.reflections.map((hkl) => hkl.join(",")));
  expect(new Set(all).size).toBe(all.length);
  for (const peak of pattern.peaks) {
    expect(peak.reflections.length).toBe(peak.multiplicity);
    const squares = new Set(peak.reflections.map(([h, k, l]) => h * h + k * k + l * l));
    expect(squares.size).toBe(1);
  }
  const coincident = pattern.peaks.find((peak) => peak.hkl.join("") === "300")!;
  expect(coincident.reflections.filter(([h, k, l]) => [h, k, l].map(Math.abs).sort().join("") === "003")).toHaveLength(6);
  expect(coincident.reflections.filter(([h, k, l]) => [h, k, l].map(Math.abs).sort().join("") === "122")).toHaveLength(24);
  let expected = 0;
  for (let h = -20; h <= 20; h++) for (let k = -20; k <= 20; k++) for (let l = -20; l <= 20; l++) {
    if (!h && !k && !l) continue;
    const angle = bragg(a / Math.hypot(h, k, l), CU);
    if (angle >= 20 && angle <= 150) expected++;
  }
  expect(pattern.peaks.reduce((sum, peak) => sum + peak.multiplicity, 0)).toBe(expected);
});

test("bcc iron: only h+k+l even reflects; the odd sums are counted as absences", () => {
  const cell = cubic(2.8665);
  const pattern = run({ atoms: place(cell, [["Fe", [0, 0, 0]], ["Fe", [0.5, 0.5, 0.5]]]), cell, twoThetaMax: 150 });
  expect(families(pattern)).toEqual(["1 1 0", "2 0 0", "2 1 1", "2 2 0", "3 1 0", "2 2 2"]);
  for (const peak of pattern.peaks) for (const [h, k, l] of peak.reflections) expect(Math.abs(h + k + l) % 2).toBe(0);
  // h^2+k^2+l^2 = 1, 3, 5, 9 (300 and 221), 11 up to 150° 2θ.
  expect(pattern.absentReflections).toBe(6 + 8 + 24 + 30 + 24);
});

test("fcc copper: mixed-parity reflections vanish", () => {
  const cell = cubic(3.615);
  const pattern = run({ atoms: place(cell, FCC.map((f) => ["Cu", f] as [string, Vec3])), cell, twoThetaMax: 150 });
  expect(families(pattern)).toEqual(["1 1 1", "2 0 0", "2 2 0", "3 1 1", "2 2 2", "4 0 0", "3 3 1", "4 2 0"]);
  for (const peak of pattern.peaks) for (const hkl of peak.reflections) expect(new Set(hkl.map((index) => Math.abs(index) % 2)).size).toBe(1);
});

test("a skew primitive cell of fcc copper gives the conventional cell's pattern, without any absences", () => {
  const conventional = cubic(3.615);
  const primitive = cellFromParameters({ a: 3.615 / Math.SQRT2, b: 3.615 / Math.SQRT2, c: 3.615 / Math.SQRT2, alpha: 60, beta: 60, gamma: 60 });
  const expected = run({ atoms: place(conventional, FCC.map((f) => ["Cu", f] as [string, Vec3])), cell: conventional });
  const actual = run({ atoms: place(primitive, [["Cu", [0.25, 0.5, 0.75]]]), cell: primitive });
  expect(actual.absentReflections).toBe(0);
  expect(actual.peaks.map((peak) => [peak.twoTheta.toFixed(8), peak.multiplicity, peak.relativeIntensity.toFixed(8)]))
    .toEqual(expected.peaks.map((peak) => [peak.twoTheta.toFixed(8), peak.multiplicity, peak.relativeIntensity.toFixed(8)]));
});

test("diamond from its Fd-3m CIF: the expanded cell has (200) and (222) absent and matches pymatgen", async () => {
  const crystal = await readCifCrystal(fixture("diamond-fd3m.cif"));
  expect(crystal.atoms).toHaveLength(8);
  const pattern = run({ atoms: crystal.atoms, cell: crystal.cell, twoThetaMax: 140 });
  expect(families(pattern)).toEqual(["1 1 1", "2 2 0", "3 1 1", "4 0 0"]);
  expect(pattern.peaks.map((peak) => peak.twoTheta.toFixed(3))).toEqual(["43.932", "75.300", "91.495", "119.504"]);
  expectReference(pattern, reference.cases["diamond-cu"]);
});

test("NaCl from its Fm-3m CIF matches pymatgen positions, multiplicities and relative intensities at Cu and Mo Kα1", async () => {
  const crystal = await readCifCrystal(fixture("nacl-fm3m.cif"));
  expect(crystal.atoms.map((atom) => atom.element).sort()).toEqual(["Cl", "Cl", "Cl", "Cl", "Na", "Na", "Na", "Na"]);
  const cu = run({ atoms: crystal.atoms, cell: crystal.cell, twoThetaMax: 90 });
  expect(families(cu).slice(0, 4)).toEqual(["1 1 1", "2 0 0", "2 2 0", "3 1 1"]);
  expectReference(cu, reference.cases["nacl-cu"]);
  const mo = run({ atoms: crystal.atoms, cell: crystal.cell, wavelength: MO, twoThetaMin: 5, twoThetaMax: 60 });
  expectReference(mo, reference.cases["nacl-mo"]);
  // A new wavelength moves peaks by Bragg's law; |F|^2 at each d is unchanged.
  for (const peak of cu.peaks) {
    const match = mo.peaks.find((other) => Math.abs(other.d - peak.d) < 1e-9)!;
    expect(match.twoTheta).toBeCloseTo(bragg(peak.d, MO), 9);
    expect(match.structureFactorSquared).toBeCloseTo(peak.structureFactorSquared, 6);
  }
});

test("an oblique triclinic cell matches pymatgen, and rotating or mirroring it changes nothing", () => {
  const triclinic = reference.cases["triclinic-cu"];
  const sites = triclinic.sites.map((site) => [site.element, site.fractional] as [string, Vec3]);
  const request = { wavelength: triclinic.wavelength, twoThetaMin: triclinic.twoThetaMin, twoThetaMax: triclinic.twoThetaMax };
  const pattern = run({ ...request, atoms: place(triclinic.lattice, sites), cell: triclinic.lattice });
  expectReference(pattern, triclinic);
  const turn = (v: Vec3): Vec3 => { const c = Math.cos(0.7), s = Math.sin(0.7); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2] + 0]; };
  const rotated = triclinic.lattice.map(turn) as UnitCell;
  const mirrored = triclinic.lattice.map(([x, y, z]) => [x, y, -z]) as UnitCell;
  const signature = (result: PowderPattern) => result.peaks.map((peak) => `${peak.twoTheta.toFixed(8)}:${peak.relativeIntensity.toFixed(6)}:${peak.multiplicity}`);
  expect(signature(run({ ...request, atoms: place(rotated, sites), cell: rotated }))).toEqual(signature(pattern));
  expect(signature(run({ ...request, atoms: place(mirrored, sites), cell: mirrored }))).toEqual(signature(pattern));
});

/** pymatgen uses different scattering-factor fits, which diverge slowly with sin θ/λ. */
function expectReference(pattern: PowderPattern, expected: ReferenceCase) {
  const peaks = visible(pattern);
  expect(peaks.length).toBe(expected.peaks.length);
  peaks.forEach((peak, index) => {
    const other = expected.peaks[index];
    expect(Math.abs(peak.twoTheta - other.twoTheta)).toBeLessThan(1e-6);
    expect(Math.abs(peak.d - other.d)).toBeLessThan(1e-8);
    expect(peak.multiplicity).toBe(other.multiplicity);
    expect(Math.abs(peak.relativeIntensity - other.relativeIntensity)).toBeLessThan(0.6);
    const stol = Math.sin(peak.twoTheta * Math.PI / 360) / pattern.wavelength;
    if (other.relativeIntensity >= 5 && stol <= 0.45) expect(Math.abs(peak.relativeIntensity / other.relativeIntensity - 1)).toBeLessThan(0.015);
  });
}

test("invalid, high-angle and oversized requests fail before the engine allocates anything", () => {
  let allocations = 0;
  const spy: XrdEngineExports = Object.assign(Object.create(null), {
    memory: engine.memory, free: engine.free, burette_xrd_count: engine.burette_xrd_count, burette_xrd_structure_factors: engine.burette_xrd_structure_factors,
    malloc: (size: number) => { allocations++; return engine.malloc(size); },
  });
  const cell = cubic(4);
  const atoms = place(cell, [["Cu", [0, 0, 0]]]);
  const failure = (request: Partial<PowderXrdRequest>) => {
    try { computePowderPattern(spy, { atoms, cell, wavelength: CU, twoThetaMin: 10, twoThetaMax: 90, ...request }); } catch (error) { return (error as Error).message; }
    throw new Error("expected a rejection");
  };
  expect(failure({ wavelength: Number.NaN })).toContain("wavelength");
  expect(failure({ wavelength: 12 })).toContain("wavelength");
  expect(failure({ twoThetaMax: 175 })).toContain("170");
  expect(failure({ twoThetaMin: 60, twoThetaMax: 60 })).toContain("end after it starts");
  expect(failure({ wavelength: 0.2, twoThetaMax: 120 })).toContain("sin θ/λ ≤ 2");
  expect(failure({ atoms: [] })).toContain("no atoms");
  expect(failure({ atoms: [{ element: "Es", x: 0, y: 0, z: 0 }] })).toContain("no tabulated X-ray scattering factor");
  expect(failure({ atoms: [{ element: "Xx", x: 0, y: 0, z: 0 }] })).toContain("not a chemical element");
  expect(failure({ atoms: [...atoms, { element: "Cu", x: 4, y: 0, z: 4 }] })).toContain("same site");
  expect(failure({ atoms: [{ element: "Cu", x: Number.POSITIVE_INFINITY, y: 0, z: 0 }] })).toContain("non-finite");
  expect(failure({ cell: [[4, 0, 0], [0, 4, 0], [4, 4, 0]] })).toContain("coplanar");
  expect(failure({ cell: [[0.5, 0, 0], [0, 4, 0], [0, 0, 4]] })).toContain("Cell edges");
  expect(failure({ cell: cubic(200), atoms, twoThetaMax: 170 })).toContain("reflections fall in this 2θ range");
  expect(failure({ atoms: Array.from({ length: 2001 }, (_, i) => ({ element: "C", x: i * 0.2, y: 0, z: 0 })) })).toContain("2000 atoms");
  expect(allocations).toBe(0);
  // The module checks its own input too.
  const parameters = engine.malloc(48);
  new Float64Array(engine.memory.buffer, parameters, 6).set([Number.NaN, 4, 4, 90, 90, 90]);
  expect(engine.burette_xrd_count(parameters, 1, 0)).toBe(-1);
  new Float64Array(engine.memory.buffer, parameters, 6).set([4, 4, 4, 90, 90, 90]);
  expect(engine.burette_xrd_count(parameters, 0.1, 0)).toBe(-3);
  new Float64Array(engine.memory.buffer, parameters, 6).set([900, 900, 900, 90, 90, 90]);
  expect(engine.burette_xrd_count(parameters, 0.3, 0)).toBe(-4);
  engine.free(parameters);
  expect(powderSettingsProblem({ wavelength: CU, twoThetaMin: 0, twoThetaMax: 170 })).toBeNull();
  const highAngle = run({ atoms, cell, twoThetaMin: 0, twoThetaMax: 170 });
  expect(highAngle.peaks.every((peak) => Number.isFinite(peak.intensity) && peak.twoTheta <= 170)).toBe(true);
});

test("duplicate sites and short translations are found in any basis of the same lattice", () => {
  const atoms = [{ element: "C", x: 0, y: 0, z: 0 }, { element: "C", x: 0.05, y: 0.05, z: 0 }];
  const skew: UnitCell = [[5, 0, 0], [500, 5, 0], [0, 0, 5]];
  for (const cell of [cubic(5), skew]) expect(() => run({ atoms, cell, twoThetaMax: 90 })).toThrow("0.071 Å apart");
  // b' = b + 100a: the same lattice, so the same pattern.
  const sites = [{ element: "C", x: 0, y: 0, z: 0 }, { element: "O", x: 2.5, y: 2.5, z: 1 }];
  const signature = (cell: UnitCell) => run({ atoms: sites, cell, twoThetaMax: 90 }).peaks.map((peak) => `${peak.twoTheta.toFixed(8)}:${peak.relativeIntensity.toFixed(6)}:${peak.multiplicity}`);
  expect(signature(skew)).toEqual(signature(cubic(5)));
  // Edges of 5 Å, yet b - a is 0.071 Å long.
  expect(() => run({ atoms: sites.slice(0, 1), cell: [[5, 0, 0], [5.05, 0.05, 0], [0, 0, 5]] })).toThrow("repeats every 0.071 Å");
});

// ---- profiles: checked against the stated functions, whatever the sampling ------------

type Profile = ReturnType<typeof broadenPattern>;
const sticks = (pairs: [number, number][]) => pairs.map(([twoTheta, relativeIntensity]) => ({ twoTheta, relativeIntensity })) as PowderPattern["peaks"];
/** Unit-height line shapes of the given FWHM. */
const LINE = {
  gaussian: (offset: number, fwhm: number) => Math.exp(-4 * Math.LN2 * (offset / fwhm) ** 2),
  lorentzian: (offset: number, fwhm: number) => 1 / (1 + 4 * (offset / fwhm) ** 2),
};
/** Straight lines between the samples, as a plot or a spreadsheet reads the curve. */
function interpolate(profile: Profile, x: number) {
  const { twoTheta, intensity } = profile;
  let low = 0, high = twoTheta.length - 1;
  while (high - low > 1) { const middle = (low + high) >> 1; if (twoTheta[middle] <= x) low = middle; else high = middle; }
  return intensity[low] + (intensity[high] - intensity[low]) * (x - twoTheta[low]) / (twoTheta[high] - twoTheta[low]);
}
/** Position of the highest sample and the interpolated width at half its height. */
function measure(profile: Profile) {
  const { twoTheta, intensity } = profile;
  const top = intensity.indexOf(Math.max(...intensity));
  const half = intensity[top] / 2;
  let left = top, right = top;
  while (left > 0 && intensity[left] >= half) left--;
  while (right < intensity.length - 1 && intensity[right] >= half) right++;
  const cross = (outside: number, inside: number) => twoTheta[outside] + (half - intensity[outside]) / (intensity[inside] - intensity[outside]) * (twoTheta[inside] - twoTheta[outside]);
  return { center: twoTheta[top], fwhm: cross(right, right - 1) - cross(left, left + 1) };
}
const area = (profile: Profile) => profile.twoTheta.reduce((sum, x, index) => index ? sum + (x - profile.twoTheta[index - 1]) * (profile.intensity[index] + profile.intensity[index - 1]) / 2 : 0, 0);

test("a 0.001° FWHM over 0–170° keeps the peak's centre, width and area", () => {
  // Unit-height Gaussian area: FWHM · √(π / 4 ln 2); Lorentzian: FWHM · π / 2.
  const areas = { gaussian: Math.sqrt(Math.PI / (4 * Math.LN2)), lorentzian: Math.PI / 2 };
  for (const shape of ["gaussian", "lorentzian"] as const) {
    const profile = broadenPattern({ peaks: sticks([[85.003, 100]]), twoThetaMin: 0, twoThetaMax: 170 }, shape, 0.001);
    const { center, fwhm } = measure(profile);
    expect(Math.abs(center - 85.003)).toBeLessThan(1e-9);
    expect(Math.abs(fwhm / 0.001 - 1)).toBeLessThan(0.01);
    expect(Math.abs(area(profile) / (100 * 0.001 * areas[shape]) - 1)).toBeLessThan(0.01);
    expect([profile.twoTheta[0], profile.twoTheta.at(-1)]).toEqual([0, 170]);
  }
});

test("both ends of the range are samples, and a peak beside the upper end keeps its full height", () => {
  for (const shape of ["gaussian", "lorentzian"] as const) {
    const profile = broadenPattern({ peaks: sticks([[0.5, 100], [1.004, 100]]), twoThetaMin: 0, twoThetaMax: 1.005 }, shape, 0.1);
    expect([profile.twoTheta[0], profile.twoTheta.at(-1)]).toEqual([0, 1.005]);
    const model = (x: number) => LINE[shape](x - 0.5, 0.1) + LINE[shape](x - 1.004, 0.1);
    const scale = 100 / model(1.004);
    for (const x of [0, 0.5, 1.004, 1.005]) expect(Math.abs(interpolate(profile, x) - scale * model(x))).toBeLessThan(0.5);
    expect(Math.abs(interpolate(profile, 1.004) - interpolate(profile, 0.5))).toBeLessThan(0.5);
  }
});

test("the sampled curve follows the stated sum of line shapes within 0.5 % of its maximum, at narrow and broad FWHM", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const peaks = sticks(Array.from({ length: 12 }, () => [12 + random() * 76, 5 + random() * 95]));
  peaks.push(...sticks([[40, 80], [40.0004, 60], [40.03, 90]]));
  for (const shape of ["gaussian", "lorentzian"] as const) {
    for (const fwhm of [0.001, 0.02, 0.3, 3]) {
      const profile = broadenPattern({ peaks, twoThetaMin: 10, twoThetaMax: 90 }, shape, fwhm);
      const model = (x: number) => peaks.reduce((sum, peak) => sum + peak.relativeIntensity * LINE[shape](x - peak.twoTheta, fwhm), 0);
      // Probes: a dense uniform sweep, plus every centre and the region around it at FWHM resolution.
      const probes = Array.from({ length: 40_001 }, (_, index) => 10 + index * 80 / 40_000);
      for (const peak of peaks) for (let offset = -4; offset <= 4; offset += 0.05) probes.push(Math.min(90, Math.max(10, peak.twoTheta + offset * fwhm)));
      const reference = probes.map(model);
      const scale = 100 / Math.max(...reference);
      const worst = probes.reduce((max, x, index) => Math.max(max, Math.abs(interpolate(profile, x) - scale * reference[index])), 0);
      expect(worst).toBeLessThan(0.5);
    }
  }
  expect(() => broadenPattern({ peaks, twoThetaMin: 10, twoThetaMax: 90 }, "gaussian", 0)).toThrow("FWHM");
});

test("a profile beyond the sampling budget is refused with an FWHM that fits", () => {
  const peaks = sticks(Array.from({ length: 20_000 }, (_, index) => [10 + index * 0.004, 50 + (index % 7) * 5]));
  let message = "";
  try { broadenPattern({ peaks, twoThetaMin: 10, twoThetaMax: 90 }, "gaussian", 0.001); } catch (error) { message = (error as Error).message; }
  const suggested = Number(message.match(/at least ([\d.]+)°/u)?.[1]);
  expect(message).toContain("20,000 peaks");
  expect(suggested).toBeGreaterThan(0.001);
  expect(suggested).toBeLessThanOrEqual(5);
  const profile = broadenPattern({ peaks, twoThetaMin: 10, twoThetaMax: 90 }, "gaussian", suggested);
  expect(profile.twoTheta.length).toBeLessThanOrEqual(PROFILE_LIMITS.points);
});

test("CSV and JSON exports carry every peak with the actual settings, units and model", () => {
  const cell = cubic(5.6402);
  const atoms = place(cell, [...FCC.map((f) => ["Na", f] as [string, Vec3]), ...FCC.map((f) => ["Cl", f.map((v) => (v + 0.5) % 1) as Vec3] as [string, Vec3])]);
  const pattern = run({ atoms, cell, twoThetaMax: 90 });
  const profile = broadenPattern(pattern, "gaussian", 0.15);
  const context = { title: "NaCl, \"rock salt\"", radiation: "Cu Kα1", profile, engine: XRD_ENGINE };
  const csv = powderPatternCsv(pattern, context).trimEnd().split("\n");
  expect(csv.filter((line) => line.startsWith("#"))).toContain("# Wavelength: 1.5405929 Å (Cu Kα1)");
  expect(csv.some((line) => line.includes("no Kα2 component"))).toBe(true);
  expect(csv.some((line) => line.includes("B = 0 Å²"))).toBe(true);
  const rows = csv.filter((line) => !line.startsWith("#"));
  expect(rows[0]).toBe("two_theta_deg,d_angstrom,relative_intensity,intensity_e2,structure_factor_sq_e2,multiplicity,h,k,l");
  expect(rows).toHaveLength(pattern.peaks.length + 1);
  expect(rows[2].split(",").slice(-4)).toEqual(["6", "2", "0", "0"]);
  const json = JSON.parse(powderPatternJson(pattern, context));
  expect(json.settings).toEqual({ radiation: "Cu Kα1", wavelengthAngstrom: CU, twoThetaMinDegrees: 10, twoThetaMaxDegrees: 90 });
  expect(json.source.composition).toEqual({ Na: 4, Cl: 4 });
  expect(json.peaks).toHaveLength(pattern.peaks.length);
  expect(json.peaks[1].reflections).toHaveLength(6);
  expect(json.profile.fwhmDegrees).toBe(0.15);
  expect(json.profile.twoTheta).toHaveLength(profile.twoTheta.length);
  expect(json.model.engine).toContain("Gemmi 0.7.5");
});

// ---- worker client ---------------------------------------------------------------

const RealWorker = globalThis.Worker;
afterEach(() => { globalThis.Worker = RealWorker; });

class FakeWorker {
  static last: FakeWorker | null = null;
  terminated = false;
  posted: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  constructor() { FakeWorker.last = this; }
  postMessage(message: unknown) { this.posted.push(message); }
  terminate() { this.terminated = true; }
}

test("cancelling a pattern terminates its worker and ignores a late result", async () => {
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const cell = cubic(4);
  const request = { atoms: place(cell, [["Cu", [0, 0, 0]]]), cell, wavelength: CU, twoThetaMin: 10, twoThetaMax: 90 };
  const controller = new AbortController();
  const pending = runPowderXrdTask(request, { signal: controller.signal });
  const worker = FakeWorker.last!;
  expect(worker.posted).toEqual([request]);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(worker.terminated).toBe(true);
  worker.onmessage?.({ data: { ok: true, result: { peaks: [] } } });

  const timed = runPowderXrdTask(request, { timeoutMs: 5 });
  await expect(timed).rejects.toThrow("time limit");
  expect(FakeWorker.last!.terminated).toBe(true);

  const failing = runPowderXrdTask(request);
  FakeWorker.last!.onmessage?.({ data: { ok: false, error: "The cell has no atoms." } });
  await expect(failing).rejects.toThrow("no atoms");
});
