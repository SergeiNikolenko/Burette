import { cartesianToFractional } from "../crystal";
import { atomicNumber } from "../elements";
import type { MolecularAtom, UnitCell, Vec3 } from "../types";
import { imageSearch, reduceLattice, reducedFractional, shortestTranslation } from "./lattice";

/**
 * Powder X-ray diffraction of one explicit, fully occupied unit cell.
 *
 * Structure factors come from Gemmi (project-gemmi/gemmi v0.7.5, MPL-2.0) built
 * as burette-xrd.wasm by compute/xrd-wasm/build-wasm.sh: every reflection with
 * d >= dmin is enumerated in P1, Friedel mates included, and |F|^2 is summed
 * over every explicit atom with the International Tables Vol. C (1992)
 * neutral-atom form factors. No symmetry operation is applied, so atoms a CIF
 * reader already expanded are counted once. Atoms carry no displacement
 * parameters (B = 0) and no anomalous dispersion.
 *
 * Reflections at the same 2θ form one peak; its intensity is
 *   I = Σ |F|^2 · (1 + cos^2 2θ) / (sin^2 θ · cos θ),
 * the Lorentz-polarization factor of an unpolarized beam in Bragg-Brentano
 * geometry without a monochromator. Intensities are relative: the strongest
 * peak in the requested range is 100. One wavelength is used; there is no
 * Kα2 component.
 */

export const XRD_LIMITS = {
  /** Angstrom. */
  wavelength: { min: 0.1, max: 5 },
  /** Degrees 2θ. The Lorentz factor diverges at 180°. */
  twoTheta: { min: 0, max: 170 },
  /** Full width at half maximum, degrees 2θ. */
  fwhm: { min: 0.001, max: 5 },
  /** Cell edge in angstrom; the WebAssembly module checks the same bounds. */
  cellLength: { min: 1.5, max: 1000 },
  atoms: 2_000,
  /** Reflections in the shell, Friedel mates included. */
  reflections: 200_000,
  /** Reflection-atom pairs one structure-factor sum may evaluate. */
  work: 50_000_000,
  /** (h, k, l) triples the enumeration may visit; matches kMaxSearch in burette_xrd.cpp. */
  search: 20_000_000,
  /** IT92 Gaussian fits hold for sin θ / λ ≤ 2 Å⁻¹ (d ≥ 0.25 Å). */
  sinThetaOverLambda: 2,
} as const;

/** Single Kα1 lines, Hölzer et al., Phys. Rev. A 56, 4554 (1997). */
export const XRD_RADIATION = [
  { id: "cu-ka1", label: "Cu Kα1", wavelength: 1.5405929 },
  { id: "mo-ka1", label: "Mo Kα1", wavelength: 0.7093171 },
] as const;

export const XRD_DEFAULTS = { wavelength: XRD_RADIATION[0].wavelength, twoThetaMin: 10, twoThetaMax: 90, fwhm: 0.1 } as const;

/** Atoms closer than this, modulo the lattice, are one site listed twice. */
const OVERLAP_DISTANCE = 0.1;
/** |F|^2 at or below this fraction of Σ Z^2 is a systematic absence (exactly zero but for rounding). */
const EXTINCTION_TOLERANCE = 1e-12;
/** Reflections whose 2θ agree within this many degrees form one peak. */
const PEAK_MERGE_DEGREES = 1e-5;

export type PowderXrdRequest = {
  atoms: MolecularAtom[];
  cell: UnitCell;
  /** Angstrom. */
  wavelength: number;
  /** Degrees 2θ. */
  twoThetaMin: number;
  twoThetaMax: number;
};

export type CellParameters = { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };

export type PowderPeak = {
  /** Degrees. */
  twoTheta: number;
  /** Angstrom. */
  d: number;
  /** Strongest peak = 100. */
  relativeIntensity: number;
  /** Σ |F|^2 · Lp, electrons squared. */
  intensity: number;
  /** Σ |F|^2 of the contributing reflections, electrons squared. */
  structureFactorSquared: number;
  /** Reflections contributing to the peak, Friedel mates included. */
  multiplicity: number;
  /** Lexicographically greatest contributing (h, k, l) of the cell as given. */
  hkl: Vec3;
  /** Every contributing reflection. */
  reflections: Vec3[];
};

