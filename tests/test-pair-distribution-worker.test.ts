import { expect, test } from "bun:test";
import { computePairDistribution, selectPairs, pairDistributionCsv, pairDistributionJson, type PairDistributionRequest } from "../apps/desktop/src/lib/molecular-workbench/pair-distribution/pair-distribution";
import { runPairDistributionTask } from "../apps/desktop/src/lib/molecular-workbench/pair-distribution/pair-distribution-client";

const request: PairDistributionRequest = {
  atoms: [{ element: "Na", x: 0, y: 0, z: 0 }, { element: "Cl", x: 2, y: 0, z: 0 }],
  cell: [[4, 0, 0], [0, 4, 0], [0, 0, 4]], rMax: 4.1, binWidth: 0.1,
};

test("the real worker transfers periodic species histograms and preserves radial normalisation", async () => {
  const result = await runPairDistributionTask(request);
  expect(result).toEqual(computePairDistribution(request));
  expect(result.counts).toBeInstanceOf(Float64Array);
  expect(result.minDistance).toBeInstanceOf(Float64Array);
  const unlike = selectPairs(result, "Na", "Cl");
  // The neighbour at +2 Å and its lattice image at -2 Å are both counted.
  expect(unlike.counts[20]).toBe(2);
  expect(unlike.coordination.at(-1)).toBe(2);
  expect(unlike.minDistance).toBe(2);
  expect(unlike.g[20]).toBeCloseTo(64 * 2 / (4 / 3 * Math.PI * (2.1 ** 3 - 2 ** 3)), 9);
  const same = selectPairs(result, "Na", "Na");
  expect(same.counts[0]).toBe(0);
  expect(same.coordination.at(-1)).toBe(6);
  expect(same.minDistance).toBe(4);
  const context = { title: "NaCl.xyz", engine: "Burette periodic radial distribution 1" };
  const json = JSON.parse(pairDistributionJson(result, unlike, context));
  expect(json.settings).toEqual({ rMax: 41 * 0.1, binWidth: 0.1, bins: 41, boundary: "periodic" });
  expect(json.selection).toMatchObject({ centre: "Na", neighbour: "Cl", centreCount: 1, neighbourCount: 1 });
  expect(json.histograms).toHaveLength(4);
  expect(pairDistributionCsv(result, unlike, context)).toContain("r_low_angstrom,r_high_angstrom,r_center_angstrom,pair_count,g_r,coordination_number");
});

