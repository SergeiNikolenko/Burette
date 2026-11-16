import { describe, expect, test } from "bun:test";
import { analyzePointGroup, type PointGroupAtom, type PointGroupResult } from "../apps/desktop/src/lib/molecular-workbench/symmetry/point-group";
import { createLatestSymmetryRunner, runSymmetryTask } from "../apps/desktop/src/lib/molecular-workbench/symmetry/symmetry-client";
import { instantiateStandaloneWasm } from "../apps/desktop/src/lib/molecular-workbench/symmetry/wasm-module";
import type { UnitCell, Vec3 } from "../apps/desktop/src/lib/molecular-workbench/types";

const engineDirectory = new URL("../apps/desktop/src/lib/molecular-workbench/symmetry/", import.meta.url);
const msym = await instantiateStandaloneWasm(new URL("burette-msym.wasm", engineDirectory));
const detect = (atoms: PointGroupAtom[], tolerance?: "tight" | "normal") => analyzePointGroup(msym, { atoms, tolerance }, "detect");
const symmetrize = (atoms: PointGroupAtom[], tolerance?: "tight" | "normal") => analyzePointGroup(msym, { atoms, tolerance }, "symmetrize");

// Independent canonical geometries (angstrom); expected groups come from
// standard chemistry tables, not from libmsym output.
const atom = (element: string, x: number, y: number, z: number, isotope?: number): PointGroupAtom => ({ element, x, y, z, ...(isotope ? { isotope } : {}) });
const rOH = 0.9572, hoh = 104.52 * Math.PI / 180;
const water = (h1 = "H", h2 = "H", isotopes: [number?, number?] = []) => [
  atom("O", 0, 0, 0),
  atom(h1, rOH * Math.sin(hoh / 2), 0, rOH * Math.cos(hoh / 2), isotopes[0]),
  atom(h2, -rOH * Math.sin(hoh / 2), 0, rOH * Math.cos(hoh / 2), isotopes[1]),
];
const tetra = 1.089 / Math.sqrt(3);
const methane = (substituents: string[] = ["H", "H", "H", "H"], isotopes: (number | undefined)[] = []) => [
  atom("C", 0, 0, 0),
  ...[[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map(([x, y, z], index) => atom(substituents[index], tetra * x, tetra * y, tetra * z, isotopes[index])),
];
const benzene = Array.from({ length: 6 }, (_, k) => {
  const t = k * Math.PI / 3;
  return [atom("C", 1.397 * Math.cos(t), 1.397 * Math.sin(t), 0), atom("H", 2.481 * Math.cos(t), 2.481 * Math.sin(t), 0)];
}).flat();
const carbonDioxide = [atom("C", 0, 0, 0), atom("O", 0, 0, 1.162), atom("O", 0, 0, -1.162)];
const bromochlorofluoromethane = [atom("C", 0, 0, 0), atom("H", 0.31, 0.27, 1.02), atom("F", 1.29, 0.12, -0.41), atom("Cl", -0.77, 1.46, -0.63), atom("Br", -0.92, -1.53, -0.71)];
const sulfurHexafluoride = [atom("S", 0, 0, 0), ...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => atom("F", 1.564 * x, 1.564 * y, 1.564 * z))];
// Truncated icosahedron: even permutations of (0, ±1, ±3φ), (±1, ±(2+φ), ±2φ), (±φ, ±2, ±φ³).
const phi = (1 + Math.sqrt(5)) / 2;
const fullerene = (() => {
  const seeds = [[0, 1, 3 * phi], [1, 2 + phi, 2 * phi], [phi, 2, phi ** 3]];
  const points = new Map<string, Vec3>();
  for (const seed of seeds) for (const signs of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]]) {
    const signed = seed.map((value, index) => value * signs[index]);
    for (const shift of [0, 1, 2]) {
      const point = [0, 1, 2].map(index => signed[(index + shift) % 3] * 0.7) as Vec3;
      points.set(point.map(value => value.toFixed(6)).join(","), point);
    }
  }
  return [...points.values()].map(([x, y, z]) => atom("C", x, y, z));
})();