export type PowderPattern = {
  wavelength: number;
  twoThetaMin: number;
  twoThetaMax: number;
  cell: CellParameters;
  atomCount: number;
  /** Elements and their counts in the cell, e.g. { Na: 4, Cl: 4 }. */
  composition: Record<string, number>;
  peaks: PowderPeak[];
  /** Reflections in range with zero structure factor. */
  absentReflections: number;
};

export type ProfileShape = "gaussian" | "lorentzian";
export type PowderProfile = { shape: ProfileShape; fwhm: number; twoTheta: Float64Array; intensity: Float64Array };

/** The standalone module built from compute/xrd-wasm/burette_xrd.cpp. */
export type XrdEngineExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  burette_xrd_count(cell: number, dmin: number, dmax: number): number;
  burette_xrd_structure_factors(cell: number, atomCount: number, fractional: number, numbers: number, dmin: number, dmax: number, capacity: number, miller: number, spacing: number, intensity: number): number;
};

type Prepared = {
  cell: CellParameters;
  fractional: Float64Array;
  numbers: Int32Array;
  dmin: number;
  dmax: number;
  composition: Record<string, number>;
};

const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (value: number) => value * 180 / Math.PI;
const finiteIn = (value: number, range: { min: number; max: number }) => Number.isFinite(value) && value >= range.min && value <= range.max;

function cellParameters(cell: UnitCell): CellParameters {
  const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
  const angle = (u: Vec3, v: Vec3) => degrees(Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (length(u) * length(v))))));
  return { a: length(cell[0]), b: length(cell[1]), c: length(cell[2]), alpha: angle(cell[1], cell[2]), beta: angle(cell[0], cell[2]), gamma: angle(cell[0], cell[1]) };
}

function cellVolume(cell: UnitCell) {
  const [a, b, c] = cell;
  return Math.abs(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]));
}

/** The settings alone, so the dialog can explain a problem before any work starts. */
export function powderSettingsProblem(settings: Pick<PowderXrdRequest, "wavelength" | "twoThetaMin" | "twoThetaMax">): string | null {
  const { wavelength, twoThetaMin, twoThetaMax } = settings;
  if (!finiteIn(wavelength, XRD_LIMITS.wavelength)) return `The wavelength must be between ${XRD_LIMITS.wavelength.min} and ${XRD_LIMITS.wavelength.max} Å.`;
  if (!finiteIn(twoThetaMin, XRD_LIMITS.twoTheta) || !finiteIn(twoThetaMax, XRD_LIMITS.twoTheta)) return `2θ must lie between ${XRD_LIMITS.twoTheta.min}° and ${XRD_LIMITS.twoTheta.max}°.`;
  if (!(twoThetaMax > twoThetaMin)) return "The 2θ range must end after it starts.";
  const limit = XRD_LIMITS.sinThetaOverLambda;
  if (Math.sin(radians(twoThetaMax / 2)) / wavelength > limit) {
    const highest = degrees(2 * Math.asin(Math.min(1, limit * wavelength)));
    return `At ${wavelength} Å the scattering factors are tabulated up to 2θ = ${highest.toFixed(1)}° (sin θ/λ ≤ ${limit} Å⁻¹).`;
  }
  return null;
}

