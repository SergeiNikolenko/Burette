/** FIRE2/ABC-FIRE integration and the chunked driver follow Avogadro's
 * energyoptimizer.cpp and the GUI's energywindow.h, revision
 * cb0e94852889da9f7288bd1e58241e69990935a7 (BSD-3-Clause).
 * Copyright (c) 2011-2020, Kitware, Inc. See docs/third-party/avogadro-LICENSE.
 * BFGS keeps the dense inverse Hessian (Nocedal & Wright, eq. 6.17, with the
 * eq. 6.20 initial scaling); L-BFGS uses the standard two-loop recursion with eight
 * pairs. Both share bounded Armijo backtracking from a first step of at most 0.1 Å.
 * `hybrid` integrates ABC-FIRE until the largest gradient component falls below
 * 5 kJ/(mol·Å) (1.195 kcal/(mol·Å)), then continues with L-BFGS for good.
 *
 * A minimizer keeps every piece of state between `run` calls (FIRE velocity and
 * time step, the quasi-Newton history, stall counters and the energy window), so a
 * run cut into chunks of any size takes exactly the steps of one long run.
 *
 * The stepping logic is one generator that yields each point it needs evaluated and
 * receives the objective there. `createMinimizer` answers it synchronously and
 * `createAsyncMinimizer` awaits an external objective, so both take the same steps.
 */
import type { MinimizerMethod } from './types';
export type { MinimizerMethod } from './types';
export type Evaluation = { energy: number; gradient: number[] };
export type Objective = (x: number[]) => Evaluation;
export type AsyncObjective = (x: number[]) => Promise<Evaluation>;
/** `converged`: the largest gradient component fell below the gradient tolerance.
 * `energy`: the mean energy change per step over at least ten steps fell below the
 * energy tolerance. `line-search`: no finite downhill step remained (quasi-Newton
 * backtracking after one restart, or FIRE after its time step collapsed on non-finite
 * trial points). `stalled`: quasi-Newton steps reached the objective's noise floor. */
export type MinimizerStop = 'converged' | 'energy' | 'iterations' | 'line-search' | 'stalled';
/** Tolerances in the objective's units; the energy test is off unless given. */
export type MinimizerOptions = { gradientTolerance?: number; energyTolerance?: number };
export type MinimizerResult = { x: number[]; energy: number; converged: boolean; iterations: number; stopReason: MinimizerStop; maxGradient: number };
type StepListener = (x: number[], energy: number) => void;
export type Minimizer = {
  /** Takes up to `count` more steps. Returns why the run ended, or `iterations`
   * when it can continue. `onStep` sees every accepted point. */
  run(count: number, onStep?: StepListener): MinimizerStop;
  /** The lowest point reached, which may precede the last FIRE step. */
  result(): MinimizerResult;
};
/** A minimizer over an asynchronous objective. One `run` at a time. */
export type AsyncMinimizer = {
  run(count: number, onStep?: StepListener): Promise<MinimizerStop>;
  result(): MinimizerResult;
};
/** Yields the points to evaluate and receives the objective at each. */
type Steps<T> = Generator<number[], T, Evaluation>;

export const MINIMIZER_METHODS: readonly MinimizerMethod[] = ['bfgs', 'lbfgs', 'fire', 'abc-fire', 'hybrid'];
/** Largest number of variables: 256 atoms in Cartesian coordinates. */
export const MINIMIZER_VARIABLES = 768;
/** Largest gradient component, kcal/(mol·Å), accepted as stationary. */
export const GRADIENT_TOLERANCE = 1e-3;
const HYBRID_SWITCH = 5 / 4.184;
/** Steps the energy change is averaged over before it may end a run. */
const ENERGY_WINDOW = 10;
// A step moving no coordinate by more than this (Å), or lowering the energy by less
// than this fraction of max(|E|, 1), three times in a row is at the noise floor.
const STALL_MOVE = 1e-10, STALL_ENERGY = 1e-14, STALL_VIOLATIONS = 3;
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (a: number[]) => Math.sqrt(dot(a, a));
const largest = (a: number[]) => a.reduce((top, v) => Math.max(top, Math.abs(v)), 0);
const finite = (r: ReturnType<Objective>, length: number) => Number.isFinite(r.energy) && r.gradient.length === length && r.gradient.every(Number.isFinite);

