import { atomicNumber } from "../elements";
import type { MolecularAtom, UnitCell } from "../types";

/**
 * Radial distribution function g(r) of one explicit, periodic unit cell.
 *
 * This is the observable Avogadro's "Plot Pair Distribution Function…"
 * (avogadrolibs qtplugins/plotpdf) draws: atom-position pair counts
 * normalised by the number density, unweighted by element, plotted as g(r).
 * It is not the X-ray or neutron pair distribution function G(r) of total
 * scattering, which weights pairs by scattering lengths or form factors.
 *
 * For centre atoms in A and neighbours in B (each a single element or every
 * atom), with n_AB(k) the ordered pairs (i in A, j in B, lattice translation
 * t) whose distance |r_j + t - r_i| lies in the half-open bin
 * [r_k, r_k + Δr):
 *
 *   g_AB(r_k) = V · n_AB(k) / (N_A · N_B · ΔV_k),  ΔV_k = 4π/3 · (r_{k+1}^3 - r_k^3)
 *
 * An atom's zero distance to itself is excluded; its distances to its own
 * lattice images are included. g tends to 1 for an uncorrelated arrangement at
 * the cell's density. The running coordination number N_AB(r) = Σ n_AB / N_A
 * up to a bin's upper edge is the mean number of B neighbours of an A atom.
 *
 * Every lattice image within r max is enumerated from the cell's reciprocal
 * vectors, so oblique cells and radii beyond half the cell are exact; no
 * componentwise fractional wrapping or minimum-image shortcut is used.
 * Differences from the Avogadro plugin: it counts the r = 0 self pair, sizes
 * its supercell from edge lengths (too few images for oblique cells), and
 * normalises with 4π r_k^2 Δr at the lower bin edge.
 */

export const PAIR_DISTRIBUTION_LIMITS = {
  /** Angstrom. */
  rMax: { min: 1, max: 100 },
  /** Angstrom. */
  binWidth: { min: 0.001, max: 1 },
  bins: 20_000,
  atoms: 5_000,
  species: 12,
  /** Ordered element pairs times bins kept in one result. */
  histogramValues: 2_000_000,
  /** Image distances one calculation may evaluate (an upper bound computed before any work). */
  evaluations: 200_000_000,
  /** Ordered pairs within r max, estimated from the density. */
  pairs: 50_000_000,
  /** Angstrom. */
  cellLength: 1_000,
  /** Shortest distance between lattice planes, angstrom. */
  cellHeight: 1,
} as const;

/** The Avogadro dialog's defaults. */
export const PAIR_DISTRIBUTION_DEFAULTS = { rMax: 10, binWidth: 0.1 } as const;

/** Atoms closer than this, modulo the lattice, are one site listed twice. */
const OVERLAP_DISTANCE = 0.1;
/** rMax / binWidth within this of an integer is that many bins. */
const BIN_ROUNDING = 1e-9;

export type PairDistributionRequest = {
  atoms: MolecularAtom[];
  cell: UnitCell;
  /** Angstrom. */
  rMax: number;
  /** Angstrom. */
  binWidth: number;
};

export type CellParameters = { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };

export type PairDistribution = {
  /** Upper edge of the last bin, angstrom: a whole number of bins. */
  rMax: number;
  binWidth: number;
  bins: number;
  cell: CellParameters;
  /** Cubic angstrom. */
  volume: number;
  atomCount: number;
  /** Element symbols, by atomic number. */
  species: string[];
  speciesCounts: number[];
  /**
   * Ordered pair counts: counts[(a * S + b) * bins + k] pairs with the centre of
   * species a and the neighbour of species b in bin k.
   */
  counts: Float64Array;
  /** Shortest distance per ordered species pair within r max, angstrom; Infinity when none. */
  minDistance: Float64Array;
  /** Ordered pairs counted. */
  pairs: number;
  /** Image distances evaluated. */
  evaluations: number;
};

/** A centre or neighbour set: one element symbol, or null for every atom. */
export type SpeciesSelection = string | null;

export type PairSelection = {
  centre: SpeciesSelection;
  neighbour: SpeciesSelection;
  centreCount: number;
  neighbourCount: number;
  /** Ordered pairs per bin. */
  counts: Float64Array;
  g: Float64Array;
  /** Running coordination number at each bin's upper edge. */
  coordination: Float64Array;
  /** Angstrom; Infinity when no pair lies within r max. */
  minDistance: number;
};

