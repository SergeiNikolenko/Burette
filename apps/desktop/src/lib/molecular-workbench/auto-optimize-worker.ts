/** Avogadro's Auto Optimize (qtplugins/autoopt, avogadrolibs cb0e94852889da9f7288bd1e58241e69990935a7):
 * the structure relaxes continuously in chunks sized to about one 30 fps frame of work
 * (calc/energyoptimizer.cpp adaptChunkIterations), keeping the minimizer state between
 * chunks. Atoms being dragged hold the positions they are given; each move restarts the
 * minimizer from the new geometry, as Avogadro restarts its worker on every edit. */
import { createOptimizationEvaluator, type MolecularStructure } from './chemistry';
import { createMinimizer, type Minimizer } from './minimizer';
import { OPTIMIZATION_LIMITS, resolveConstraints, restraintPenalty, type EnergyEvaluator, type GeometryConstraint } from './optimization';
import { prepareUffWasm } from './uff-wasm';
import type { MinimizerMethod, MolecularAtom, MolecularForceField, Vec3 } from './types';

export type AutoOptimizeRequest =
  | { type: 'start'; molecule: MolecularStructure; forceField: MolecularForceField; method: MinimizerMethod; constraints: GeometryConstraint[]; gradientTolerance?: number }
  | { type: 'move'; atoms: number[]; positions: Vec3[] }
  | { type: 'release' };
/** `settled`: the minimizer stopped (converged or stalled) and waits for the next move. */
export type AutoOptimizeFrame = { atoms: MolecularAtom[]; energy: number; initialEnergy: number; iterations: number; settled: boolean };
export type AutoOptimizeMessage = { frame: AutoOptimizeFrame } | { error: string };

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<AutoOptimizeRequest>) => void; postMessage: (message: AutoOptimizeMessage) => void };
const TARGET_MS = 33, SMOOTHING = 0.7, MIN_CHUNK = 1, MAX_CHUNK = 200;

/** Multiplicative moving average of the chunk size toward the frame budget. */
function adaptChunkIterations(current: number, measuredMs: number) {
  const clamped = Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, current));
  if (!(measuredMs > 0)) return clamped;
  return Math.round(Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, current * (TARGET_MS / measuredMs) ** SMOOTHING)));
}

type Session = {
  atoms: MolecularAtom[]; evaluator: EnergyEvaluator; method: MinimizerMethod; gradientTolerance?: number;
  frozen: ReadonlySet<number>; restraints: ReturnType<typeof resolveConstraints>['restraints']; held: Set<number>;
  movable: number[]; minimizer: Minimizer | null; initialEnergy: number; iterations: number; counted: number; chunk: number; scheduled: boolean;
};
let session: Session | null = null;

function physicalGradient(s: Session, atoms: MolecularAtom[]): Vec3[] {
  if (s.evaluator.gradient) return s.evaluator.gradient(atoms);
  const h = 1e-4, axes = ['x', 'y', 'z'] as const;
  return atoms.map((atom, i) => !s.movable.includes(i) ? [0, 0, 0] : axes.map(axis => {
    const original = atom[axis];
    atom[axis] = original + h; const plus = s.evaluator.energy(atoms);
    atom[axis] = original - h; const minus = s.evaluator.energy(atoms);
    atom[axis] = original;
    return (plus - minus) / (2 * h);
  }) as Vec3);
}

function unpack(s: Session, x: number[]) {
  const atoms = s.atoms.map(atom => ({ ...atom }));
  s.movable.forEach((atom, i) => { atoms[atom].x = x[3 * i]; atoms[atom].y = x[3 * i + 1]; atoms[atom].z = x[3 * i + 2]; });
  return atoms;
}

function restart(s: Session) {
  s.movable = s.atoms.flatMap((_, i) => s.frozen.has(i) || s.held.has(i) ? [] : [i]);
  s.counted = 0;
  s.minimizer = s.movable.length ? createMinimizer(s.movable.flatMap(i => [s.atoms[i].x, s.atoms[i].y, s.atoms[i].z]), x => {
    const atoms = unpack(s, x), energy = s.evaluator.energy(atoms);
    if (!Number.isFinite(energy)) return { energy, gradient: x.map(() => Number.NaN) };
    const physical = physicalGradient(s, atoms), penalty = restraintPenalty(atoms, s.restraints);
    return { energy: energy + penalty.energy, gradient: x.map((_, i) => physical[s.movable[Math.floor(i / 3)]][i % 3] + penalty.gradient[s.movable[Math.floor(i / 3)]][i % 3]) };
  }, s.method, { gradientTolerance: s.gradientTolerance }) : null;
  schedule(s);
}

function schedule(s: Session) {
  if (s.scheduled || !s.minimizer) return;
  s.scheduled = true;
  // A macrotask between chunks lets drag messages in.
  setTimeout(() => { s.scheduled = false; if (session === s) tick(s); }, 0);
}

function tick(s: Session) {
  const minimizer = s.minimizer;
  if (!minimizer) return;
  const started = performance.now(), stop = minimizer.run(s.chunk);
  s.chunk = adaptChunkIterations(s.chunk, performance.now() - started);
  const result = minimizer.result();
  s.iterations += result.iterations - s.counted; s.counted = result.iterations;
  s.atoms = unpack(s, result.x);
  const settled = stop !== 'iterations';
  if (settled) s.minimizer = null;
  scope.postMessage({ frame: { atoms: s.atoms, energy: s.evaluator.energy(s.atoms), initialEnergy: s.initialEnergy, iterations: s.iterations, settled } });
  if (!settled) schedule(s);
}

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === 'start') {
      await prepareUffWasm();
      const { molecule } = data;
      if (molecule.atoms.length > OPTIMIZATION_LIMITS.graphAtoms) throw new Error(`Auto Optimize supports up to ${OPTIMIZATION_LIMITS.graphAtoms} atoms.`);
      const evaluator = createOptimizationEvaluator(molecule, data.forceField);
      if (!evaluator.gradient && molecule.atoms.length > OPTIMIZATION_LIMITS.numericalAtoms) {
        evaluator.dispose();
        throw new Error(`${data.forceField} has no analytic gradient for this structure; Auto Optimize supports up to ${OPTIMIZATION_LIMITS.numericalAtoms} atoms then.`);
      }
      const { frozen, restraints } = resolveConstraints(molecule.atoms, data.constraints);
      session?.evaluator.dispose();
      session = { atoms: molecule.atoms.map(atom => ({ ...atom })), evaluator, method: data.method, gradientTolerance: data.gradientTolerance, frozen: new Set(frozen), restraints,
        held: new Set(), movable: [], minimizer: null, initialEnergy: evaluator.energy(molecule.atoms), iterations: 0, counted: 0, chunk: 5, scheduled: false };
      restart(session);
      return;
    }
    const s = session;
    if (!s) return;
    if (data.type === 'move') {
      if (data.atoms.length !== data.positions.length || data.atoms.some(i => !Number.isInteger(i) || i < 0 || i >= s.atoms.length)
        || data.positions.some(p => p.length !== 3 || !p.every(Number.isFinite))) throw new Error('Moved atoms must exist and have finite positions.');
      data.atoms.forEach((atom, k) => { [s.atoms[atom].x, s.atoms[atom].y, s.atoms[atom].z] = data.positions[k]; });
      s.held = new Set(data.atoms);
    } else s.held = new Set();
    restart(s);
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