function prepare(request: PowderXrdRequest): Prepared {
  const problem = powderSettingsProblem(request);
  if (problem) throw new Error(problem);
  const { atoms, cell, wavelength, twoThetaMin, twoThetaMax } = request;
  if (!Array.isArray(cell) || cell.length !== 3 || cell.some((vector) => !Array.isArray(vector) || vector.length !== 3 || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error("The unit cell must have three finite lattice vectors.");
  }
  const parameters = cellParameters(cell);
  if ([parameters.a, parameters.b, parameters.c].some((length) => !finiteIn(length, XRD_LIMITS.cellLength))) {
    throw new Error(`Cell edges must be between ${XRD_LIMITS.cellLength.min} and ${XRD_LIMITS.cellLength.max} Å.`);
  }
  const volume = cellVolume(cell);
  if (!(volume > 1e-6 * parameters.a * parameters.b * parameters.c)) throw new Error("The cell vectors are nearly coplanar.");
  if (!atoms.length) throw new Error("The cell has no atoms.");
  if (atoms.length > XRD_LIMITS.atoms) throw new Error(`Powder diffraction supports up to ${XRD_LIMITS.atoms} atoms per cell; this cell has ${atoms.length}.`);

  const dmin = wavelength / (2 * Math.sin(radians(twoThetaMax / 2)));
  // The engine enumerates d < dmax; a hair of margin keeps reflections exactly at 2θ min.
  const dmax = twoThetaMin > 0 ? wavelength / (2 * Math.sin(radians(twoThetaMin / 2))) * (1 + 1e-9) : 0;
  // Reciprocal-lattice points in the shell: its volume times the cell volume.
  const shell = 4 / 3 * Math.PI * volume * (dmin ** -3 - (dmax ? dmax ** -3 : 0));
  if (shell > XRD_LIMITS.reflections * 1.1) {
    throw new Error(`About ${Math.round(shell).toLocaleString("en-US")} reflections fall in this 2θ range; the limit is ${XRD_LIMITS.reflections.toLocaleString("en-US")}. Lower 2θ max or use a smaller cell.`);
  }
  if (shell * atoms.length > XRD_LIMITS.work * 1.1) throw new Error("This cell and 2θ range need too many structure-factor terms. Lower 2θ max or use a smaller cell.");

  // Basis-independent: a skew basis of the same lattice cannot hide a short translation or a duplicate site.
  const lattice = reduceLattice(cell);
  const repeat = shortestTranslation(lattice);
  if (repeat < XRD_LIMITS.cellLength.min) throw new Error(`The lattice repeats every ${repeat.toFixed(3)} Å; lattice translations must be at least ${XRD_LIMITS.cellLength.min} Å.`);

  const fractional = new Float64Array(atoms.length * 3);
  const numbers = new Int32Array(atoms.length);
  const composition: Record<string, number> = {};
  const reduced: Vec3[] = [];
  atoms.forEach((atom, index) => {
    if (![atom.x, atom.y, atom.z].every(Number.isFinite)) throw new Error(`Atom ${index + 1} has non-finite coordinates.`);
    let number: number;
    try { number = atomicNumber(atom.element); } catch { throw new Error(`Atom ${index + 1} is not a chemical element (${atom.element}).`); }
    // Gemmi's IT92 table ends at californium.
    if (number > 98) throw new Error(`${atom.element} has no tabulated X-ray scattering factor.`);
    numbers[index] = number;
    composition[atom.element] = (composition[atom.element] ?? 0) + 1;
    cartesianToFractional([atom.x, atom.y, atom.z], cell).forEach((value, axis) => {
      const wrapped = value - Math.floor(value);
      fractional[index * 3 + axis] = wrapped >= 1 ? 0 : wrapped;
    });
    reduced.push(reducedFractional(lattice, [atom.x, atom.y, atom.z]));
  });
  const overlap = imageSearch(lattice, OVERLAP_DISTANCE);
  for (let i = 0; i < atoms.length; i++) {
    for (let j = 0; j < i; j++) {
      const distance = overlap([reduced[i][0] - reduced[j][0], reduced[i][1] - reduced[j][1], reduced[i][2] - reduced[j][2]]);
      if (distance !== null) throw new Error(`Atoms ${j + 1} and ${i + 1} occupy the same site (${distance.toFixed(3)} Å apart, modulo the lattice). Remove the duplicate first.`);
    }
  }
  return { cell: parameters, fractional, numbers, dmin, dmax, composition };
}

function engineProblem(code: number) {
  switch (code) {
    case -1: return "The diffraction engine rejected the unit cell.";
    case -2: return "The diffraction engine rejected an atom.";
    case -3: return "The diffraction engine rejected the 2θ range.";
    case -4: return "This cell needs too large a reflection search. Lower 2θ max or use a smaller cell.";
    case -5: return "The diffraction engine returned more reflections than it counted.";
    default: return `The diffraction engine failed (${code}).`;
  }
}

type Reflections = { miller: Int32Array; d: Float64Array; f2: Float64Array };

/** Counts first and allocates only within budget; every buffer is freed. */
function structureFactors(engine: XrdEngineExports, prepared: Prepared): Reflections {
  const pointers: number[] = [];
  const allocate = (bytes: number) => {
    const pointer = engine.malloc(Math.max(8, bytes));
    if (!pointer) throw new Error("The diffraction engine ran out of memory.");
    pointers.push(pointer);
    return pointer;
  };
  try {
    const { a, b, c, alpha, beta, gamma } = prepared.cell;
    const cell = allocate(6 * 8);
    new Float64Array(engine.memory.buffer, cell, 6).set([a, b, c, alpha, beta, gamma]);
    const count = engine.burette_xrd_count(cell, prepared.dmin, prepared.dmax);
    if (count < 0) throw new Error(engineProblem(count));
    if (count > XRD_LIMITS.reflections) throw new Error(`${count.toLocaleString("en-US")} reflections fall in this 2θ range; the limit is ${XRD_LIMITS.reflections.toLocaleString("en-US")}. Lower 2θ max or use a smaller cell.`);
    if (count * prepared.numbers.length > XRD_LIMITS.work) throw new Error("This cell and 2θ range need too many structure-factor terms. Lower 2θ max or use a smaller cell.");
    const atoms = prepared.numbers.length;
    const fractional = allocate(atoms * 3 * 8);
    const numbers = allocate(atoms * 4);
    const miller = allocate(count * 3 * 4);
    const spacing = allocate(count * 8);
    const intensity = allocate(count * 8);
    // Views are taken after the last allocation: growing memory detaches older ones.
    new Float64Array(engine.memory.buffer, cell, 6).set([a, b, c, alpha, beta, gamma]);
    new Float64Array(engine.memory.buffer, fractional, atoms * 3).set(prepared.fractional);
    new Int32Array(engine.memory.buffer, numbers, atoms).set(prepared.numbers);
    const written = engine.burette_xrd_structure_factors(cell, atoms, fractional, numbers, prepared.dmin, prepared.dmax, count, miller, spacing, intensity);
    if (written < 0) throw new Error(engineProblem(written));
    return {
      miller: new Int32Array(engine.memory.buffer, miller, written * 3).slice(),
      d: new Float64Array(engine.memory.buffer, spacing, written).slice(),
      f2: new Float64Array(engine.memory.buffer, intensity, written).slice(),
    };
  } finally {
    for (const pointer of pointers) engine.free(pointer);
  }
}

const lexicographicallyGreater = (a: Vec3, b: Vec3) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/** Reflections at one 2θ become one peak; absent reflections contribute nothing. */
function aggregate(reflections: Reflections, prepared: Prepared, request: PowderXrdRequest) {
  const { wavelength, twoThetaMin, twoThetaMax } = request;
  const absenceLimit = EXTINCTION_TOLERANCE * Array.from(prepared.numbers).reduce((sum, z) => sum + z * z, 0);
  const order: number[] = [];
  const twoTheta = new Float64Array(reflections.d.length);
  let absent = 0;
  for (let index = 0; index < reflections.d.length; index++) {
    const angle = 2 * degrees(Math.asin(Math.min(1, wavelength / (2 * reflections.d[index]))));
    twoTheta[index] = angle;
    if (angle < twoThetaMin - 1e-9 || angle > twoThetaMax + 1e-9) continue;
    if (reflections.f2[index] <= absenceLimit) { absent++; continue; }
    order.push(index);
  }
  const millerOf = (index: number): Vec3 => [reflections.miller[index * 3], reflections.miller[index * 3 + 1], reflections.miller[index * 3 + 2]];
  order.sort((left, right) => twoTheta[left] - twoTheta[right] || reflections.miller[left * 3] - reflections.miller[right * 3] || reflections.miller[left * 3 + 1] - reflections.miller[right * 3 + 1] || reflections.miller[left * 3 + 2] - reflections.miller[right * 3 + 2]);
  const peaks: PowderPeak[] = [];
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && twoTheta[order[end]] - twoTheta[order[start]] <= PEAK_MERGE_DEGREES) end++;
    const members = order.slice(start, end);
    const f2 = members.reduce((sum, index) => sum + reflections.f2[index], 0);
    const angle = members.reduce((sum, index) => sum + twoTheta[index], 0) / members.length;
    const d = members.reduce((sum, index) => sum + reflections.d[index], 0) / members.length;
    const theta = radians(angle / 2);
    const lorentzPolarization = (1 + Math.cos(2 * theta) ** 2) / (Math.sin(theta) ** 2 * Math.cos(theta));
    const hkls = members.map(millerOf);
    peaks.push({
      twoTheta: angle, d, relativeIntensity: 0, intensity: f2 * lorentzPolarization, structureFactorSquared: f2,
      multiplicity: members.length, hkl: hkls.reduce((best, hkl) => lexicographicallyGreater(hkl, best) ? hkl : best), reflections: hkls,
    });
    start = end;
  }
  const strongest = peaks.reduce((max, peak) => Math.max(max, peak.intensity), 0);
  for (const peak of peaks) peak.relativeIntensity = strongest > 0 ? 100 * peak.intensity / strongest : 0;
  return { peaks, absent };
}

