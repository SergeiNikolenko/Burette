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
  /** Producer-printed partial charges of this geometry, in elementary charges and source atom order. */
  charges?: AtomicChargeSet[];
  /** Producer-printed total dipole moment of this geometry, in debye, in the frame's Cartesian axes. */
  dipoleDebye?: Vec3;
  /** Producer-printed ideal-gas thermochemistry of this geometry's frequency calculation. */
  thermochemistry?: Thermochemistry;
}
/**
 * Energies are per particle in Hartree: the zero-point correction, and the absolute enthalpy and
 * Gibbs energy at the temperature, electronic energy included. G is H − T·S where a program prints no G.
 */
export interface Thermochemistry {
  temperatureKelvin: number;
  zeroPointHartree?: number;
  enthalpyHartree?: number;
  gibbsHartree?: number;
  entropyCalMolKelvin?: number;
}
export const ATOMIC_CHARGE_MODELS = ["mulliken", "lowdin", "hirshfeld", "cm5", "npa", "esp", "chelpg", "eeq", "gasteiger"] as const;
export interface AtomicChargeSet { model: typeof ATOMIC_CHARGE_MODELS[number]; values: number[] }
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
/** One Cube dataset; `orbitalNumber` is the producer's 1-based MO number when the header lists orbitals. */
export interface ScalarDataset { label: string; orbitalNumber?: number; grid: ScalarGrid }
export interface ScientificDocument {
  format: "gaussian-log" | "qcschema" | "fchk" | "orca" | "orca-hessian" | "orca-property" | "molden" | "cube" | "xyz" | "zmat" | "cjson"
    | "nwchem-log" | "gamess-log" | "psi4-log" | "molpro-log" | "qchem-log" | "xtb";
  atoms: MolecularAtom[];
  /** Producer-declared history frame of atoms; absent means the reference index is unknown. */
  referenceFrameIndex?: number;
  /** Exact materialized MOL source, including graph metadata, and the original CJSON set index. */
  graph?: { molfile: string; activeFrameIndex: number };
  frames: ScientificFrame[];
  modes: VibrationalMode[];
  orbitals: MolecularOrbital[];
  /** File-scoped source data; this is not an alias for the current or final frame. */
  spectra?: ScientificSpectra;
  basis?: GaussianShell[];
  grid?: ScalarGrid;
  /** Every dataset of a multi-field Cube in file order (`grid` is the first), on one shared grid and geometry. */
  gridDatasets?: ScalarDataset[];
  converged?: boolean;
  /** Named coordinates and dummy reference points; atoms contain only real atoms. */
  internalCoordinates?: ZmatrixDocument;
}
