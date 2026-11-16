import { expect, test } from "bun:test";
import { cartesianCoefficients, cartesianPowers, primitiveNormalization, shellSize } from "../apps/desktop/src/lib/molecular-workbench/gaussian-angular";
import { hessianFromLowerTriangle, hessianFromOrcaSection, packedTriangleDimension } from "../apps/desktop/src/lib/molecular-workbench/hessian";
import type { GaussianShell } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import type { Vec3 } from "../apps/desktop/src/lib/molecular-workbench/types";

const kinds = ["s", "p", "d", "f", "g", "h", "i"] as const;
const shell = (l: number, spherical = false, cartesianOrder: GaussianShell["cartesianOrder"] = "gaussian"): GaussianShell => ({
  atomIndex: 0, kind: kinds[l], spherical, cartesianOrder, exponents: [1], coefficients: [1],
});
const factorial = (n: number): number => n < 2 ? 1 : n * factorial(n - 1);
// Independent exact Gaussian moments: integral x^(2n) exp(-beta*x*x) dx over R.
function moment(power: number, beta: number) {
  if (power % 2) return 0;
  const n = power / 2;
  return Math.sqrt(Math.PI) * factorial(2 * n) / (factorial(n) * 4 ** n * beta ** (n + 0.5));
}
const norm = (p: Vec3, alpha = 1) => 1 / Math.sqrt(p.reduce((product, degree) => product * moment(2 * degree, 2 * alpha), 1));
const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const maxAbs = (values: number[]) => Math.max(0, ...values.map(Math.abs));
function harmonics(basis: GaussianShell) {
  const powers = cartesianPowers(basis), size = shellSize(basis);
  return Array.from({ length: size }, (_, column) => cartesianCoefficients(basis, Array.from({ length: size }, (_, i) => Number(i === column)), powers));
}
const polynomial = (powers: Vec3[], coefficients: number[], point: Vec3) => powers.reduce((sum, p, index) =>
  sum + coefficients[index] * norm(p) * p.reduce((product, degree, axis) => product * point[axis] ** degree, 1), 0);

test("supported shell sizes and Cartesian labels retain the documented Molden/FCHK ordering", () => {
  expect(kinds.map((_, l) => [shellSize(shell(l)), shellSize(shell(l, true))])).toEqual([[1, 1], [3, 3], [6, 5], [10, 7], [15, 9], [21, 11], [28, 13]]);
  const labels = (basis: GaussianShell) => cartesianPowers(basis).map(p => p.map((n, i) => "xyz"[i].repeat(n)).join(""));
  // Published Molden labels in the owning module's format contract.
  expect(labels(shell(2, false, "molden"))).toEqual(["xx", "yy", "zz", "xy", "xz", "yz"]);
  expect(labels(shell(3, false, "molden"))).toEqual(["xxx", "yyy", "zzz", "xyy", "xxy", "xxz", "xzz", "yzz", "yyz", "xyz"]);
  expect(labels(shell(4, false, "molden")).slice(0, 3)).toEqual(["xxxx", "yyyy", "zzzz"]);
  for (let l = 0; l <= 6; l++) {
    const powers = cartesianPowers(shell(l));
    expect([powers.length, new Set(powers.map(String)).size, powers.every(p => p.every(n => Number.isInteger(n) && n >= 0) && p.reduce((a, b) => a + b, 0) === l)])
      .toEqual([((l + 1) * (l + 2)) / 2, ((l + 1) * (l + 2)) / 2, true]);
    if (l >= 4) expect([powers[0], powers.at(-1)]).toEqual([[0, 0, l], [l, 0, 0]]);
  }
});

test("Cartesian primitive normalization integrates to one and has the expected exponent scaling", () => {
  const residuals: number[] = [];
  for (let l = 0; l <= 6; l++) for (const p of cartesianPowers(shell(l))) for (const alpha of [0.037, 1, 7.25]) {
    const actual = primitiveNormalization(alpha, ...p), expected = norm(p, alpha);
    residuals.push(actual / expected - 1);
    residuals.push(primitiveNormalization(4 * alpha, ...p) / actual / 4 ** (l / 2 + 0.75) - 1);
  }
  expect(maxAbs(residuals)).toBeLessThan(3e-15);
});

