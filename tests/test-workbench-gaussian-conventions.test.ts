import { expect, test } from "bun:test";
import {
  cartesianPowers,
  cartesianCoefficients,
} from "../apps/desktop/src/lib/molecular-workbench/gaussian-angular";
import {
  evaluateOrbital,
  evaluateDensity,
} from "../apps/desktop/src/lib/molecular-workbench/gaussian";
import { parseFchk } from "../apps/desktop/src/lib/molecular-workbench/fchk";
import type {
  GaussianShell,
  ScientificDocument,
} from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import type { Vec3 } from "../apps/desktop/src/lib/molecular-workbench/types";

const kinds = ["s", "p", "d", "f", "g", "h", "i"] as const;
const df = (n: number): number => (n <= 0 ? 1 : n * df(n - 2));
function moment(n: number, a: number) {
  return n % 2 ? 0 : (Math.sqrt(Math.PI / (2 * a)) * df(n - 1)) / (4 * a) ** (n / 2);
}
function componentNorm(a: number, p: number[]) {
  return (
    ((2 * a) / Math.PI) ** 0.75 *
    Math.sqrt((4 * a) ** p.reduce((x, y) => x + y, 0) / p.reduce((x, y) => x * df(2 * y - 1), 1))
  );
}
const size = (l: number) => ((l + 1) * (l + 2)) / 2;
const identity = (n: number) =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
function doc(shells: GaussianShell[], coefficients: number[]): ScientificDocument {
  return {
    format: "fchk",
    atoms: [{ element: "H", x: 0, y: 0, z: 0 }],
    frames: [],
    modes: [],
    basis: shells,
    orbitals: [{ index: 0, spin: "alpha", occupancy: 1, energyHartree: -0.5, coefficients }],
  };
}

test("all spherical transforms are orthonormal under exact Cartesian Gaussian overlaps at multiple exponents", () => {
  for (let l = 2; l <= 6; l++)
    for (const order of ["molden", "gaussian"] as const)
      for (const alpha of [0.031, 1, 7.1]) {
        const shell: GaussianShell = {
          kind: kinds[l],
          spherical: true,
          cartesianOrder: order,
          atomIndex: 0,
          exponents: [alpha],
          coefficients: [1],
        };
        const powers = cartesianPowers(shell),
          m = 2 * l + 1;
        const columns = identity(m).map((c) => cartesianCoefficients(shell, c, powers));
        const overlap = powers.map((p) =>
          powers.map(
            (q) =>
              componentNorm(alpha, p) *
              componentNorm(alpha, q) *
              p.reduce((s, n, i) => s * moment(n + q[i], alpha), 1),
          ),
        );
        for (let a = 0; a < m; a++)
          for (let b = 0; b < m; b++) {
            let integral = 0;
            for (let i = 0; i < powers.length; i++)
              for (let j = 0; j < powers.length; j++)
                integral += columns[a][i] * overlap[i][j] * columns[b][j];
            expect(integral).toBeCloseTo(+(a === b), 11);
          }
      }
});

test("every Cartesian component follows independent published Molden and FCHK conventions", () => {
  // Published component lists: https://www.theochem.ru.nl/molden/molden_format.html
  // FCHK g/h/i use reverse alphabetic order, independently documented by IOData.
  const molden = [
    "1",
    "x y z",
    "xx yy zz xy xz yz",
    "xxx yyy zzz xyy xxy xxz xzz yzz yyz xyz",
    "xxxx yyyy zzzz xxxy xxxz yyyx yyyz zzzx zzzy xxyy xxzz yyzz xxyz yyxz zzxy",
  ].map((s) => s.split(" "));
  const point = [0.27, -0.38, 0.69],
    alpha = 0.87;
  for (let l = 0; l <= 6; l++)
    for (const order of ["molden", "gaussian"] as const) {
      if (order === "molden" && l > 4) continue;
      let labels: string[];
      if (order === "molden" || l < 4) labels = molden[l];
      else {
        labels = [];
        for (let x = l; x >= 0; x--)
          for (let y = l - x; y >= 0; y--)
            labels.push("x".repeat(x) + "y".repeat(y) + "z".repeat(l - x - y));
        labels.reverse();
      }
      const shell: GaussianShell = {
        kind: kinds[l],
        spherical: false,
        cartesianOrder: order,
        atomIndex: 0,
        exponents: [alpha],
        coefficients: [1],
      };
      for (let i = 0; i < size(l); i++) {
        const p = ["x", "y", "z"].map((k) => [...labels[i]].filter((c) => c === k).length);
        const expected =
          componentNorm(alpha, p) *
          Math.exp(-alpha * point.reduce((s, v) => s + v * v, 0)) *
          point.reduce((s, v, j) => s * v ** p[j], 1);
        const document = doc([shell], identity(size(l))[i]);
        expect(
          evaluateOrbital(document, 0, point.map((v) => v * 0.529177210903) as Vec3),
        ).toBeCloseTo(expected, 12);
      }
    }
});

test("point orbital evaluation obeys the same high-angular primitive memory limit as density evaluation", () => {
  const fields = {
    "Number of atoms": 1,
    "Number of alpha electrons": 1,
    "Number of beta electrons": 1,
    "Atomic numbers": [2],
    "Current cartesian coordinates": [0, 0, 0],
    "Number of basis functions": 1300,
    "Shell types": Array(100).fill(-6),
    "Number of primitives per shell": Array(100).fill(100),
    "Shell to atom map": Array(100).fill(1),
    "Primitive exponents": Array(10000).fill(0.7),
    "Contraction coefficients": Array(10000).fill(0.01),
    "Alpha Orbital Energies": [-0.5],
    "Alpha MO coefficients": Array(1300).fill(1),
  };
  const source =
    "Bounded basis\nSP RHF test\n" +
    Object.entries(fields)
      .map(
        ([k, v]) =>
          `${k.padEnd(40)}   ${/electrons|atoms|numbers|types|per shell|atom map|basis functions/.test(k) ? "I" : "R"}   ${Array.isArray(v) ? `N= ${v.length}\n ${v.join(" ")}` : v}`,
      )
      .join("\n");
  const document = parseFchk(source);
  expect(() => evaluateDensity(document, [0.1, 0.2, 0.3])).toThrow("memory limit");
  expect(() => evaluateOrbital(document, 0, [0.1, 0.2, 0.3])).toThrow("memory limit");
});
