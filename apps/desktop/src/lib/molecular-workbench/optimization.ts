import type { MolecularStructure } from './molecular-graph';
import type { MolecularAtom, MolecularForceField, MinimizerMethod, Vec3 } from './types';
import { MINIMIZER_METHODS, minimize, type MinimizerStop } from './minimizer';
import { measureGeometry } from '../../../../../scripts/molecular-geometry.js';

/** Every method minimizes the same physical energy here, holds the same constraints and records every step. */
export type OptimizationMethod = MinimizerMethod;
export const OPTIMIZATION_METHODS = MINIMIZER_METHODS;
/** `numericalAtoms` bounds the routes that difference the energy: coupled Z-matrix
 * coordinates, single-point forces, and MMFF when the analytic surface is unavailable. */
export const OPTIMIZATION_LIMITS = Object.freeze({ graphAtoms: 256, numericalAtoms: 64, constraints: 64, iterations: 1000 });
/** A 2D drawing: an explicit SDF/MOL graph with every z at zero. XYZ coordinates are always a geometry. */
export function flatDepiction(structure: Pick<MolecularStructure, 'atoms' | 'graphSource'>) {
  return structure.graphSource === 'explicit' && structure.atoms.every(atom => Math.abs(atom.z) <= 1e-6);
}
/** Conformers kept per search, and the largest embedding seed. */
export const CONFORMER_LIMITS = Object.freeze({ count: 32, seeds: 2_147_483_647 });

export type GeometryConstraint = { kind: 'freeze' | 'distance' | 'angle' | 'dihedral'; atoms: number[]; target?: number };
export type ConstraintResidual = { kind: Exclude<GeometryConstraint['kind'], 'freeze'>; atoms: number[]; target: number; value: number; error: number; unit: 'angstrom' | 'degrees' };
export type OptimizationFrame = { atoms: MolecularAtom[]; energy: number };
/** The latest accepted step while a minimization runs; energy is the physical energy in kcal/mol. */
export type OptimizationProgress = { iteration: number; energy: number };
export type OptimizationStop = MinimizerStop | 'no-variables';
export type OptimizeOptions = { method?: OptimizationMethod; forceField?: MolecularForceField; constraints?: GeometryConstraint[]; maxIterations?: number };
export type OptimizationResult = {
  molecule: MolecularStructure; initialEnergy: number; energy: number; unit: 'kcal/mol';
  forceField: MolecularForceField; method: OptimizationMethod;
  /** Accepted steps. */
  iterations: number; converged: boolean; stopReason: OptimizationStop;
  /** How the physical force-field gradient was obtained; restraint gradients are analytic. */
  gradient: 'analytic' | 'central-difference';
  /** Largest remaining gradient component of the optimized objective, kcal/(mol·Å). */
  maxGradient: number;
  /** The start, every accepted step and the result. */
  frameSampling: 'steps'; frames: OptimizationFrame[];
  constraintResiduals: ConstraintResidual[]; frozenAtoms: number[];
};
export type EnergyEvaluator = { energy: (atoms: MolecularAtom[]) => number; gradient?: (atoms: MolecularAtom[]) => Vec3[]; dispose: () => void };

const ATOMS = { freeze: 1, distance: 2, angle: 3, dihedral: 4 } as const;
const PENALTY = 10_000;
const DEG = Math.PI / 180;
// A bend or torsion is undefined when sin(angle) vanishes; below this the
// restraint direction is decided by roundoff, so the request is refused.
const LINEAR_SINE = 1e-3;
/** Constraint satisfaction accepted as converged. */
export const RESIDUAL_TOLERANCE = { angstrom: 0.01, degrees: 1 } as const;