/** Full calculation; `engine` is the instantiated burette-xrd.wasm. */
export function computePowderPattern(engine: XrdEngineExports, request: PowderXrdRequest): PowderPattern {
  const prepared = prepare(request);
  const { peaks, absent } = aggregate(structureFactors(engine, prepared), prepared, request);
  return {
    wavelength: request.wavelength, twoThetaMin: request.twoThetaMin, twoThetaMax: request.twoThetaMax,
    cell: prepared.cell, atomCount: request.atoms.length, composition: prepared.composition,
    peaks, absentReflections: absent,
  };
}

export function profileProblem(fwhm: number) {
  return finiteIn(fwhm, XRD_LIMITS.fwhm) ? null : `The FWHM must be between ${XRD_LIMITS.fwhm.min}° and ${XRD_LIMITS.fwhm.max}° 2θ.`;
}

/**
 * Sampling of a broadened curve. Every peak centre and both ends of the range
 * are samples; spacing is FWHM / 20 near a peak and grows to 10 % of the
 * distance to the nearest peak, so straight lines between samples stay within
 * 0.5 % of the curve maximum of the stated function, at any FWHM.
 */
const PROFILE_SAMPLING = { coreStep: 1 / 20, tailRatio: 0.1, rangeSteps: 1_000 } as const;
/** Each peak is evaluated to this many FWHM on either side; peaks outside the 2θ range contribute nothing. */
const PROFILE_REACH: Record<ProfileShape, number> = { gaussian: 3, lorentzian: 50 };
export const PROFILE_LIMITS = { points: 500_000, terms: 100_000_000 } as const;
const PROFILE_SAMPLING_TEXT = "Nonuniform samples: every peak centre and both 2θ ends; spacing FWHM/20 near a peak, growing to 10% of the distance to the nearest peak. Linear interpolation between samples stays within 0.5% of the maximum. Gaussians are evaluated to ±3 FWHM and Lorentzians to ±50 FWHM of each peak.";