const partition = (result: PointGroupResult) => result.equivalenceSets.map(set => [...set.atoms].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
const transformPoint = (matrix: Vec3[], center: Vec3, point: Vec3) => [0, 1, 2].map(row => center[row] + matrix[row].reduce((sum, value, k) => sum + value * (point[k] - center[k]), 0)) as Vec3;
const determinant3 = (m: Vec3[]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

/** Checks every finite operation independently: orthogonal matrix with the
 * determinant its kind requires, mapping the structure onto itself with
 * like atoms (element and isotope) exchanged only within one equivalence set. */
function expectOperationsMapStructure(result: PointGroupResult, atoms: PointGroupAtom[], coordinates: Vec3[], tolerance: number) {
  const setOf = new Map(result.equivalenceSets.flatMap((set, index) => set.atoms.map(member => [member, index] as const)));
  for (const operation of result.operations) {
    if (!operation.matrix) {
      expect(operation.order).toBeNull();
      continue;
    }
    const m = operation.matrix;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(m[0][i] * m[0][j] + m[1][i] * m[1][j] + m[2][i] * m[2][j]).toBeCloseTo(i === j ? 1 : 0, 9);
    expect(determinant3(m)).toBeCloseTo(operation.kind === "identity" || operation.kind === "rotation" ? 1 : -1, 9);
    coordinates.forEach((point, index) => {
      const image = transformPoint(m, result.center, point);
      const distances = coordinates.map(other => Math.hypot(other[0] - image[0], other[1] - image[1], other[2] - image[2]));
      const match = distances.indexOf(Math.min(...distances));
      expect(distances[match]).toBeLessThan(tolerance);
      expect([atoms[match].element, atoms[match].isotope]).toEqual([atoms[index].element, atoms[index].isotope]);
      expect(setOf.get(match)).toBe(setOf.get(index));
    });
  }
}

const coordinatesOf = (atoms: PointGroupAtom[]) => atoms.map(item => [item.x, item.y, item.z] as Vec3);

describe("libmsym point groups", () => {
  test.each([
    ["water", water(), "C2v", 4, [[0], [1, 2]]],
    ["methane", methane(), "Td", 24, [[0], [1, 2, 3, 4]]],
    ["benzene", benzene, "D6h", 24, [[0, 2, 4, 6, 8, 10], [1, 3, 5, 7, 9, 11]]],
    ["sulfur hexafluoride", sulfurHexafluoride, "Oh", 48, [[0], [1, 2, 3, 4, 5, 6]]],
    ["bromochlorofluoromethane", bromochlorofluoromethane, "C1", 1, [[0], [1], [2], [3], [4]]],
  ] as const)("%s is %s with exact operations", (_, atoms, group, order, sets) => {
    const result = detect([...atoms]);
    expect([result.pointGroup, result.order, result.operations.length, partition(result)]).toEqual([group, order, order, sets.map(set => [...set])]);
    expectOperationsMapStructure(result, [...atoms], coordinatesOf([...atoms]), 1e-6);
  });

  test("C60 is Ih with 120 operations and one equivalence set", () => {
    expect(fullerene).toHaveLength(60);
    const result = symmetrize(fullerene);
    expect([result.pointGroup, result.operations.length, result.equivalenceSets.length]).toEqual(["Ih", 120, 1]);
    expect(result.maxDisplacement).toBeLessThan(1e-6);
    expectOperationsMapStructure(result, fullerene, result.coordinates, 1e-8);
  });

  test("linear molecules report infinite groups with a continuous axis", () => {
    const co2 = detect(carbonDioxide);
    expect([co2.pointGroup, co2.libmsymPointGroup, co2.order, partition(co2)]).toEqual(["D∞h", "D0h", null, [[0], [1, 2]]]);
    const axis = co2.operations.find(operation => operation.order === null)!;
    expect(axis.kind).toBe("rotation");
    expect(axis.matrix).toBeNull();
    expect(Math.abs(axis.axis![2])).toBeCloseTo(1, 9);
    expectOperationsMapStructure(co2, carbonDioxide, coordinatesOf(carbonDioxide), 1e-9);
    const hcn = detect([atom("H", 0, 0, -1.064), atom("C", 0, 0, 0), atom("N", 0, 0, 1.156)]);
    expect([hcn.pointGroup, hcn.order]).toEqual(["C∞v", null]);
    expect(detect([atom("H", 0, 0, -1.663), atom("C", 0, 0, -0.601), atom("C", 0, 0, 0.601), atom("H", 0, 0, 1.663)]).pointGroup).toBe("D∞h");
  });

  test("a single atom is spherical Kh without libmsym operations", () => {
    const result = symmetrize([atom("Ar", 1, 2, 3)]);
    expect([result.pointGroup, result.order, result.operations, result.equivalenceSets, result.coordinates, result.center]).toEqual(["Kh", null, [], [{ atoms: [0], error: 0 }], [[1, 2, 3]], [1, 2, 3]]);
  });

  test("elements and isotopes are distinct while an explicit default isotope is not", () => {
    expect(detect(water("H", "H", [2, undefined])).pointGroup).toBe("Cs");
    expect(detect(water("H", "H", [2, 2])).pointGroup).toBe("C2v");
    expect(detect(water("H", "H", [1, undefined])).pointGroup).toBe("C2v");
    expect(detect(water("H", "F")).pointGroup).toBe("Cs");
    expect(detect(methane(["H", "H", "H", "H"], [2])).pointGroup).toBe("C3v");
    expect(detect(methane(["H", "H", "H", "H"], [2, 2])).pointGroup).toBe("C2v");
    expect(detect(methane(["F", "H", "H", "H"])).pointGroup).toBe("C3v");
    expect(detect(methane(["F", "Cl", "H", "H"])).pointGroup).toBe("Cs");
  });

  test("results are invariant under a proper rigid transform", () => {
    const [qw, qx, qy, qz] = (() => { const q = [0.83, 0.21, -0.37, 0.36]; const n = Math.hypot(...q); return q.map(value => value / n); })();
    const rotation: Vec3[] = [
      [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
      [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
      [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ];
    const shift: Vec3 = [3.2, -7.5, 11.25];
    const move = (point: Vec3) => transformPoint(rotation, [0, 0, 0], point).map((value, index) => value + shift[index]) as Vec3;
    for (const molecule of [water(), methane(), benzene, carbonDioxide]) {
      const noisy = molecule.map((item, index) => ({ ...item, x: item.x + 2e-5 * Math.sin(index + 1), y: item.y + 2e-5 * Math.cos(2 * index), z: item.z - 1e-5 * index }));
      const moved = noisy.map(item => { const [x, y, z] = move([item.x, item.y, item.z]); return { ...item, x, y, z }; });
      const original = symmetrize(noisy);
      const transformed = symmetrize(moved);
      expect([transformed.pointGroup, transformed.operations.length, partition(transformed)]).toEqual([original.pointGroup, original.operations.length, partition(original)]);
      original.coordinates.forEach((point, index) => move(point).forEach((value, axis) => expect(transformed.coordinates[index][axis]).toBeCloseTo(value, 8)));
      move(original.center).forEach((value, axis) => expect(transformed.center[axis]).toBeCloseTo(value, 9));
    }
  });

  test("near-symmetric input is symmetrized in place and mapped back by input index", () => {
    const noise = [[1e-4, -2e-4, 1e-4], [-1.5e-4, 1e-4, 2e-4], [2e-4, 1e-4, -1e-4]];
    const noisy = water().map((item, index) => ({ ...item, x: item.x + noise[index][0], y: item.y + noise[index][1], z: item.z + noise[index][2] }));
    const detected = detect(noisy);
    const result = symmetrize(noisy);
    expect([detected.pointGroup, result.pointGroup]).toEqual(["C2v", "C2v"]);
    expect(result.coordinates).toHaveLength(3);
    expect(result.maxDisplacement).toBeGreaterThan(1e-5);
    expect(result.maxDisplacement).toBeLessThan(5e-4);
    expect(result.symmetrizationError).toBeGreaterThan(0);
    // Each output row belongs to the input atom at the same index.
    result.coordinates.forEach((point, index) => expect(Math.hypot(point[0] - noisy[index].x, point[1] - noisy[index].y, point[2] - noisy[index].z)).toBeLessThan(5e-4));
    expectOperationsMapStructure(result, noisy, result.coordinates, 1e-9);
    const hydrogenDistances = [1, 2].map(index => Math.hypot(...result.coordinates[index].map((value, axis) => value - result.coordinates[0][axis])));
    expect(hydrogenDistances[0]).toBeCloseTo(hydrogenDistances[1], 10);
    // Symmetrization keeps the mass-weighted center that the operations use.
    expect(result.center).toEqual(detected.center);
    const masses = [16, 1, 1];
    const center = [0, 1, 2].map(axis => result.coordinates.reduce((sum, point, index) => sum + masses[index] * point[axis], 0) / 18);
    center.forEach((value, axis) => expect(value).toBeCloseTo(result.center[axis], 12));
    // Re-symmetrizing is idempotent, so an Undo entry can store input and output directly.
    const again = symmetrize(result.coordinates.map(([x, y, z], index) => ({ ...noisy[index], x, y, z })));
    expect([again.pointGroup, again.maxDisplacement < 1e-10]).toEqual(["C2v", true]);
    expect(structuredClone(result)).toEqual(result);
  });

  test("detection leaves coordinates alone and tighter tolerance resolves less symmetry", () => {
    const distorted = water().map((item, index) => ({ ...item, x: item.x + 3e-3 * (index - 1), y: item.y + 2e-3 * (index % 2), z: item.z - 1e-3 * index }));
    expect("coordinates" in detect(distorted)).toBe(false);
    expect([detect(distorted).pointGroup, detect(distorted, "normal").pointGroup]).toEqual(["Cs", "C2v"]);
    expect(detect(distorted, "normal").tolerance).toBe("normal");
  });

  test.each([
    ["no atoms", { atoms: [] }, /no atoms/],
    ["oversize", { atoms: Array.from({ length: 257 }, (_, index) => atom("C", index * 1.5, 0, 0)) }, /at most 256/],
    ["non-finite", { atoms: [atom("C", 0, 0, 0), atom("O", Number.NaN, 0, 0)] }, /finite/],
    ["far away", { atoms: [atom("C", 0, 0, 0), atom("O", 2e4, 0, 0)] }, /within/],
    ["unknown element", { atoms: [atom("Xx", 0, 0, 0), atom("O", 1, 0, 0)] }, /Unknown element/],
    ["overlap", { atoms: [atom("C", 0, 0, 0), atom("C", 0.001, 0, 0)] }, /overlap/],
    ["periodic", { atoms: water(), cell: [[4, 0, 0], [0, 4, 0], [0, 0, 4]] as UnitCell }, /periodic/],
    ["bad isotope", { atoms: [atom("H", 0, 0, 0, 1.5), atom("H", 0.74, 0, 0)] }, /Isotope/],
    ["bad tolerance", { atoms: water(), tolerance: "sloppy" as "tight" }, /tolerance/],
  ])("rejects %s input", (_, input, message) => {
    expect(() => analyzePointGroup(msym, input, "detect")).toThrow(message);
  });
});

describe("symmetry workers", () => {
  test("worker results match the direct engines", async () => {
    expect((await runSymmetryTask({ action: "detect-point-group", input: { atoms: methane() } })).pointGroup).toBe("Td");
    expect((await runSymmetryTask({ action: "symmetrize", input: { atoms: water() } })).coordinates).toHaveLength(3);
    expect((await runSymmetryTask({ action: "niggli-reduce", input: { cell: [[4, 0, 0], [3, 2, 0], [1, 1, 3]] } })).transform).toEqual([[-1, 0, 0], [1, 0, 1], [0, 1, 0]]);
    await expect(runSymmetryTask({ action: "detect-point-group", input: { atoms: water(), cell: [[4, 0, 0], [0, 4, 0], [0, 0, 4]] } })).rejects.toThrow(/periodic/);
  });

  test("cancellation and timeouts terminate the job", async () => {
    const controller = new AbortController();
    const pending = runSymmetryTask({ action: "symmetrize", input: { atoms: fullerene } }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(runSymmetryTask({ action: "detect-point-group", input: { atoms: water() } }, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    await expect(runSymmetryTask({ action: "symmetrize", input: { atoms: fullerene } }, { timeoutMs: 1 })).rejects.toThrow(/time limit/);
  });

  test("a newer request supersedes a stale one", async () => {
    const runner = createLatestSymmetryRunner();
    const stale = runner.run({ action: "detect-point-group", input: { atoms: water() } });
    const current = runner.run({ action: "detect-point-group", input: { atoms: methane() } });
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect((await current).pointGroup).toBe("Td");
  });
});