const finiteIn = (value: number, range: { min: number; max: number }) => Number.isFinite(value) && value >= range.min && value <= range.max;
const degrees = (value: number) => value * 180 / Math.PI;
const count = (value: number) => Math.round(value).toLocaleString("en-US");

/** Whole bins in rMax; rMax is cut down to the last whole bin. */
export function pairDistributionBins(rMax: number, binWidth: number) {
  return Math.floor(rMax / binWidth + BIN_ROUNDING);
}

/** The settings alone, so the panel can explain a problem before any work starts. */
export function pairDistributionSettingsProblem(settings: Pick<PairDistributionRequest, "rMax" | "binWidth">): string | null {
  const { rMax, binWidth } = settings;
  const { rMax: radius, binWidth: width, bins } = PAIR_DISTRIBUTION_LIMITS;
  if (!finiteIn(rMax, radius)) return `r max must be between ${radius.min} and ${radius.max} Å.`;
  if (!finiteIn(binWidth, width)) return `The bin width must be between ${width.min} and ${width.max} Å.`;
  if (pairDistributionBins(rMax, binWidth) > bins) return `r max / bin width gives more than ${bins.toLocaleString("en-US")} bins. Widen the bins or lower r max.`;
  if (pairDistributionBins(rMax, binWidth) < 1) return "r max must hold at least one bin.";
  return null;
}

type Prepared = {
  bins: number;
  rMax: number;
  matrix: Float64Array;
  /** Fractional coordinates, three per atom. */
  fractional: Float64Array;
  /** Species index per atom. */
  speciesOf: Int32Array;
  species: string[];
  speciesCounts: number[];
  /** r max times the reciprocal vector lengths: the fractional reach along each axis. */
  reach: [number, number, number];
  volume: number;
  cell: CellParameters;
  evaluations: number;
};

