import { expect, test } from "bun:test";
import { cellFromParameters, fractionalToCartesian, cartesianToFractional } from "../apps/desktop/src/lib/molecular-workbench/crystal";

test("independent triclinic Gram/volume and Cartesian inverse oracle", () => {
  // Known vectors (3,0,0), (1,4,0), (-1,2,5); volume=3*4*5=60 Å³.
  const degrees = (cos: number) => Math.acos(cos) * 180 / Math.PI;
  const unit = cellFromParameters({ a: 3, b: Math.sqrt(17), c: Math.sqrt(30), alpha: degrees(7 / Math.sqrt(510)), beta: degrees(-1 / Math.sqrt(30)), gamma: degrees(1 / Math.sqrt(17)) });
  unit.forEach((row, i) => row.forEach((value, j) => expect(value).toBeCloseTo([[3, 0, 0], [1, 4, 0], [-1, 2, 5]][i][j], 12)));
  for (let i = -4; i < 5; i++) {
    const f: [number, number, number] = [i / 7, (i + 2) / 5, (i - 3) / 11];
    const expected: [number, number, number] = [3 * f[0] + f[1] - f[2], 4 * f[1] + 2 * f[2], 5 * f[2]];
    fractionalToCartesian(f, unit).forEach((v, a) => expect(v).toBeCloseTo(expected[a], 12));
    cartesianToFractional(expected, unit).forEach((v, a) => expect(v).toBeCloseTo(f[a], 12));
  }
});