test("pure d–i shells are orthonormal under exact Gaussian integration in each admitted order", () => {
  for (let l = 2; l <= 6; l++) for (const order of l <= 4 ? ["molden", "gaussian"] as const : ["gaussian"] as const) {
    const basis = shell(l, true, order), powers = cartesianPowers(basis), columns = harmonics(basis);
    const overlap = powers.map(a => powers.map(b => norm(a) * norm(b) * a.reduce((product, n, axis) => product * moment(n + b[axis], 2), 1)));
    const residuals = columns.flatMap((a, i) => columns.map((b, j) =>
      a.reduce((sum, x, row) => sum + x * dot(overlap[row], b), 0) - Number(i === j)));
    expect(maxAbs(residuals)).toBeLessThan(2e-12);
  }
});

test("solid harmonics are trace-free and obey m=0,+1,-1,... chemical real-harmonic rotations", () => {
  const point: Vec3 = [0.6, -0.35, 0.8], angle = 0.37;
  const rotated: Vec3 = [point[0] * Math.cos(angle) - point[1] * Math.sin(angle), point[0] * Math.sin(angle) + point[1] * Math.cos(angle), point[2]];
  for (let l = 2; l <= 6; l++) {
    const basis = shell(l, true), powers = cartesianPowers(basis), columns = harmonics(basis), residuals: number[] = [];
    for (const column of columns) {
      const laplacian = new Map<string, number>();
      powers.forEach((p, i) => p.forEach((degree, axis) => {
        if (degree < 2) return;
        const reduced = p.map((n, k) => n - (k === axis ? 2 : 0)).join(",");
        laplacian.set(reduced, (laplacian.get(reduced) ?? 0) + column[i] * norm(p) * degree * (degree - 1));
      }));
      residuals.push(...laplacian.values());
    }
    const values = columns.map(c => polynomial(powers, c, point)), turned = columns.map(c => polynomial(powers, c, rotated));
    residuals.push(turned[0] - values[0]);
    expect(columns[0][powers.findIndex(p => String(p) === `0,0,${l}`)]).toBeGreaterThan(0);
    for (let m = 1; m <= l; m++) {
      const c = 2 * m - 1, s = 2 * m;
      residuals.push(turned[c] - (Math.cos(m * angle) * values[c] - Math.sin(m * angle) * values[s]));
      residuals.push(turned[s] - (Math.sin(m * angle) * values[c] + Math.cos(m * angle) * values[s]));
      expect(columns[c][powers.findIndex(p => String(p) === `${m},0,${l - m}`)]).toBeGreaterThan(0);
      expect(columns[s][powers.findIndex(p => String(p) === `${m - 1},1,${l - m}`)]).toBeGreaterThan(0);
    }
    expect(maxAbs(residuals)).toBeLessThan(2e-11);
  }
});

// Rank-one spring along (3/5,4/5,0): H=k[[uuT,-uuT],[-uuT,uuT]], k=0.5 Eh/bohr².
const triangle = [.18, .24, .32, 0, 0, 0, -.18, -.24, 0, .18, -.24, -.32, 0, .24, .32, 0, 0, 0, 0, 0, 0];
const matrix = [.18, .24, 0, -.18, -.24, 0, .24, .32, 0, -.24, -.32, 0, 0, 0, 0, 0, 0, 0,
  -.18, -.24, 0, .18, .24, 0, -.24, -.32, 0, .24, .32, 0, 0, 0, 0, 0, 0, 0];