function prepare(request: PairDistributionRequest): Prepared {
  const problem = pairDistributionSettingsProblem(request);
  if (problem) throw new Error(problem);
  const { atoms, cell, binWidth } = request;
  if (!Array.isArray(cell) || cell.length !== 3 || cell.some((vector) => !Array.isArray(vector) || vector.length !== 3 || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error("The unit cell must have three finite lattice vectors.");
  }
  const [a, b, c] = cell;
  const lengths = cell.map((vector) => Math.hypot(...vector));
  if (lengths.some((length) => !(length > 0) || length > PAIR_DISTRIBUTION_LIMITS.cellLength)) throw new Error(`Cell edges must be shorter than ${PAIR_DISTRIBUTION_LIMITS.cellLength} Å.`);
  const cross = (u: readonly number[], v: readonly number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b);
  const determinant = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2];
  const volume = Math.abs(determinant);
  if (!(volume > 1e-6 * lengths[0] * lengths[1] * lengths[2])) throw new Error("The cell vectors are nearly coplanar.");
  // Reciprocal vectors without 2π: fractional coordinate k of a vector v is v · reciprocal[k].
  const reciprocal = [bc, ca, ab].map((vector) => vector.map((value) => value / determinant));
  const heights = reciprocal.map((vector) => 1 / Math.hypot(...vector));
  if (heights.some((height) => height < PAIR_DISTRIBUTION_LIMITS.cellHeight)) {
    throw new Error(`Lattice planes of this cell are ${Math.min(...heights).toFixed(3)} Å apart; the pair distribution needs at least ${PAIR_DISTRIBUTION_LIMITS.cellHeight} Å.`);
  }
  if (!atoms.length) throw new Error("The cell has no atoms.");
  if (atoms.length > PAIR_DISTRIBUTION_LIMITS.atoms) throw new Error(`The pair distribution supports up to ${count(PAIR_DISTRIBUTION_LIMITS.atoms)} atoms per cell; this cell has ${count(atoms.length)}.`);

  const symbols = new Map<string, number>();
  atoms.forEach((atom, index) => {
    if (![atom.x, atom.y, atom.z].every(Number.isFinite)) throw new Error(`Atom ${index + 1} has non-finite coordinates.`);
    if (!symbols.has(atom.element)) {
      try { symbols.set(atom.element, atomicNumber(atom.element)); } catch { throw new Error(`Atom ${index + 1} is not a chemical element (${atom.element}).`); }
    }
  });
  const species = [...symbols.keys()].sort((left, right) => symbols.get(left)! - symbols.get(right)!);
  if (species.length > PAIR_DISTRIBUTION_LIMITS.species) throw new Error(`The pair distribution supports up to ${PAIR_DISTRIBUTION_LIMITS.species} elements; this cell has ${species.length}.`);
  const bins = pairDistributionBins(request.rMax, binWidth);
  if (species.length ** 2 * bins > PAIR_DISTRIBUTION_LIMITS.histogramValues) throw new Error(`${species.length} elements and ${count(bins)} bins need too large a histogram. Widen the bins or lower r max.`);
  const rMax = bins * binWidth;

  const index = new Map(species.map((symbol, position) => [symbol, position]));
  const speciesOf = new Int32Array(atoms.length);
  const speciesCounts = species.map(() => 0);
  const fractional = new Float64Array(atoms.length * 3);
  atoms.forEach((atom, position) => {
    const kind = index.get(atom.element)!;
    speciesOf[position] = kind;
    speciesCounts[kind]++;
    for (let axis = 0; axis < 3; axis++) {
      const r = reciprocal[axis];
      const value = atom.x * r[0] + atom.y * r[1] + atom.z * r[2];
      if (!Number.isFinite(value)) throw new Error(`Atom ${position + 1} overflows fractional coordinates.`);
      // Periodic translations do not change the observable. Bounded fractions
      // also keep image-loop integers below the range where n++ stops advancing.
      fractional[position * 3 + axis] = (value - Math.floor(value)) % 1;
    }
  });

  const reach = reciprocal.map((vector) => rMax * Math.hypot(...vector)) as [number, number, number];
  // At most floor(2·reach) + 1 integers fit each axis's window, for every pair.
  const box = reach.reduce((product, value) => product * (Math.floor(2 * value) + 1), 1);
  const evaluations = atoms.length * (atoms.length + 1) / 2 * box;
  if (evaluations > PAIR_DISTRIBUTION_LIMITS.evaluations) throw new Error(`This cell and r max need up to ${count(evaluations)} image distances; the limit is ${count(PAIR_DISTRIBUTION_LIMITS.evaluations)}. Lower r max.`);
  const expectedPairs = atoms.length ** 2 * (4 / 3) * Math.PI * rMax ** 3 / volume;
  if (expectedPairs > PAIR_DISTRIBUTION_LIMITS.pairs * 1.1) throw new Error(`About ${count(expectedPairs)} atom pairs lie within ${rMax} Å; the limit is ${count(PAIR_DISTRIBUTION_LIMITS.pairs)}. Lower r max.`);

  const parameters: CellParameters = {
    a: lengths[0], b: lengths[1], c: lengths[2],
    alpha: angle(b, c), beta: angle(a, c), gamma: angle(a, b),
  };
  return { bins, rMax, matrix: Float64Array.from(cell.flat()), fractional, speciesOf, species, speciesCounts, reach, volume, cell: parameters, evaluations };
}

function angle(u: readonly number[], v: readonly number[]) {
  const cosine = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
  return degrees(Math.acos(Math.max(-1, Math.min(1, cosine))));
}

/** Validate the bounded periodic workload before admitting an external job, without enumerating pairs. */
export function validatePairDistributionRequest(request: PairDistributionRequest): void {
  prepare(request);
}