type ProfileInput = Pick<PowderPattern, "peaks" | "twoThetaMin" | "twoThetaMax">;

/** Sorted centres and weights of the peaks that carry intensity. */
function profileSources(peaks: ProfileInput["peaks"]) {
  const sources = peaks.filter((peak) => peak.relativeIntensity > 0).sort((a, b) => a.twoTheta - b.twoTheta);
  return { centers: Float64Array.from(sources, (peak) => peak.twoTheta), weights: Float64Array.from(sources, (peak) => peak.relativeIntensity) };
}

/** The sample positions, or null once they would exceed `limit`. */
function profileGrid(centers: Float64Array, start: number, stop: number, fwhm: number, limit: number): Float64Array | null {
  const core = fwhm * PROFILE_SAMPLING.coreStep;
  const widest = Math.max(core, (stop - start) / PROFILE_SAMPLING.rangeSteps);
  let grid = new Float64Array(1024);
  let count = 0;
  const push = (value: number) => {
    if (count === grid.length) { const grown = new Float64Array(grid.length * 2); grown.set(grid); grid = grown; }
    grid[count++] = value;
  };
  let next = 0;
  for (let x = start; ; ) {
    push(x);
    if (count > limit) return null;
    if (x >= stop) break;
    while (next < centers.length && centers[next] <= x) next++;
    const nearest = Math.min(next > 0 ? x - centers[next - 1] : Infinity, next < centers.length ? centers[next] - x : Infinity);
    let target = x + Math.min(widest, Math.max(core, PROFILE_SAMPLING.tailRatio * nearest));
    // Land exactly on the next centre and on the end, without a sliver step before either.
    if (next < centers.length && centers[next] - target < core / 4) target = centers[next];
    if (target > stop || stop - target < core / 4) target = stop;
    x = target;
  }
  return grid.slice(0, count);
}

