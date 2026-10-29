import { expect, test } from "bun:test";
import { waterScience, XYZ } from "./scientific-data-fixture";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { ScienceSessionError } from "../apps/desktop/src/lib/science-session/contracts";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { shellSize, cartesianPowers, cartesianCoefficients } from "../apps/desktop/src/lib/molecular-workbench/gaussian-angular";
import { hessianFromLowerTriangle, HESSIAN_UNITS, packedTriangleDimension } from "../apps/desktop/src/lib/molecular-workbench/hessian";
import { atomsFromZmatrixDocument, parseZmatrixDocument } from "../scripts/zmatrix-document.mjs";
import type { ScientificDocument, GaussianShell } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";

const frames = readXyzFrames(XYZ);

test("canonical data retains float32 grids, float64 Hessians and all normal-mode and Gaussian fields", () => {
  const data = waterScience();
  data.basis = [{ atomIndex: 0, kind: "p", spherical: false, exponents: [1, 2], coefficients: [1, 0.5] }];
  data.orbitals[0].coefficients = [0.99, 0.02, 0.01];
  data.modes[0].frequencyCm1 = -100; data.modes[0].forceConstantMdynAngstrom = -0.5;
  expect(validateScientificDocument(data, frames)).toBe(data);
  expect(data.grid!.values).toBeInstanceOf(Float32Array);
  expect(data.frames[0].hessian!.values).toBeInstanceOf(Float64Array);
});

test("source-bound schema rejects malformed science rather than dropping unsupported arrays", () => {
  const changes: Array<(data: ScientificDocument) => void> = [
    data => { data.atoms[0].x += 1; }, data => { data.frames[0].atoms = data.frames[0].atoms.slice(1); },
    data => { data.frames[0].energyHartree = NaN; }, data => { data.frames[0].forcesKcalMolAngstrom = [[0, 0, 0]]; },
    data => { data.frames[0].hessian!.units = "unknown" as never; }, data => { data.frames[0].hessian!.values[0] = Infinity; },
    data => { data.frames[0].hessian!.massesAmu = [-1, 1, 1]; }, data => { data.frames[0].hessian!.dimension = 12; },
    data => { data.modes.push({ ...data.modes[0] }); }, data => { data.modes[0].displacements = [[0, 0, 0]]; },
    data => { data.modes[0].ramanDepolarizationRatio = 1.1; }, data => { data.modes[0].reducedMassAmu = -1; },
    data => { data.orbitals[0].occupancy = 3; }, data => { data.orbitals[0].energyHartree = NaN; },
    data => { data.orbitals[0].coefficients[0] = Infinity; }, data => { data.orbitals.push({ ...data.orbitals[0] }); },
    data => { data.basis = [{ atomIndex: 0, kind: "s", spherical: false, exponents: [-1], coefficients: [1] }]; },
    data => { data.basis = [{ atomIndex: 0, kind: "s", spherical: false, exponents: [1], coefficients: [1] }]; },
    data => { data.grid!.dimensions[0] = 0; }, data => { data.grid!.values[0] = NaN; }, data => { data.converged = "yes" as never; },
  ];
  for (const change of changes) {
    const data = waterScience(); change(data);
    expect(() => validateScientificDocument(data, frames)).toThrow(ScienceSessionError);
  }
});

test("trajectory frames and named Z-matrix geometry must match their saved source", () => {
  const data = waterScience(), second = data.atoms.map(atom => ({ ...atom, x: atom.x + 1 }));
  data.frames.push({ atoms: second });
  const text = XYZ + `3\nsecond\n${second.map(atom => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join("\n")}\n`;
  expect(validateScientificDocument(data, readXyzFrames(text))).toBe(data);
  data.frames[1].atoms[0].x += 1;
  expect(() => validateScientificDocument(data, readXyzFrames(text))).toThrow("trajectory frames");
  const definition = parseZmatrixDocument("O\nH 1 R\nH 1 R 2 A\nR=0.9572\nA=104.52\n");
  const atoms = atomsFromZmatrixDocument(definition).map(({ element, position: [x, y, z] }) => ({ element, x, y, z }));
  const zmat: ScientificDocument = { format: "zmat", atoms, frames: [{ atoms }], modes: [], orbitals: [], internalCoordinates: definition };
  const source = readXyzFrames(`3\nwater\n${atoms.map(atom => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join("\n")}\n`);
  expect(validateScientificDocument(zmat, source)).toBe(zmat);
  definition.variables[0].value = 1.5;
  expect(() => validateScientificDocument(zmat, source)).toThrow("Z-matrix definition does not match");
});

test("original Gaussian angular and Hessian helpers keep their physical orders and units", () => {
  const shell: GaussianShell = { atomIndex: 0, kind: "d", spherical: true, exponents: [1], coefficients: [1] };
  const powers = cartesianPowers(shell);
  expect(shellSize(shell)).toBe(5); expect(powers).toEqual([[2, 0, 0], [0, 2, 0], [0, 0, 2], [1, 1, 0], [1, 0, 1], [0, 1, 1]]);
  const transformed = cartesianCoefficients(shell, [0, 1, 0, 0, 0], powers);
  expect(transformed[4]).toBeCloseTo(1, 14);
  expect(transformed.filter((_, index) => index !== 4)).toEqual([0, 0, 0, 0, 0]);
  const hessian = hessianFromLowerTriangle([1, 0.25, 2, 0, 0.5, 3], 1, [1.008]);
  expect(hessian).toEqual({ units: HESSIAN_UNITS, dimension: 3, values: Float64Array.of(1, 0.25, 0, 0.25, 2, 0.5, 0, 0.5, 3), massesAmu: [1.008], source: "gaussian-fchk" });
  expect(packedTriangleDimension(6)).toBe(3);
  expect(() => packedTriangleDimension(7)).toThrow("triangle length");
});