/** Full histogram of every ordered element pair; runs in a worker. */
export function computePairDistribution(request: PairDistributionRequest): PairDistribution {
  const prepared = prepare(request);
  const { bins, rMax, matrix: m, fractional, speciesOf, reach, species } = prepared;
  const kinds = species.length;
  const atoms = speciesOf.length;
  const counts = new Float64Array(kinds * kinds * bins);
  const minDistance = new Float64Array(kinds * kinds).fill(Infinity);
  const rMax2 = rMax * rMax;
  const overlap2 = OVERLAP_DISTANCE * OVERLAP_DISTANCE;
  const inverseWidth = 1 / request.binWidth;
  let pairs = 0;
  let evaluations = 0;
  for (let i = 0; i < atoms; i++) {
    for (let j = i; j < atoms; j++) {
      const f0 = fractional[j * 3] - fractional[i * 3];
      const f1 = fractional[j * 3 + 1] - fractional[i * 3 + 1];
      const f2 = fractional[j * 3 + 2] - fractional[i * 3 + 2];
      // Every translation n with |(f + n) · cell| < r max has |f_k + n_k| <= reach_k on each axis.
      const lo0 = Math.ceil(-reach[0] - f0), hi0 = Math.floor(reach[0] - f0);
      const lo1 = Math.ceil(-reach[1] - f1), hi1 = Math.floor(reach[1] - f1);
      const lo2 = Math.ceil(-reach[2] - f2), hi2 = Math.floor(reach[2] - f2);
      const forward = (speciesOf[i] * kinds + speciesOf[j]) * bins;
      const backward = (speciesOf[j] * kinds + speciesOf[i]) * bins;
      for (let n0 = lo0; n0 <= hi0; n0++) {
        const u0 = f0 + n0;
        for (let n1 = lo1; n1 <= hi1; n1++) {
          const u1 = f1 + n1;
          const x01 = u0 * m[0] + u1 * m[3], y01 = u0 * m[1] + u1 * m[4], z01 = u0 * m[2] + u1 * m[5];
          for (let n2 = lo2; n2 <= hi2; n2++) {
            evaluations++;
            const u2 = f2 + n2;
            const x = x01 + u2 * m[6], y = y01 + u2 * m[7], z = z01 + u2 * m[8];
            const d2 = x * x + y * y + z * z;
            if (d2 >= rMax2) continue;
            if (i === j && n0 === 0 && n1 === 0 && n2 === 0) continue;
            if (d2 < overlap2) {
              throw new Error(i === j
                ? `The lattice repeats atom ${i + 1} within ${OVERLAP_DISTANCE} Å.`
                : `Atoms ${i + 1} and ${j + 1} occupy the same site (${Math.sqrt(d2).toFixed(3)} Å apart, modulo the lattice). Remove the duplicate first.`);
            }
            const d = Math.sqrt(d2);
            const bin = Math.floor(d * inverseWidth);
            if (bin >= bins) continue;
            // Pair (i, j, n) and its reverse (j, i, -n) have the same distance.
            counts[forward + bin]++;
            pairs++;
            if (i !== j) { counts[backward + bin]++; pairs++; }
            const fa = forward / bins, ba = backward / bins;
            if (d < minDistance[fa]) minDistance[fa] = d;
            if (d < minDistance[ba]) minDistance[ba] = d;
          }
        }
      }
    }
  }
  return {
    rMax, binWidth: request.binWidth, bins, cell: prepared.cell, volume: prepared.volume, atomCount: atoms,
    species, speciesCounts: prepared.speciesCounts, counts, minDistance, pairs, evaluations,
  };
}

/** g(r) and the running coordination number for one centre and neighbour set. */
export function selectPairs(result: PairDistribution, centre: SpeciesSelection, neighbour: SpeciesSelection): PairSelection {
  const { species, speciesCounts, bins, binWidth, volume } = result;
  const members = (selection: SpeciesSelection) => {
    if (selection === null) return species.map((_, index) => index);
    const index = species.indexOf(selection);
    if (index < 0) throw new Error(`This cell has no ${selection} atoms.`);
    return [index];
  };
  const centres = members(centre), neighbours = members(neighbour);
  const centreCount = centres.reduce((sum, index) => sum + speciesCounts[index], 0);
  const neighbourCount = neighbours.reduce((sum, index) => sum + speciesCounts[index], 0);
  const kinds = species.length;
  const counts = new Float64Array(bins);
  let minDistance = Infinity;
  for (const a of centres) {
    for (const b of neighbours) {
      const offset = (a * kinds + b) * bins;
      for (let k = 0; k < bins; k++) counts[k] += result.counts[offset + k];
      minDistance = Math.min(minDistance, result.minDistance[a * kinds + b]);
    }
  }
  const g = new Float64Array(bins);
  const coordination = new Float64Array(bins);
  const scale = volume / (centreCount * neighbourCount);
  let running = 0;
  for (let k = 0; k < bins; k++) {
    const shell = 4 / 3 * Math.PI * binWidth ** 3 * ((k + 1) ** 3 - k ** 3);
    g[k] = scale * counts[k] / shell;
    running += counts[k];
    coordination[k] = running / centreCount;
  }
  return { centre, neighbour, centreCount, neighbourCount, counts, g, coordination, minDistance };
}

// ---- export ---------------------------------------------------------------------

export type PairDistributionExportContext = { title: string; engine: string };