function* minimizerSteps(initial: number[], method: MinimizerMethod, options: MinimizerOptions): Steps<{ run(count: number, onStep?: StepListener): Steps<MinimizerStop>; result(): MinimizerResult }> {
  const { gradientTolerance = GRADIENT_TOLERANCE, energyTolerance } = options;
  if (!MINIMIZER_METHODS.includes(method) || !initial.length || initial.length > MINIMIZER_VARIABLES || initial.some(x => !Number.isFinite(x))
    || !(gradientTolerance >= 0) || (energyTolerance !== undefined && !(energyTolerance >= 0))) throw new Error('Invalid minimizer configuration.');
  let x = initial.slice(), value = yield x.slice();
  if (!finite(value, x.length)) throw new Error('Non-finite optimization objective.');
  const n = x.length;
  let velocity = x.map(() => 0), dt = .05, alpha = .25, nPos = 0, quasiNewton = method === 'lbfgs' || method === 'bfgs';
  const history: { s: number[]; y: number[]; rho: number }[] = [];
  let inverse: Float64Array | undefined, moveViolations = 0, energyViolations = 0, restartSpent = false;
  let best = { x: x.slice(), ...value }, steps = 0, stop: MinimizerStop | undefined, anchor = { steps: 0, energy: value.energy };
  const clearHistory = () => { history.length = 0; inverse = undefined; moveViolations = energyViolations = 0; restartSpent = false; };
  /** Stale curvature pairs can point the search where it cannot progress: drop them
   * and restart from steepest descent once. False when the run must stop instead. */
  const restart = () => {
    const allowed = (history.length > 0 || inverse !== undefined) && !restartSpent;
    clearHistory(); restartSpent = allowed;
    return allowed;
  };

  /** 'step' after an accepted point, 'retry' when no point was accepted but the
   * method can continue, otherwise the reason the run ends. */
  function* quasiNewtonStep(): Steps<'step' | 'retry' | MinimizerStop> {
    let direction: number[];
    if (method === 'bfgs') {
      const h = inverse, g = value.gradient;
      direction = h ? Array.from({ length: n }, (_, i) => { let v = 0; for (let j = 0; j < n; j++) v -= h[i * n + j] * g[j]; return v; }) : g.map(v => -v);
    } else {
      const q = value.gradient.slice(), coefficients: number[] = [];
      for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i], a = h.rho * dot(h.s, q); coefficients[i] = a;
        q.forEach((_, j) => { q[j] -= a * h.y[j]; });
      }
      const last = history.at(-1), scale = last ? dot(last.s, last.y) / dot(last.y, last.y) : 1;
      direction = q.map(v => v * scale);
      history.forEach((h, i) => {
        const beta = h.rho * dot(h.y, direction);
        direction.forEach((_, j) => { direction[j] += h.s[j] * (coefficients[i] - beta); });
      });
      for (let i = 0; i < direction.length; i++) direction[i] *= -1;
    }
    if (dot(direction, value.gradient) >= 0) { history.length = 0; inverse = undefined; direction = value.gradient.map(g => -g); }
    let step = Math.min(1, .1 / largest(direction)), next: number[] | undefined, accepted: ReturnType<Objective> | undefined;
    for (let trial = 0; trial < 24; trial++, step *= .5) {
      const trialX = x.map((v, i) => v + step * direction[i]), trialValue = yield trialX.slice();
      if (finite(trialValue, x.length) && trialValue.energy <= value.energy + 1e-4 * step * dot(value.gradient, direction)) { next = trialX; accepted = trialValue; break; }
    }
    if (!next || !accepted) return restart() ? 'retry' : 'line-search';
    const s = next.map((v, i) => v - x[i]), y = accepted.gradient.map((v, i) => v - value.gradient[i]), sy = dot(s, y);
    moveViolations = largest(s) < STALL_MOVE ? moveViolations + 1 : 0;
    energyViolations = value.energy - accepted.energy < STALL_ENERGY * Math.max(Math.abs(value.energy), 1) ? energyViolations + 1 : 0;
    if (!moveViolations && !energyViolations) restartSpent = false;
    if (sy > 1e-12 && method === 'bfgs') {
      // H ← (I − ρsyᵀ)H(I − ρysᵀ) + ρssᵀ, expanded for a symmetric H.
      const rho = 1 / sy;
      if (!inverse) { inverse = new Float64Array(n * n); const gamma = sy / dot(y, y); for (let i = 0; i < n; i++) inverse[i * n + i] = gamma; }
      const h = inverse, hy = Array.from({ length: n }, (_, i) => { let v = 0; for (let j = 0; j < n; j++) v += h[i * n + j] * y[j]; return v; });
      const c = (rho * rho * dot(y, hy) + rho);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) h[i * n + j] += c * s[i] * s[j] - rho * (hy[i] * s[j] + s[i] * hy[j]);
    } else if (sy > 1e-12) { history.push({ s, y, rho: 1 / sy }); if (history.length > 8) history.shift(); }
    x = next; value = accepted;
    if (moveViolations < STALL_VIOLATIONS && energyViolations < STALL_VIOLATIONS) return 'step';
    return restart() ? 'step' : 'stalled';
  }

  function* fireStep(): Steps<'step' | 'retry' | 'line-search'> {
    // Convert gradients from kcal/mol/Å to Avogadro's kJ/mol/Å convention.
    let g = value.gradient.map(v => v * 4.184);
    const power = -dot(g, velocity);
    if (power > 0) { if (++nPos > 5) { dt = Math.min(dt * 1.1, .5); alpha *= .99; } }
    else if (power < 0) {
      nPos = 0; dt *= .5; alpha = .25;
      const back = x.map((v, i) => v - .5 * dt * velocity[i]), backValue = yield back.slice();
      velocity.fill(0);
      // Unlike the original driver, re-evaluate after backtracking so forces
      // always correspond to the actual coordinates being integrated.
      if (finite(backValue, x.length)) { x = back; value = backValue; g = value.gradient.map(v => v * 4.184); }
    }
    velocity = velocity.map((v, i) => v - dt * g[i]);
    const gnorm = norm(g), k = gnorm ? alpha * norm(velocity) / gnorm : 0;
    velocity = velocity.map((v, i) => (1 - alpha) * v - k * g[i]);
    if (method !== 'fire' && nPos > 0) {
      const denominator = 1 - (1 - alpha) ** nPos;
      if (denominator > 1e-12) velocity = velocity.map(v => v / denominator);
    }
    let scale = 1;
    // Coordinates may omit frozen atoms, but remain complete xyz triplets.
    for (let i = 0; i < velocity.length; i += 3) {
      const move = dt * Math.hypot(...velocity.slice(i, i + 3));
      if (move > .05) scale = Math.min(scale, .05 / move);
    }
    velocity = velocity.map(v => v * scale);
    const trialX = x.map((v, i) => v + dt * velocity[i]), trialValue = yield trialX.slice();
    if (!finite(trialValue, x.length)) {
      // A non-finite point is never integrated: shrink the step and restart from rest.
      dt *= .5; nPos = 0; alpha = .25; velocity.fill(0);
      return dt < 1e-6 ? 'line-search' : 'retry';
    }
    x = trialX; value = trialValue;
    return 'step';
  }

  return {
    *run(count, onStep) {
      if (!Number.isInteger(count) || count < 1) throw new Error('Invalid minimizer configuration.');
      if (stop) return stop;
      for (let taken = 0; taken < count;) {
        const maxGradient = largest(value.gradient);
        if (maxGradient < gradientTolerance) return stop = 'converged';
        if (method === 'hybrid' && maxGradient < HYBRID_SWITCH) quasiNewton = true;
        const outcome = quasiNewton ? yield* quasiNewtonStep() : yield* fireStep();
        if (outcome === 'retry') continue;
        if (outcome === 'line-search') return stop = outcome;
        taken++; steps++;
        if (value.energy < best.energy) best = { x: x.slice(), ...value };
        onStep?.(x.slice(), value.energy);
        if (outcome === 'stalled') return stop = outcome;
        // The mean change over a window, so one small step cannot end the run.
        if (energyTolerance !== undefined && steps >= anchor.steps + ENERGY_WINDOW) {
          const settled = Math.abs(value.energy - anchor.energy) / (steps - anchor.steps) < energyTolerance;
          anchor = { steps, energy: value.energy };
          if (settled) return stop = 'energy';
        }
      }
      return 'iterations';
    },
    result() {
      const final = best.energy < value.energy ? best : { x, ...value }, maxGradient = largest(final.gradient);
      const stationary = maxGradient < gradientTolerance;
      return { x: final.x.slice(), energy: final.energy, converged: stationary || stop === 'energy', iterations: steps, stopReason: stationary ? 'converged' : stop ?? 'iterations', maxGradient };
    },
  };
}