test("packed Hessian order/units preserve an analytical diatomic stretch and rigid nullspace", () => {
  const masses = [2, 8], hessian = hessianFromLowerTriangle(triangle, 2, masses);
  expect({ units: hessian.units, dimension: hessian.dimension, values: [...hessian.values], masses: hessian.massesAmu, source: hessian.source })
    .toEqual({ units: "hartree/bohr^2", dimension: 6, values: matrix, masses: [2, 8], source: "gaussian-fchk" });
  masses[0] = 99; expect(hessian.massesAmu).toEqual([2, 8]);
  const m = hessian.massesAmu!, u = [.6, .8, 0], coordinates = [u.map(x => -.8 * x), u.map(x => .2 * x)];
  const weighted = Array.from({ length: 6 }, (_, row) => Array.from({ length: 6 }, (_, col) => hessian.values[row * 6 + col] / Math.sqrt(m[Math.floor(row / 3)] * m[Math.floor(col / 3)])));
  const apply = (v: number[]) => weighted.map(row => dot(row, v));
  const stretch = [...u.map(x => x / Math.sqrt(m[0])), ...u.map(x => -x / Math.sqrt(m[1]))];
  const eigenvalue = .5 * (1 / 2 + 1 / 8);
  expect(maxAbs(apply(stretch).map((x, i) => x - eigenvalue * stretch[i]))).toBeLessThan(1e-15);
  // The owning unit contract gives 5140.487 cm−1 for sqrt(1 Eh/(bohr² amu)). No solver is called.
  expect(5140.487 * Math.sqrt(dot(stretch, apply(stretch)) / dot(stretch, stretch))).toBeCloseTo(5140.487 * Math.sqrt(.5 / 1.6), 10);
  for (let axis = 0; axis < 3; axis++) {
    const translation = m.flatMap(mass => [0, 1, 2].map(k => Number(k === axis) * Math.sqrt(mass)));
    const omega = [0, 1, 2].map(k => Number(k === axis));
    const rotation = coordinates.flatMap(([x, y, z], i) => [omega[1] * z - omega[2] * y, omega[2] * x - omega[0] * z, omega[0] * y - omega[1] * x].map(value => value * Math.sqrt(m[i])));
    expect(maxAbs([...apply(translation), ...apply(rotation)])).toBeLessThan(1e-15);
  }
  expect(packedTriangleDimension(triangle.length)).toBe(6);
  for (const size of [0, 10, NaN, Infinity, 1203 * 1204 / 2]) expect(() => packedTriangleDimension(size)).toThrow();
  expect(() => hessianFromLowerTriangle(triangle, 2, [0, 8])).toThrow("positive mass");
});

test("ORCA blocks retain raw nearly symmetric values, source masses and Fortran notation", () => {
  const lines = ["6", "0 1 2", "0 1.8D-1 2.401D-1 0.0", "1 2.4D-1 3.2D-1 0.0", "2 0.0 0.0 0.0", "3 -1.8D-1 -2.4D-1 0.0", "4 -2.4D-1 -3.2D-1 0.0", "5 0.0 0.0 0.0",
    "3 4 5", "0 -1.8D-1 -2.4D-1 0.0", "1 -2.4D-1 -3.2D-1 0.0", "2 0.0 0.0 0.0", "3 1.8D-1 2.4D-1 0.0", "4 2.4D-1 3.2D-1 0.0", "5 0.0 0.0 0.0"];
  const result = hessianFromOrcaSection(lines, 2, [2, 8]), raw = matrix.slice(); raw[1] = .2401;
  expect({ ...result, values: [...result.values] }).toEqual({ units: "hartree/bohr^2", dimension: 6, source: "orca-hess", massesAmu: [2, 8], values: raw });
  expect(() => hessianFromOrcaSection(lines.slice(0, -1), 2)).toThrow("Truncated");
  expect(() => hessianFromOrcaSection([...lines, "3 4 5", "5 0.0 0.0 0.0"], 2)).toThrow("Duplicate");
  expect(() => hessianFromOrcaSection(lines.map(line => line.replace("2.401D-1", "4.0D-1")), 2)).toThrow("not symmetric");
});
