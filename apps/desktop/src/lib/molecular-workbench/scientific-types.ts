import type { MolecularAtom, Vec3 } from "./types";
import type { CartesianHessian } from "./hessian";
import type { ScientificSpectra } from "./scientific-spectra";
import type { ScientificMcdCompanion } from "./mcd-companion";
import type { ZmatrixDocument } from "../../../../../scripts/zmatrix-document.mjs";

export interface ScientificFrame {
  atoms: MolecularAtom[]; energyHartree?: number; comment?: string;
  /** Modes belong only to this geometry; never reuse them for another frame. */
  modes?: VibrationalMode[];
  /** Calculated source data for this exact indexed frame, never copied from another one. */
  spectra?: ScientificSpectra;
  /** Explicit companion source, paired to this exact source frame and revision. */
  mcdCompanion?: ScientificMcdCompanion;
  /** The Cartesian Hessian of this geometry, likewise never reused for another one. */
  hessian?: CartesianHessian;
  timePs?: number; temperatureKelvin?: number;
  velocitiesAngstromPerPs?: Vec3[]; forcesKcalMolAngstrom?: Vec3[];
}
export interface VibrationalMode {
  index: number;
  frequencyCm1: number;
  symmetry?: string;
  intensityKmMol?: number;
  transitionDipoleSquared?: number;
  /** Raman scattering activity, not an experimental intensity. */
  ramanActivityAngstrom4Amu?: number;
  /** Depolarization ratio for plane-polarized incident light. */
  ramanDepolarizationRatio?: number;
  /** Depolarization ratio for unpolarized incident light (Gaussian). */
  ramanDepolarizationRatioUnpolarized?: number;
  reducedMassAmu?: number;
  forceConstantMdynAngstrom?: number;
  /** Cartesian relative vectors; animation normalizes their maximum magnitude. */
  displacements?: Vec3[];
}
export interface MolecularOrbital {
  index: number;
  energyHartree: number;
  occupancy: number;
  spin: "alpha" | "beta";
  symmetry?: string;
  coefficients: number[];
}
export interface GaussianShell {
  atomIndex: number;
  kind: "s" | "p" | "d" | "f" | "g" | "h" | "i";
  spherical: boolean;
  /** FCHK Cartesian g/h/i order differs from Molden; lower shells coincide. */
  cartesianOrder?: "molden" | "gaussian";
  exponents: number[];
  coefficients: number[];
}
/** Grid positions in Å; values in source field units. Z is the fastest index. */
export interface ScalarGrid {
  dimensions: [number, number, number];
  origin: Vec3;
  axes: [Vec3, Vec3, Vec3];
  values: Float32Array;
}
export interface ScientificDocument {
  format: "gaussian-log" | "qcschema" | "fchk" | "orca" | "orca-hessian" | "molden" | "cube" | "xyz" | "zmat";
  atoms: MolecularAtom[];
  frames: ScientificFrame[];
  modes: VibrationalMode[];
  orbitals: MolecularOrbital[];
  /** File-scoped source data; this is not an alias for the current or final frame. */
  spectra?: ScientificSpectra;
  basis?: GaussianShell[];
  grid?: ScalarGrid;
  converged?: boolean;
  /** Named coordinates and dummy reference points; atoms contain only real atoms. */
  internalCoordinates?: ZmatrixDocument;
}