function drive<T>(steps: Steps<T>, evaluate: Objective): T {
  let request = steps.next();
  while (!request.done) request = steps.next(evaluate(request.value));
  return request.value;
}

async function driveAsync<T>(steps: Steps<T>, evaluate: AsyncObjective): Promise<T> {
  let request = steps.next();
  while (!request.done) request = steps.next(await evaluate(request.value));
  return request.value;
}

/** A trial point with a non-finite objective is rejected like an uphill one; only
 * the starting point must be finite. */
export function createMinimizer(initial: number[], evaluate: Objective, method: MinimizerMethod, options: MinimizerOptions = {}): Minimizer {
  const core = drive(minimizerSteps(initial, method, options), evaluate);
  return { run: (count, onStep) => drive(core.run(count, onStep), evaluate), result: core.result };
}

/** `createMinimizer` over an objective that answers asynchronously, such as an
 * external program. It takes exactly the steps of the synchronous minimizer. */
export async function createAsyncMinimizer(initial: number[], evaluate: AsyncObjective, method: MinimizerMethod, options: MinimizerOptions = {}): Promise<AsyncMinimizer> {
  const core = await driveAsync(minimizerSteps(initial, method, options), evaluate);
  let running = false;
  return {
    async run(count, onStep) {
      if (running) throw new Error('This minimizer is already running.');
      running = true;
      try { return await driveAsync(core.run(count, onStep), evaluate); } finally { running = false; }
    },
    result: core.result,
  };
}

export function minimize(initial: number[], evaluate: Objective, method: MinimizerMethod, iterations: number,
  onStep?: (x: number[], energy: number) => void, options?: MinimizerOptions): MinimizerResult {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) throw new Error('Invalid minimizer configuration.');
  const minimizer = createMinimizer(initial, evaluate, method, options);
  minimizer.run(iterations, onStep);
  return minimizer.result();
}