/** The narrowest FWHM, up to the maximum, whose samples fit the budget; null when none does. */
function resolvableFwhm(centers: Float64Array, start: number, stop: number, fwhm: number) {
  const fits = (width: number) => profileGrid(centers, start, stop, width, PROFILE_LIMITS.points) !== null;
  let low = fwhm, high = fwhm;
  while (!fits(high)) {
    if (high >= XRD_LIMITS.fwhm.max) return null;
    low = high;
    high = Math.min(XRD_LIMITS.fwhm.max, high * 2);
  }
  for (let iteration = 0; iteration < 20 && high / low > 1.001; iteration++) {
    const middle = Math.sqrt(low * high);
    if (fits(middle)) high = middle; else low = middle;
  }
  // Round up to two significant digits so the suggestion itself fits.
  const scale = 10 ** (Math.floor(Math.log10(high)) - 1);
  return Math.min(XRD_LIMITS.fwhm.max, Number((Math.ceil(high / scale - 1e-9) * scale).toPrecision(2)));
}

/**
 * Broadened pattern: each peak becomes a Gaussian or Lorentzian of constant
 * FWHM (degrees 2θ) with its relative intensity as area weight, evaluated
 * exactly at the samples described by PROFILE_SAMPLING. The curve is scaled
 * so its maximum is 100. A pattern that would need more samples or terms than
 * PROFILE_LIMITS is refused with the change that makes it fit.
 */
export function broadenPattern(pattern: ProfileInput, shape: ProfileShape, fwhm: number): PowderProfile {
  const problem = profileProblem(fwhm);
  if (problem) throw new Error(problem);
  const { twoThetaMin: start, twoThetaMax: stop } = pattern;
  if (!(Number.isFinite(start) && Number.isFinite(stop) && stop > start)) throw new Error("The 2θ range must end after it starts.");
  const { centers, weights } = profileSources(pattern.peaks);
  const twoTheta = profileGrid(centers, start, stop, fwhm, PROFILE_LIMITS.points);
  if (!twoTheta) {
    const wider = resolvableFwhm(centers, start, stop, fwhm);
    const remedy = wider ? `Use an FWHM of at least ${wider}°, narrow the 2θ range, or show sticks.` : "Narrow the 2θ range or show sticks.";
    throw new Error(`Resolving ${centers.length.toLocaleString("en-US")} peaks at ${fwhm}° FWHM needs more than ${PROFILE_LIMITS.points.toLocaleString("en-US")} profile points. ${remedy}`);
  }
  const reach = PROFILE_REACH[shape] * fwhm;
  // Peaks within reach of each sample: a sliding window over the sorted centres.
  let terms = 0;
  for (let index = 0, low = 0, high = 0; index < twoTheta.length; index++) {
    while (low < centers.length && centers[low] < twoTheta[index] - reach) low++;
    while (high < centers.length && centers[high] <= twoTheta[index] + reach) high++;
    terms += high - low;
  }
  if (terms > PROFILE_LIMITS.terms) {
    throw new Error(`The ${shape === "gaussian" ? "Gaussian" : "Lorentzian"} tails of ${centers.length.toLocaleString("en-US")} peaks overlap too much to evaluate. Narrow the 2θ range or the FWHM${shape === "lorentzian" ? ", use the Gaussian profile," : ""} or show sticks.`);
  }
  const intensity = new Float64Array(twoTheta.length);
  const scale = 4 / (fwhm * fwhm);
  for (let index = 0, low = 0, high = 0; index < twoTheta.length; index++) {
    const x = twoTheta[index];
    while (low < centers.length && centers[low] < x - reach) low++;
    while (high < centers.length && centers[high] <= x + reach) high++;
    let sum = 0;
    for (let peak = low; peak < high; peak++) {
      const offset = x - centers[peak];
      sum += weights[peak] * (shape === "gaussian" ? Math.exp(-Math.LN2 * scale * offset * offset) : 1 / (1 + scale * offset * offset));
    }
    intensity[index] = sum;
  }
  const max = intensity.reduce((value, item) => Math.max(value, item), 0);
  if (max > 0) for (let index = 0; index < intensity.length; index++) intensity[index] = 100 * intensity[index] / max;
  return { shape, fwhm, twoTheta, intensity };
}

// ---- export ---------------------------------------------------------------------