const MODEL = {
  observable: "Radial distribution function g(r) of atom positions, normalised by number density and unweighted by element; no X-ray or neutron scattering factors are applied.",
  sites: "Explicit atoms of one fully occupied cell; CIF symmetry is expanded on reading, partial occupancy and disorder are rejected.",
  boundary: "Periodic: every lattice image within r max of every atom in the cell is counted, from the cell's own (possibly oblique) lattice vectors.",
  selfPairs: "An atom's zero distance to itself is excluded; distances to its own lattice images are included.",
  normalisation: "g_AB(r_k) = V · n_AB(k) / (N_A · N_B · ΔV_k), ΔV_k = 4π/3 · (r_{k+1}^3 − r_k^3); n_AB(k) counts ordered pairs with a centre in A and a neighbour in B and r_k ≤ r < r_{k+1}.",
  coordination: "N_AB(r) = Σ n_AB / N_A up to the bin's upper edge: the mean number of B neighbours of an A atom.",
} as const;

const label = (selection: SpeciesSelection) => selection ?? "all";
const round = (value: number, digits: number) => Number(value.toFixed(digits));
const csvText = (value: string) => /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
const formula = (result: PairDistribution) => result.species.map((symbol, index) => `${symbol}${result.speciesCounts[index] === 1 ? "" : result.speciesCounts[index]}`).join(" ");
const cellLine = ({ a, b, c, alpha, beta, gamma }: CellParameters) => `a=${a.toFixed(5)} b=${b.toFixed(5)} c=${c.toFixed(5)} Å, alpha=${alpha.toFixed(4)} beta=${beta.toFixed(4)} gamma=${gamma.toFixed(4)}°`;

/** One row per bin of the selected pair, with the settings and model as leading comment lines. */
export function pairDistributionCsv(result: PairDistribution, selection: PairSelection, context: PairDistributionExportContext) {
  const header = [
    "Burette radial distribution function g(r)",
    `Source: ${context.title} (${formula(result)}, ${result.atomCount} atoms in the cell)`,
    `Cell: ${cellLine(result.cell)}, V=${result.volume.toFixed(5)} Å^3`,
    `Centre: ${label(selection.centre)} (${selection.centreCount} atoms); neighbour: ${label(selection.neighbour)} (${selection.neighbourCount} atoms)`,
    `Bins: ${result.bins} × ${result.binWidth} Å, r max ${round(result.rMax, 9)} Å`,
    `Number density: ${(result.atomCount / result.volume).toPrecision(8)} Å^-3`,
    ...Object.values(MODEL),
    `Engine: ${context.engine}`,
  ].map((line) => `# ${line.replace(/[\r\n]+/gu, " ")}`);
  const rows = Array.from(selection.g, (g, k) => [
    round(k * result.binWidth, 9), round((k + 1) * result.binWidth, 9), round((k + 0.5) * result.binWidth, 9),
    selection.counts[k], g.toPrecision(10), selection.coordination[k].toPrecision(10),
  ].map((value) => csvText(String(value))).join(","));
  return [...header, "r_low_angstrom,r_high_angstrom,r_center_angstrom,pair_count,g_r,coordination_number", ...rows].join("\n") + "\n";
}

/** Raw ordered-pair counts of every element pair with units, settings and model; plus the shown selection. */
export function pairDistributionJson(result: PairDistribution, selection: PairSelection, context: PairDistributionExportContext) {
  const kinds = result.species.length;
  const histograms = result.species.flatMap((centre, a) => result.species.map((neighbour, b) => ({
    centre, neighbour,
    minDistance: Number.isFinite(result.minDistance[a * kinds + b]) ? result.minDistance[a * kinds + b] : null,
    counts: Array.from(result.counts.subarray((a * kinds + b) * result.bins, (a * kinds + b + 1) * result.bins)),
  })));
  return JSON.stringify({
    format: "burette-pair-distribution",
    version: 1,
    source: {
      title: context.title, atomCount: result.atomCount, cell: result.cell, volume: result.volume,
      species: result.species.map((symbol, index) => ({ symbol, count: result.speciesCounts[index] })),
    },
    settings: { rMax: result.rMax, binWidth: result.binWidth, bins: result.bins, boundary: "periodic" },
    units: { r: "angstrom", volume: "cubic angstrom", numberDensity: "per cubic angstrom", g: "dimensionless", coordination: "atoms", counts: "ordered pairs per bin" },
    model: { ...MODEL, bins: "Half-open [r_k, r_k + Δr), r_k = k · Δr.", engine: context.engine },
    numberDensity: result.atomCount / result.volume,
    pairs: result.pairs,
    histograms,
    selection: {
      centre: label(selection.centre), neighbour: label(selection.neighbour),
      centreCount: selection.centreCount, neighbourCount: selection.neighbourCount,
      g: Array.from(selection.g), coordination: Array.from(selection.coordination),
    },
  }, null, 1);
}
