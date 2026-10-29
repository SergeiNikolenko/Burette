import { expect, test } from "bun:test";
import { hessianFromLowerTriangle } from "../apps/desktop/src/lib/molecular-workbench/hessian";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";

// Same reviewed two-atom rank-one spring fixture; no numerical oracle is duplicated.
const triangle = [.18, .24, .32, 0, 0, 0, -.18, -.24, 0, .18, -.24, -.32, 0, .24, .32, 0, 0, 0, 0, 0, 0];

test("scientific validation retains numerical arrays and ties orbital length to actual shell functions", () => {
  const atoms = [{ element: "H", x: 0, y: 0, z: 0 }, { element: "He", x: .6, y: .8, z: 0 }];
  const hessian = hessianFromLowerTriangle(triangle, 2, [2, 8]);
  const document: ScientificDocument = { format: "orca-hessian", atoms, frames: [{ atoms, hessian }], modes: [],
    basis: [
      { atomIndex: 0, kind: "d", spherical: false, cartesianOrder: "gaussian", exponents: [1], coefficients: [1] },
      { atomIndex: 0, kind: "p", spherical: false, cartesianOrder: "gaussian", exponents: [1], coefficients: [1] },
      { atomIndex: 0, kind: "i", spherical: true, cartesianOrder: "gaussian", exponents: [1], coefficients: [1] },
    ], orbitals: [{ index: 0, energyHartree: -.4, occupancy: 1, spin: "alpha", coefficients: Array(22).fill(0) }] };
  const frame = { elements: ["H", "He"], positions: Float64Array.from([0, 0, 0, .6, .8, 0]) };
  const validated = validateScientificDocument(document, [frame]);
  expect(validated.frames[0].hessian?.values).toBe(hessian.values);
  expect(validated.basis).toBe(document.basis);
  expect(() => validateScientificDocument({ ...document, orbitals: [{ ...document.orbitals[0], coefficients: Array(21).fill(0) }] }, [frame])).toThrow("Gaussian basis");
  expect(() => validateScientificDocument(document, [{ ...frame, positions: Float64Array.from([0, 0, 0, .61, .8, 0]) }])).toThrow("geometry");
});