type Restraint = { kind: ConstraintResidual['kind']; atoms: number[]; target: number };
type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scaled = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: V) => Math.sqrt(dot(a, a));
const point = (atoms: MolecularAtom[], i: number): V => [atoms[i].x, atoms[i].y, atoms[i].z];
const label = (atoms: MolecularAtom[], indices: number[]) => indices.map(i => `${atoms[i].element}${i + 1}`).join('–');
const wrap = (degrees: number) => ((degrees + 540) % 360) - 180;

function sine(atoms: MolecularAtom[], [a, b, c]: number[]) {
  const u = sub(point(atoms, a), point(atoms, b)), v = sub(point(atoms, c), point(atoms, b));
  return length(cross(u, v)) / (length(u) * length(v));
}

/** The documented default when no method is named: BFGS for an unconstrained MMFF
 * run, otherwise L-BFGS. Results always report the method used. */
export function defaultOptimizationMethod(forceField: MolecularForceField, constrained: boolean): OptimizationMethod {
  return forceField.startsWith('MMFF') && !constrained ? 'bfgs' : 'lbfgs';
}

/** Why an optimization of this size cannot run, or null. Every method and field share these bounds. */
export function optimizationUnavailable(atomCount: number, constraintCount: number): string | null {
  if (atomCount < 1 || atomCount > OPTIMIZATION_LIMITS.graphAtoms) return `Geometry optimization supports 1–${OPTIMIZATION_LIMITS.graphAtoms} atoms, including added hydrogens.`;
  if (constraintCount > OPTIMIZATION_LIMITS.constraints) return `Optimization supports at most ${OPTIMIZATION_LIMITS.constraints} constraints.`;
  return null;
}

/** Validates constraints against the input geometry before any work starts. Targets
 * default to the current values; undefined (collinear) bends and torsions are refused. */
export function resolveConstraints(atoms: MolecularAtom[], constraints: GeometryConstraint[]): { frozen: number[]; restraints: Restraint[] } {
  if (constraints.length > OPTIMIZATION_LIMITS.constraints) throw new Error(`Optimization supports at most ${OPTIMIZATION_LIMITS.constraints} constraints.`);
  const frozen = new Set<number>(), restraints: Restraint[] = [];
  for (const c of constraints) {
    const count = ATOMS[c.kind];
    if (!count || c.atoms.length !== count || new Set(c.atoms).size !== count || c.atoms.some(i => !Number.isInteger(i) || i < 0 || i >= atoms.length)) throw new Error('Constraint contains invalid atom indices.');
    if (c.kind === 'freeze') { frozen.add(c.atoms[0]); continue; }
    if (c.kind === 'angle' && sine(atoms, c.atoms) < LINEAR_SINE) throw new Error(`The ${label(atoms, c.atoms)} angle is linear; its bending direction is undefined, so it cannot be constrained.`);
    if (c.kind === 'dihedral') {
      for (const triple of [c.atoms.slice(0, 3), c.atoms.slice(1)]) {
        if (sine(atoms, triple) < LINEAR_SINE) throw new Error(`The ${label(atoms, c.atoms)} torsion is undefined because ${label(atoms, triple)} is collinear.`);
      }
    }
    const target = c.target ?? measureGeometry(c.kind, c.atoms.map(i => ({ id: String(i), position: point(atoms, i) }))).value as number;
    if (!Number.isFinite(target) || (c.kind === 'distance' && target <= 0) || (c.kind === 'angle' && (target <= 0 || target >= 180)) || (c.kind === 'dihedral' && Math.abs(target) > 180)) throw new Error('Constraint target is outside the valid range.');
    restraints.push({ kind: c.kind, atoms: [...c.atoms], target });
  }
  return { frozen: [...frozen].sort((a, b) => a - b), restraints };
}

