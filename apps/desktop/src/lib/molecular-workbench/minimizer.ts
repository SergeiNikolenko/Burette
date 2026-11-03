/** FIRE2/ABC-FIRE integration adapted from Avogadro's energyoptimizer.cpp,
 * revision f5aea255b15d24f658a18d258e56357fa2719646 (BSD-3-Clause).
 * Copyright (c) 2011-2020, Kitware, Inc. See docs/third-party/avogadro-LICENSE.
 * BFGS keeps the dense inverse Hessian (Nocedal & Wright, eq. 6.17, with the
 * eq. 6.20 initial scaling); L-BFGS uses the standard two-loop recursion with eight
 * pairs. Both share bounded Armijo backtracking from a first step of at most 0.1 Å.
 * `hybrid` integrates FIRE until the largest gradient component falls below
 * 5 kJ/(mol·Å) (1.195 kcal/(mol·Å)), then continues with L-BFGS.
 */
import type { MinimizerMethod } from './types';
export type { MinimizerMethod } from './types';
export type Objective = (x: number[]) => { energy: number; gradient: number[] };
/** `line-search`: no finite downhill step remained (L-BFGS backtracking, or FIRE
 * after its time step collapsed on non-finite trial points). */
export type MinimizerStop = 'converged' | 'iterations' | 'line-search';
export type MinimizerResult = { x: number[]; energy: number; converged: boolean; iterations: number; stopReason: MinimizerStop; maxGradient: number };

export const MINIMIZER_METHODS: readonly MinimizerMethod[] = ['bfgs', 'lbfgs', 'fire', 'abc-fire', 'hybrid'];
/** Largest number of variables: 256 atoms in Cartesian coordinates. */
export const MINIMIZER_VARIABLES = 768;
/** Largest gradient component, kcal/(mol·Å), accepted as stationary. */
export const GRADIENT_TOLERANCE = 1e-3;
const HYBRID_SWITCH = 5 / 4.184;
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (a: number[]) => Math.sqrt(dot(a, a));
const largest = (a: number[]) => a.reduce((top, v) => Math.max(top, Math.abs(v)), 0);
const finite = (r: ReturnType<Objective>, length: number) => Number.isFinite(r.energy) && r.gradient.length === length && r.gradient.every(Number.isFinite);

/** A trial point with a non-finite objective is rejected like an uphill one; only
 * the starting point must be finite. `onStep` sees every accepted point. */
export function minimize(initial: number[], evaluate: Objective, method: MinimizerMethod, iterations: number,
  onStep?: (x: number[], energy: number) => void): MinimizerResult {
  if (!MINIMIZER_METHODS.includes(method) || !Number.isInteger(iterations) || iterations < 1 || iterations > 1000 || !initial.length || initial.length > MINIMIZER_VARIABLES || initial.some(x => !Number.isFinite(x))) throw new Error('Invalid minimizer configuration.');
  let x = initial.slice(), value = evaluate(x);
  if (!finite(value, x.length)) throw new Error('Non-finite optimization objective.');
  let velocity = x.map(() => 0), dt = .05, alpha = .25, nPos = 0, lbfgs = method === 'lbfgs' || method === 'bfgs', stopReason: MinimizerStop = 'iterations';
  let best = { x: x.slice(), ...value }, steps = 0;
  const history: { s: number[]; y: number[]; rho: number }[] = [];
  const n = x.length;
  let inverse: Float64Array | undefined;
  for (; steps < iterations; steps++) {
    const maxGradient = largest(value.gradient);
    if (maxGradient < GRADIENT_TOLERANCE) { stopReason = 'converged'; break; }
    if (method === 'hybrid' && maxGradient < HYBRID_SWITCH) lbfgs = true;
    if (lbfgs) {
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
        const trialX = x.map((v, i) => v + step * direction[i]), trialValue = evaluate(trialX);
        if (finite(trialValue, x.length) && trialValue.energy <= value.energy + 1e-4 * step * dot(value.gradient, direction)) { next = trialX; accepted = trialValue; break; }
      }
      if (!next || !accepted) { stopReason = 'line-search'; break; }
      const s = next.map((v, i) => v - x[i]), y = accepted.gradient.map((v, i) => v - value.gradient[i]), sy = dot(s, y);
      if (sy > 1e-12 && method === 'bfgs') {
        // H ← (I − ρsyᵀ)H(I − ρysᵀ) + ρssᵀ, expanded for a symmetric H.
        const rho = 1 / sy;
        if (!inverse) { inverse = new Float64Array(n * n); const gamma = sy / dot(y, y); for (let i = 0; i < n; i++) inverse[i * n + i] = gamma; }
        const h = inverse, hy = Array.from({ length: n }, (_, i) => { let v = 0; for (let j = 0; j < n; j++) v += h[i * n + j] * y[j]; return v; });
        const c = (rho * rho * dot(y, hy) + rho);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) h[i * n + j] += c * s[i] * s[j] - rho * (hy[i] * s[j] + s[i] * hy[j]);
      } else if (sy > 1e-12) { history.push({ s, y, rho: 1 / sy }); if (history.length > 8) history.shift(); }
      x = next; value = accepted;
    } else {
      // Convert gradients from kcal/mol/Å to Avogadro's kJ/mol/Å convention.
      let g = value.gradient.map(v => v * 4.184);
      const power = -dot(g, velocity);
      if (power > 0) { if (++nPos > 5) { dt = Math.min(dt * 1.1, .5); alpha *= .99; } }
      else if (power < 0) {
        nPos = 0; dt *= .5; alpha = .25;
        const back = x.map((v, i) => v - .5 * dt * velocity[i]), backValue = evaluate(back);
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
      const trialX = x.map((v, i) => v + dt * velocity[i]), trialValue = evaluate(trialX);
      if (!finite(trialValue, x.length)) {
        // A non-finite point is never integrated: shrink the step and restart from rest.
        dt *= .5; nPos = 0; alpha = .25; velocity.fill(0);
        if (dt < 1e-6) { stopReason = 'line-search'; break; }
        continue;
      }
      x = trialX; value = trialValue;
    }
    if (value.energy < best.energy) best = { x: x.slice(), ...value };
    onStep?.(x.slice(), value.energy);
  }
  if (best.energy < value.energy) { x = best.x; value = best; }
  const maxGradient = largest(value.gradient);
  return { x, energy: value.energy, converged: maxGradient < GRADIENT_TOLERANCE, iterations: steps, stopReason: maxGradient < GRADIENT_TOLERANCE ? 'converged' : stopReason, maxGradient };
}
