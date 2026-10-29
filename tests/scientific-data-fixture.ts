import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { HESSIAN_UNITS } from "../apps/desktop/src/lib/molecular-workbench/hessian";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";

export const XYZ = "﻿3\r\nwater restored\r\nO 0.000000 0.000000 0.117300\r\nH 0.000000 0.757200 -0.469200\r\nH 0.000000 -0.757200 -0.469200\r\n";

export function waterScience(): ScientificDocument {
  const atoms = readXyzFrames(XYZ)[0];
  const list = atoms.elements.map((element, index) => ({ element, x: atoms.positions[index * 3], y: atoms.positions[index * 3 + 1], z: atoms.positions[index * 3 + 2] }));
  const values = new Float32Array(2 * 3 * 4).map((_, index) => Math.fround(Math.sin(index) * 1e-3));
  values[5] = Math.fround(-0.1234567);
  const hessian = new Float64Array(81).map((_, index) => (index % 10 === 0 ? 0.5 : 1e-17 * index));
  hessian[1] = 0.1 + 0.2;
  hessian[9] = hessian[1];
  return {
    format: "orca",
    atoms: list,
    frames: [{ atoms: list, energyHartree: -76.0263, hessian: { units: HESSIAN_UNITS, dimension: 9, values: hessian, massesAmu: [15.999, 1.008, 1.008], source: "orca-hess" },
      modes: [{ index: 6, frequencyCm1: 1648.2, intensityKmMol: 71.3, displacements: [[0, 0, -0.07], [0, -0.43, 0.56], [0, 0.43, 0.56]] }] }],
    modes: [{ index: 6, frequencyCm1: 1648.2, displacements: [[0, 0, -0.07], [0, -0.43, 0.56], [0, 0.43, 0.56]] }],
    orbitals: [{ index: 0, energyHartree: -20.55, occupancy: 2, spin: "alpha", coefficients: [0.99, 0.02] }],
    grid: { dimensions: [2, 3, 4], origin: [-1, -1, -1], axes: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]], values },
    converged: true,
  };
}