/** Value (Å or radians) of one restraint and its analytic derivative per atom. */
function restraintGeometry(atoms: MolecularAtom[], { kind, atoms: indices }: Restraint): { value: number; derivative: V[] } {
  const p = indices.map(i => point(atoms, i));
  if (kind === 'distance') {
    const d = sub(p[0], p[1]), r = length(d);
    return { value: r, derivative: [scaled(d, 1 / r), scaled(d, -1 / r)] };
  }
  if (kind === 'angle') {
    const u = sub(p[0], p[1]), v = sub(p[2], p[1]), lu = length(u), lv = length(v);
    const cos = dot(u, v) / (lu * lv), sin = length(cross(u, v)) / (lu * lv), theta = Math.atan2(sin, cos);
    const a = scaled(sub(scaled(u, cos / lu), scaled(v, 1 / lv)), 1 / (lu * sin));
    const c = scaled(sub(scaled(v, cos / lv), scaled(u, 1 / lu)), 1 / (lv * sin));
    return { value: theta, derivative: [a, scaled([a[0] + c[0], a[1] + c[1], a[2] + c[2]], -1), c] };
  }
  // Blondel & Karplus, J. Comput. Chem. 17, 1132 (1996), with F = A−B, G = B−C, H = D−C.
  const f = sub(p[0], p[1]), g = sub(p[1], p[2]), h = sub(p[3], p[2]);
  const a = cross(f, g), b = cross(h, g), aa = dot(a, a), bb = dot(b, b), lg = length(g);
  const phi = Math.atan2(dot(cross(b, a), g) / lg, dot(a, b));
  const dA = scaled(a, -lg / aa), dD = scaled(b, lg / bb);
  const fg = dot(f, g) / (aa * lg), hg = dot(h, g) / (bb * lg);
  const dB = sub(scaled(a, lg / aa + fg), scaled(b, hg)), dC = sub(scaled(b, hg - lg / bb), scaled(a, fg));
  return { value: phi, derivative: [dA, dB, dC, dD] };
}

function restraintError(value: number, r: Restraint) {
  return r.kind === 'distance' ? value - r.target : wrap(value / DEG - r.target) * DEG;
}

/** Harmonic restraint energy 10⁴·Δ² kcal/mol (Δ in Å or radians) and its gradient. */
export function restraintPenalty(atoms: MolecularAtom[], restraints: readonly Restraint[]) {
  let energy = 0;
  const gradient: V[] = atoms.map(() => [0, 0, 0]);
  for (const r of restraints) {
    const { value, derivative } = restraintGeometry(atoms, r), delta = restraintError(value, r);
    energy += PENALTY * delta * delta;
    r.atoms.forEach((atom, k) => { for (let axis = 0; axis < 3; axis++) gradient[atom][axis] += 2 * PENALTY * delta * derivative[k][axis]; });
  }
  return { energy, gradient };
}

export function constraintResiduals(atoms: MolecularAtom[], restraints: readonly Restraint[]): ConstraintResidual[] {
  return restraints.map(r => {
    const value = measureGeometry(r.kind, r.atoms.map(i => ({ id: String(i), position: point(atoms, i) }))).value as number;
    const unit = r.kind === 'distance' ? 'angstrom' : 'degrees';
    return { kind: r.kind, atoms: [...r.atoms], target: r.target, value, error: r.kind === 'dihedral' ? wrap(value - r.target) : value - r.target, unit };
  });
}

/**
 * Cartesian minimization of force-field energy plus harmonic restraints. Frozen atoms
 * are not variables, so their coordinates are returned exactly. Central differences
 * (h = 1e-4 Å) stand in for a missing analytic force-field gradient, up to
 * OPTIMIZATION_LIMITS.numericalAtoms atoms.
 */