export type PowderExportContext = { title: string; radiation: string; profile: PowderProfile | null; engine: string };

const MODEL = {
  scatteringFactors: "Neutral-atom X-ray form factors of International Tables for Crystallography Vol. C (1992), as tabulated in Gemmi; no anomalous dispersion.",
  temperatureFactors: "None: every atom has B = 0 Å² and occupancy 1.",
  symmetry: "Structure factors are summed over every explicit atom of the cell in P1; no symmetry operation is applied.",
  intensity: "I = Σ|F|² · (1 + cos² 2θ) / (sin² θ · cos θ): unpolarized beam, Bragg-Brentano geometry, no monochromator. Relative intensities scale the strongest peak to 100.",
  radiation: "One wavelength; no Kα2 component and no background.",
  peaks: "Reflections whose 2θ agree within 1e-5° are one peak; multiplicity counts them, Friedel mates included. Miller indices refer to the cell as given.",
} as const;

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const csvText = (value: string) => /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
const formula = (composition: Record<string, number>) => Object.entries(composition).map(([element, count]) => `${element}${count === 1 ? "" : count}`).join(" ");

/** One row per peak, with the settings and model as leading comment lines. */
export function powderPatternCsv(pattern: PowderPattern, context: PowderExportContext) {
  const { a, b, c, alpha, beta, gamma } = pattern.cell;
  const header = [
    "Burette powder X-ray diffraction pattern",
    `Source: ${context.title} (${formula(pattern.composition)}, ${pattern.atomCount} atoms in the cell)`,
    `Cell: a=${a.toFixed(5)} b=${b.toFixed(5)} c=${c.toFixed(5)} Å, alpha=${alpha.toFixed(4)} beta=${beta.toFixed(4)} gamma=${gamma.toFixed(4)}°`,
    `Wavelength: ${pattern.wavelength} Å (${context.radiation})`,
    `2theta range: ${pattern.twoThetaMin}–${pattern.twoThetaMax}°`,
    ...Object.values(MODEL),
    `Engine: ${context.engine}`,
  ].map((line) => `# ${line.replace(/[\r\n]+/gu, " ")}`);
  const rows = pattern.peaks.map((peak) => [
    round(peak.twoTheta, 5), round(peak.d, 6), round(peak.relativeIntensity, 4), peak.intensity.toPrecision(8), peak.structureFactorSquared.toPrecision(8), peak.multiplicity, ...peak.hkl,
  ].map((value) => csvText(String(value))).join(","));
  return [...header, "two_theta_deg,d_angstrom,relative_intensity,intensity_e2,structure_factor_sq_e2,multiplicity,h,k,l", ...rows].join("\n") + "\n";
}

/** Peaks with every contributing reflection, the actual settings, units and model; plus the profile when one is shown. */
export function powderPatternJson(pattern: PowderPattern, context: PowderExportContext) {
  return JSON.stringify({
    format: "burette-powder-xrd",
    version: 1,
    source: { title: context.title, atomCount: pattern.atomCount, composition: pattern.composition, cell: pattern.cell },
    settings: { radiation: context.radiation, wavelengthAngstrom: pattern.wavelength, twoThetaMinDegrees: pattern.twoThetaMin, twoThetaMaxDegrees: pattern.twoThetaMax },
    units: { twoTheta: "degrees", d: "angstrom", cell: "angstrom, degrees", intensity: "electrons squared", relativeIntensity: "strongest peak = 100" },
    model: { ...MODEL, engine: context.engine },
    absentReflections: pattern.absentReflections,
    peaks: pattern.peaks.map((peak) => ({
      twoTheta: peak.twoTheta, d: peak.d, relativeIntensity: peak.relativeIntensity, intensity: peak.intensity,
      structureFactorSquared: peak.structureFactorSquared, multiplicity: peak.multiplicity, hkl: peak.hkl, reflections: peak.reflections,
    })),
    profile: context.profile ? {
      shape: context.profile.shape, fwhmDegrees: context.profile.fwhm, scaling: "maximum = 100", sampling: PROFILE_SAMPLING_TEXT,
      twoTheta: Array.from(context.profile.twoTheta, (value) => round(value, 8)), intensity: Array.from(context.profile.intensity, (value) => round(value, 5)),
    } : null,
  }, null, 1);
}
