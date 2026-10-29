import type { GaussianShell } from "./scientific-types";
import type { Vec3 } from "./types";

const MOMENTUM = { s: 0, p: 1, d: 2, f: 3, g: 4, h: 5, i: 6 } as const;
const MOLDEN_POWERS: Vec3[][] = [
  [[0, 0, 0]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[2, 0, 0], [0, 2, 0], [0, 0, 2], [1, 1, 0], [1, 0, 1], [0, 1, 1]],
  [[3, 0, 0], [0, 3, 0], [0, 0, 3], [1, 2, 0], [2, 1, 0], [2, 0, 1], [1, 0, 2], [0, 1, 2], [0, 2, 1], [1, 1, 1]],
  [[4, 0, 0], [0, 4, 0], [0, 0, 4], [3, 1, 0], [3, 0, 1], [1, 3, 0], [0, 3, 1], [1, 0, 3], [0, 1, 3], [2, 2, 0], [2, 0, 2], [0, 2, 2], [2, 1, 1], [1, 2, 1], [1, 1, 2]],
];

export function shellSize(shell: GaussianShell) {
  const l = MOMENTUM[shell.kind];
  return shell.spherical && l >= 2 ? 2 * l + 1 : (l + 1) * (l + 2) / 2;
}

/** Molden's published order through g; FCHK reverses alphabetic order from g.
 * https://www.theochem.ru.nl/molden/molden_format.html
 * https://github.com/theochem/iodata/blob/master/iodata/formats/fchk.py
 */
export function cartesianPowers(shell: GaussianShell): Vec3[] {
  const l = MOMENTUM[shell.kind];
  if (l < 4 || (l === 4 && shell.cartesianOrder !== "gaussian")) return MOLDEN_POWERS[l];
  const powers: Vec3[] = [];
  for (let x = 0; x <= l; x++) for (let y = 0; y <= l - x; y++) powers.push([x, y, l - x - y]);
  return powers;
}

function factorial(n: number): number { return n <= 1 ? 1 : n * factorial(n - 1); }
function doubleFactorial(n: number): number { return n <= 0 ? 1 : n * doubleFactorial(n - 2); }
export function primitiveNormalization(exponent: number, x: number, y: number, z: number) {
  return Math.pow(2 * exponent / Math.PI, 0.75) * Math.sqrt(Math.pow(4 * exponent, x + y + z)
    / (doubleFactorial(2 * x - 1) * doubleFactorial(2 * y - 1) * doubleFactorial(2 * z - 1)));
}

// Coefficients of r^l Y_lm as a Cartesian polynomial. The chemical real-harmonic
// convention cancels the Condon–Shortley phase: m=0,+1,-1,+2,-2,..., with positive
// xz/yz for d. Expand the Legendre polynomial, then (x+iy)^m and (x²+y²+z²)^k.
// Only l<=6 is admitted by the readers; cache is bounded by those shell kinds.
const transforms = new Map<string, number[][]>();
function sphericalTransform(shell: GaussianShell, powers: Vec3[]) {
  const key = `${shell.kind}:${shell.cartesianOrder ?? "molden"}`;
  const cached = transforms.get(key);
  if (cached) return cached;
  const l = MOMENTUM[shell.kind];
  const gamma = doubleFactorial(2 * l + 1) * Math.sqrt(Math.PI) / 2 ** (l + 1);
  const radial = Math.sqrt(2 * 2 ** (l + 1.5) / gamma);
  const matrix = Array.from({ length: powers.length }, () => Array(2 * l + 1).fill(0) as number[]);
  for (let m = 0; m <= l; m++) {
    const angular = Math.sqrt((2 * l + 1) / (4 * Math.PI) * factorial(l - m) / factorial(l + m) * (m ? 2 : 1));
    for (let k = 0; k <= Math.floor((l - m) / 2); k++) {
      const legendre = (-1) ** k * factorial(2 * l - 2 * k)
        / (2 ** l * factorial(k) * factorial(l - k) * factorial(l - m - 2 * k));
      for (let iy = 0; iy <= m; iy++) {
        const mode = m === 0 ? 0 : 2 * m - (iy % 2 ? 0 : 1);
        const complex = (-1) ** Math.floor(iy / 2) * factorial(m) / (factorial(iy) * factorial(m - iy));
        for (let rx = 0; rx <= k; rx++) for (let ry = 0; ry <= k - rx; ry++) {
          const rz = k - rx - ry;
          const exponent: Vec3 = [m - iy + 2 * rx, iy + 2 * ry, l - m - 2 * k + 2 * rz];
          const index = powers.findIndex(p => p.every((v, axis) => v === exponent[axis]));
          const multinomial = factorial(k) / (factorial(rx) * factorial(ry) * factorial(rz));
          matrix[index][mode] += radial * angular * legendre * complex * multinomial / primitiveNormalization(1, ...exponent);
        }
      }
    }
  }
  transforms.set(key, matrix);
  return matrix;
}

/** Convert normalized real solid harmonics to normalized Cartesian primitives. */
export function cartesianCoefficients(shell: GaussianShell, coefficients: number[], powers: Vec3[]) {
  if (!shell.spherical || MOMENTUM[shell.kind] < 2) return coefficients;
  return sphericalTransform(shell, powers).map(row => row.reduce((sum, factor, index) => sum + factor * coefficients[index], 0));
}