export function optimizeCartesian(molecule: MolecularStructure, evaluator: EnergyEvaluator, method: MinimizerMethod, forceField: MolecularForceField, options: Pick<OptimizeOptions, 'constraints' | 'maxIterations'>, onProgress?: (progress: OptimizationProgress) => void): Omit<OptimizationResult, 'molecule'> & { atoms: MolecularAtom[] } {
  const n = molecule.atoms.length, maxIterations = options.maxIterations ?? 250;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > OPTIMIZATION_LIMITS.iterations) throw new Error('Use 1–1000 optimization iterations.');
  const unavailable = optimizationUnavailable(n, options.constraints?.length ?? 0);
  if (unavailable) throw new Error(unavailable);
  if (!evaluator.gradient && n > OPTIMIZATION_LIMITS.numericalAtoms) throw new Error(`${forceField} has no analytic gradient for this structure (separate fragments interact, or the toolkits type it differently); numerical optimization supports up to ${OPTIMIZATION_LIMITS.numericalAtoms} atoms and it has ${n}.`);
  const { frozen, restraints } = resolveConstraints(molecule.atoms, options.constraints ?? []);
  const fixed = new Set(frozen), movable = molecule.atoms.flatMap((_, i) => fixed.has(i) ? [] : [i]);
  const unpack = (x: number[]) => {
    const atoms = molecule.atoms.map(a => ({ ...a }));
    movable.forEach((atom, i) => { atoms[atom].x = x[3 * i]; atoms[atom].y = x[3 * i + 1]; atoms[atom].z = x[3 * i + 2]; });
    return atoms;
  };
  const h = 1e-4, axes = ['x', 'y', 'z'] as const;
  const physicalGradient = (atoms: MolecularAtom[]): Vec3[] => evaluator.gradient?.(atoms) ?? atoms.map((atom, i) => fixed.has(i) ? [0, 0, 0] : axes.map(axis => {
    const original = atom[axis];
    atom[axis] = original + h; const plus = evaluator.energy(atoms);
    atom[axis] = original - h; const minus = evaluator.energy(atoms);
    atom[axis] = original;
    return (plus - minus) / (2 * h);
  }) as Vec3);
  const objective = (x: number[]) => {
    const atoms = unpack(x), energy = evaluator.energy(atoms);
    if (!Number.isFinite(energy)) return { energy, gradient: x.map(() => Number.NaN) };
    const physical = physicalGradient(atoms), penalty = restraintPenalty(atoms, restraints);
    return { energy: energy + penalty.energy, gradient: x.map((_, i) => physical[movable[Math.floor(i / 3)]][i % 3] + penalty.gradient[movable[Math.floor(i / 3)]][i % 3]) };
  };
  const initialEnergy = evaluator.energy(molecule.atoms);
  const frames: OptimizationFrame[] = [{ atoms: molecule.atoms.map(a => ({ ...a })), energy: initialEnergy }];
  const run = movable.length
    ? minimize(movable.flatMap(i => [molecule.atoms[i].x, molecule.atoms[i].y, molecule.atoms[i].z]), objective, method, maxIterations, (x, total) => {
      const atoms = unpack(x), energy = total - restraintPenalty(atoms, restraints).energy;
      frames.push({ atoms, energy });
      onProgress?.({ iteration: frames.length - 1, energy });
    })
    : null;
  const atoms = run ? unpack(run.x) : molecule.atoms.map(a => ({ ...a }));
  const energy = evaluator.energy(atoms);
  // The minimizer returns its lowest point, which may precede its last step.
  if (frames.at(-1)!.atoms.some((atom, i) => atom.x !== atoms[i].x || atom.y !== atoms[i].y || atom.z !== atoms[i].z)) frames.push({ atoms, energy });
  const residuals = constraintResiduals(atoms, restraints);
  const satisfied = residuals.every(r => Math.abs(r.error) <= RESIDUAL_TOLERANCE[r.unit]);
  return {
    atoms, initialEnergy, energy, unit: 'kcal/mol', forceField, method, iterations: run?.iterations ?? 0,
    converged: (run?.converged ?? true) && satisfied, stopReason: run?.stopReason ?? 'no-variables',
    gradient: evaluator.gradient ? 'analytic' : 'central-difference', maxGradient: run?.maxGradient ?? 0,
    frameSampling: 'steps', frames, constraintResiduals: residuals, frozenAtoms: frozen,
  };
}
