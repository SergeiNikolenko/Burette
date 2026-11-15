export type TrrFrame = {
  elementCount: number;
  x: Float32Array; y: Float32Array; z: Float32Array;
  /** Row-major cell basis, in angstroms. */
  box?: number[];
  timePs: number;
  step: number;
  lambda: number;
  /** Source atom order, in angstrom/ps. */
  velocities?: { vx: Float64Array; vy: Float64Array; vz: Float64Array };
  /** Source atom order, in kcal/mol/angstrom. */
  forces?: { fx: Float64Array; fy: Float64Array; fz: Float64Array };
};
export function decodeTrrFrame(data: Uint8Array): TrrFrame;