test("worker validation preserves concrete remedies; cancel and timeout stop the calculation", async () => {
  await expect(runPairDistributionTask({ ...request, binWidth: 0 })).rejects.toThrow("bin width must be between");
  await expect(runPairDistributionTask({ ...request, atoms: [request.atoms[0], { ...request.atoms[1], x: 4 }] })).rejects.toThrow("Remove the duplicate first");
  const controller = new AbortController();
  const running = runPairDistributionTask(request, { signal: controller.signal });
  controller.abort();
  await expect(running).rejects.toMatchObject({ name: "AbortError" });
  await expect(runPairDistributionTask(request, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
  await expect(runPairDistributionTask(request, { timeoutMs: 0 })).rejects.toThrow("Lower r max");
});

test("oblique-cell histograms agree with an independent Cartesian image enumeration", () => {
  const input: PairDistributionRequest = { cell: [[8, 0, 0], [7, 2, 0], [0, 0, 6]], rMax: 4.25, binWidth: 0.25,
    atoms: [{ element: "Na", x: 0, y: 0, z: 0 }, { element: "Na", x: 1, y: 0.5, z: 1.5 }, { element: "Cl", x: 7.5, y: 1, z: 0.75 }] };
  // Heights are 16/sqrt(53), 2, 6 Å. For a displacement inside 4.25 Å,
  // |dy + 2b| < 4.25 gives |b| <= 2, |dz + 6c| < 4.25 gives |c| <= 1,
  // and |dx + 8a + 7b| < 4.25 gives |a| <= 3. Thus [-4,4]^3 is complete.
  // No fractional wrapping, reciprocal vectors, pair symmetry or production bin helper.
  const bins = 17, expected = new Float64Array(4 * bins), minimum = new Float64Array(4).fill(Infinity);
  const species = ["Na", "Cl"], populations = [2, 1], volume = 96;
  for (const left of input.atoms) for (const right of input.atoms) {
    const pair = species.indexOf(left.element) * 2 + species.indexOf(right.element);
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) for (let c = -4; c <= 4; c++) {
      if (left === right && a === 0 && b === 0 && c === 0) continue;
      const d = Math.hypot(right.x - left.x + 8 * a + 7 * b, right.y - left.y + 2 * b, right.z - left.z + 6 * c);
      for (let k = 0; k < bins; k++) if (d >= k / 4 && d < (k + 1) / 4) {
        expected[pair * bins + k]++; minimum[pair] = Math.min(minimum[pair], d); break;
      }
    }
  }
  const result = computePairDistribution(input);
  expect(result.counts).toEqual(expected);
  expect(result.pairs).toBe(expected.reduce((sum, n) => sum + n, 0));
  expect(result.volume).toBe(volume);
  minimum.forEach((value, i) => expect(result.minDistance[i]).toBeCloseTo(value, 12));
  // The Na(0)-Cl fractional displacement is (.5,.5,.125): component wrapping
  // picks a 7.60 Å image, while a mixed-sign image is only sqrt(1.8125) Å away.
  expect(Math.hypot(7.5, 1, 0.75)).toBeGreaterThan(input.rMax);
  expect(minimum[1]).toBeCloseTo(Math.sqrt(1.8125), 12);
  for (const centres of [[0], [1], [0, 1]]) for (const neighbours of [[0], [1], [0, 1]]) {
    const selected = selectPairs(result, centres.length === 2 ? null : species[centres[0]], neighbours.length === 2 ? null : species[neighbours[0]]);
    const counts = Array.from({ length: bins }, (_, k) => centres.reduce((sum, a) => sum + neighbours.reduce((n, b) => n + expected[(a * 2 + b) * bins + k], 0), 0));
    expect(Array.from(selected.counts)).toEqual(counts);
    const na = centres.reduce((n, a) => n + populations[a], 0), nb = neighbours.reduce((n, b) => n + populations[b], 0);
    let cumulative = 0;
    counts.forEach((n, k) => {
      cumulative += n;
      expect(selected.coordination[k]).toBeCloseTo(cumulative / na, 12);
      const shell = (4 * Math.PI / 3) * (((k + 1) / 4) ** 3 - (k / 4) ** 3);
      expect(selected.g[k]).toBeCloseTo(n * volume / (na * nb * shell), 12);
    });
  }
});

test("bins include their lower edge and exclude the cutoff without an epsilon band", () => {
  const epsilon = 2 ** -30;
  for (const [distance, bin] of [[1 - epsilon, 3], [1, 4], [1 + epsilon, 4], [2 - epsilon, 7], [2, -1], [2 + epsilon, -1]]) {
    const result = computePairDistribution({ cell: [[16, 0, 0], [0, 16, 0], [0, 0, 16]], rMax: 2, binWidth: 0.25,
      atoms: [{ element: "Na", x: 0, y: 0, z: 0 }, { element: "Cl", x: distance, y: 0, z: 0 }] });
    const expected = new Float64Array(32);
    if (bin >= 0) { expected[8 + bin] = 1; expected[16 + bin] = 1; }
    expect(result.counts).toEqual(expected);
  }
});

test("global and independent atom lattice translations preserve periodic histograms", () => {
  const source: PairDistributionRequest = { cell: [[8, 0, 0], [7, 2, 0], [0, 0, 6]], rMax: 4.25, binWidth: 0.25,
    atoms: [{ element: "Na", x: 0, y: 0, z: 0 }, { element: "Cl", x: 7.5, y: 1, z: 0.75 }] };
  const reference = computePairDistribution(source);
  for (const translations of [[[3, -2, 1], [3, -2, 1]], [[-4, 3, -2], [5, -3, 4]]]) {
    const shifted = computePairDistribution({ ...source, atoms: source.atoms.map((atom, i) => {
      const [a, b, c] = translations[i];
      return { ...atom, x: atom.x + 8 * a + 7 * b, y: atom.y + 2 * b, z: atom.z + 6 * c };
    }) });
    expect(shifted.counts).toEqual(reference.counts);
    expect(shifted.pairs).toBe(reference.pairs);
    shifted.minDistance.forEach((distance, i) => expect(distance).toBeCloseTo(reference.minDistance[i], 12));
  }
});

test("huge finite lattice offsets stay bounded and fractional overflow rejects before enumeration", () => {
  // The previous unnormalised loop cannot advance this integer. Do not execute it.
  const oldLowerBound = Math.ceil(-(2 ** 55) - 1);
  expect(oldLowerBound + 1).toBe(oldLowerBound);
  const source: PairDistributionRequest = { cell: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], rMax: 1, binWidth: 0.25,
    atoms: [{ element: "Na", x: 0, y: 0, z: 0 }, { element: "Cl", x: 0, y: 0.5, z: 0 }] };
  const reference = computePairDistribution(source);
  const large = computePairDistribution({ ...source, atoms: [{ ...source.atoms[0], x: 2 ** 55 }, source.atoms[1]] });
  expect(large).toEqual(reference);
  expect(large.evaluations).toBeLessThan(100);
  expect(() => computePairDistribution({ ...source, cell: [[0.75, 0.75, 0], [-0.75, 0.75, 0], [0, 0, 2]],
    atoms: [{ element: "Na", x: 1.7e308, y: 1.7e308, z: 0 }] })).toThrow("overflows fractional coordinates");
});
