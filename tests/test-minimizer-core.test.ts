import { expect, test } from 'bun:test';
import { createAsyncMinimizer, createMinimizer, minimize, type MinimizerMethod } from '../apps/desktop/src/lib/molecular-workbench/minimizer';
import { cartesianProblem, optimizeCartesian, optimizeCartesianAsync } from '../apps/desktop/src/lib/molecular-workbench/optimization';
import { createLennardJonesEvaluator } from '../apps/desktop/src/lib/molecular-workbench/energy-models';
const methods: MinimizerMethod[] = ['lbfgs','fire','abc-fire','hybrid'];
for (const method of methods) test(`${method} converges a known objective`, () => {
  const initial = [3,-1,2];
  const objective = (x:number[]) => ({energy:x.reduce((s,v)=>s+(v-1)**2,0),gradient:x.map(v=>2*(v-1))});
  const result = minimize(initial,objective,method,1000);
  expect(result.converged).toBe(true);
  expect(result.energy).toBeLessThan(1e-6);
  expect(initial).toEqual([3,-1,2]);
  expect(result.energy).toBeCloseTo(objective(result.x).energy,12);
});
test('a stationary atom does not shrink the move of an independent moving atom',()=>{
 const one=(x:number[])=>({energy:x[0]**2,gradient:x.map((v,i)=>i===0?2*v:0)});
 const a=minimize([1,0,0],one,'fire',1),b=minimize([1,0,0,0,0,0],one,'fire',1);
 expect(a.x).toEqual(b.x.slice(0,3));
});
test('invalid numerical objectives and iteration limits refuse before publishing steps',()=>{
 for(const method of methods) {
  let steps=0;
  expect(()=>minimize([1,0,0],()=>({energy:NaN,gradient:[0,0,0]}),method,5,()=>{steps++;})).toThrow('Non-finite');
  expect(steps).toBe(0);
  expect(()=>minimize([1],()=>({energy:1,gradient:[1]}),method,Infinity)).toThrow('configuration');
 }
});
test('non-finite trial points are rejected, never integrated or published, and stop the run explicitly', () => {
  // A finite quadratic with an undefined band the descent path must cross.
  const banded = (x: number[]) => x[0] > 1.9 && x[0] < 2.1 ? { energy: NaN, gradient: [NaN, NaN, NaN] } : { energy: x.reduce((s, v) => s + v * v, 0), gradient: x.map(v => 2 * v) };
  for (const method of methods) {
    const seen: number[] = [];
    const result = minimize([3, 0, 0], banded, method, 1000, (_, energy) => { seen.push(energy); });
    expect(seen.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(result.energy)).toBe(true);
    if (result.x[0] > 2) expect([result.converged, result.stopReason]).toEqual([false, 'line-search']);
    else expect(result.x[0]).toBeLessThan(1.9);
  }
});

// A shifted, mildly anisotropic bowl: FIRE turns, L-BFGS builds curvature pairs.
const bowl = (offset = 0) => (x: number[]) => ({ energy: offset + x.reduce((s, v, i) => s + (i + 1) * (v - 1) ** 2, 0), gradient: x.map((v, i) => 2 * (i + 1) * (v - 1)) });

test('a run cut into chunks of any size takes exactly the steps of one long run', () => {
  for (const method of [...methods, 'bfgs'] as const) {
    const whole: number[][] = [];
    const reference = minimize([3, -1, 2, 0.5, 4, -2], bowl(), method, 300, x => { whole.push(x); });
    const chunked = createMinimizer([3, -1, 2, 0.5, 4, -2], bowl(), method), parts: number[][] = [];
    let taken = 0, reason = 'iterations';
    for (let chunk = 1; reason === 'iterations' && taken < 300; chunk = chunk % 7 + 1) {
      const before = parts.length;
      reason = chunked.run(Math.min(chunk, 300 - taken), x => { parts.push(x); });
      taken += parts.length - before;
    }
    expect(parts).toEqual(whole);
    expect(chunked.result()).toEqual(reference);
  }
});

test('quasi-Newton steps at the noise floor stop as stalled instead of spending the step limit', () => {
  // At E ≈ 1e6 a double resolves no energy change below ~1e-10, far above a zero gradient tolerance.
  for (const method of ['lbfgs', 'bfgs', 'hybrid'] as const) {
    const result = minimize([3, -1, 2], bowl(1e6), method, 1000, undefined, { gradientTolerance: 0 });
    expect([result.stopReason, result.converged]).toEqual(['stalled', false]);
    expect(result.iterations).toBeLessThan(200);
    expect(result.x.every(v => Math.abs(v - 1) < 1e-4)).toBe(true);
  }
});

test('the energy tolerance ends a run once the mean change over ten steps is below it', () => {
  // L-BFGS reaches the gradient tolerance first; FIRE creeps along the floor of the bowl.
  for (const method of ['fire', 'abc-fire'] as const) {
    const strict = minimize([3, -1, 2], bowl(), method, 1000, undefined, { gradientTolerance: 1e-9 });
    const loose = minimize([3, -1, 2], bowl(), method, 1000, undefined, { gradientTolerance: 1e-9, energyTolerance: 1e-6 });
    expect([loose.stopReason, loose.converged]).toEqual(['energy', true]);
    expect(loose.iterations).toBeGreaterThanOrEqual(10);
    expect(loose.iterations).toBeLessThan(strict.iterations);
    expect(loose.energy).toBeLessThan(1e-3);
  }
});

test('the asynchronous driver takes exactly the steps of the synchronous one, in chunks too', async () => {
  // Includes a non-finite band, so rejected trial points and restarts are compared as well.
  const banded = (x: number[]) => x[0] > 1.9 && x[0] < 2.1 ? { energy: NaN, gradient: x.map(() => NaN) } : bowl()(x);
  for (const method of [...methods, 'bfgs'] as const) for (const objective of [bowl(), banded]) {
    const syncPoints: number[][] = [], asyncPoints: number[][] = [], syncSteps: number[][] = [], asyncSteps: number[][] = [];
    const sync = createMinimizer([3, -1, 2, 0.5, 4, -2], x => { syncPoints.push(x); return objective(x); }, method);
    const reason = sync.run(400, x => { syncSteps.push(x); });
    const driven = await createAsyncMinimizer([3, -1, 2, 0.5, 4, -2], async x => { asyncPoints.push(x); await Promise.resolve(); return objective(x); }, method);
    let asyncReason = 'iterations';
    for (let chunk = 1, taken = 0; asyncReason === 'iterations' && taken < 400; chunk = chunk % 5 + 1) {
      const before = asyncSteps.length;
      asyncReason = await driven.run(Math.min(chunk, 400 - taken), x => { asyncSteps.push(x); });
      taken += asyncSteps.length - before;
    }
    expect(asyncPoints).toEqual(syncPoints);
    expect(asyncSteps).toEqual(syncSteps);
    expect(asyncReason).toBe(reason);
    expect(driven.result()).toEqual(sync.result());
  }
});

test('an asynchronous minimizer runs one chunk at a time and reports objective failures', async () => {
  const driven = await createAsyncMinimizer([3, -1, 2], async x => bowl()(x), 'lbfgs');
  const first = driven.run(5);
  await expect(driven.run(5)).rejects.toThrow('already running');
  await first;
  await expect(createAsyncMinimizer([1, 0, 0], async () => ({ energy: NaN, gradient: [0, 0, 0] }), 'fire')).rejects.toThrow('Non-finite');
  const failing = await createAsyncMinimizer([3, -1, 2], async x => { if (x[0] !== 3) throw new Error('model process exited'); return bowl()(x); }, 'fire');
  await expect(failing.run(10)).rejects.toThrow('model process exited');
});

test('asynchronous Cartesian optimization matches the worker path with frozen atoms and restraints', async () => {
  // An Ar5 cluster: Lennard-Jones needs no bond graph; one atom frozen, one distance held.
  const atoms = [[0, 0, 0], [3.9, 0.2, 0], [0.1, 3.6, 0.3], [3.4, 3.8, -0.4], [1.8, 1.7, 3.2]].map(([x, y, z]) => ({ element: 'Ar', x, y, z }));
  const molecule = { atoms, bonds: [], molfile: '', title: 'Ar5', graphSource: 'perceived' as const, graphComplete: false };
  const constraints = [{ kind: 'freeze' as const, atoms: [0] }, { kind: 'distance' as const, atoms: [1, 2], target: 4.2 }];
  for (const method of ['lbfgs', 'fire', 'hybrid'] as const) {
    const lj = createLennardJonesEvaluator(atoms.map(atom => atom.element)), progress: number[] = [], asyncProgress: number[] = [];
    let evaluations = 0;
    const reference = optimizeCartesian(molecule, lj, method, 'LJ', { constraints, maxIterations: 200 }, step => { progress.push(step.energy); });
    const result = await optimizeCartesianAsync(molecule, { async evaluate(input) { evaluations++; return { energy: lj.energy(input), gradient: lj.gradient!(input) }; }, dispose() {} },
      method, 'LJ', { constraints, maxIterations: 200 }, step => { asyncProgress.push(step.energy); });
    const { energy, frames, ...rest } = result, { energy: referenceEnergy, frames: referenceFrames, ...referenceRest } = reference;
    expect(rest).toEqual(referenceRest);
    expect(energy).toBeCloseTo(referenceEnergy, 9);
    expect(frames.map(frame => frame.atoms)).toEqual(referenceFrames.map(frame => frame.atoms));
    expect(asyncProgress).toEqual(progress);
    expect(result.atoms[0]).toEqual(atoms[0]);
    // The start is evaluated once and shared with the minimizer.
    expect(evaluations).toBeGreaterThan(result.iterations);
  }
  const controller = new AbortController();
  controller.abort();
  await expect(optimizeCartesianAsync(molecule, { evaluate: async () => { throw new Error('unreachable'); }, dispose() {} }, 'lbfgs', 'LJ', {}, undefined, controller.signal)).rejects.toThrow();
});

test('the shared Cartesian problem drops frozen atoms and adds restraint gradients', () => {
  const atoms = [[0, 0, 0], [1.5, 0, 0], [0, 1.4, 0]].map(([x, y, z]) => ({ element: 'C', x, y, z }));
  const problem = cartesianProblem({ atoms }, [{ kind: 'freeze', atoms: [2] }, { kind: 'distance', atoms: [0, 1], target: 1.4 }]);
  expect([problem.movable, problem.frozen, problem.initial]).toEqual([[0, 1], [2], [0, 0, 0, 1.5, 0, 0]]);
  const moved = problem.unpack([0, 0, 0, 1.6, 0, 0]);
  expect(moved[2]).toEqual(atoms[2]);
  const value = problem.objective({ energy: 1, gradient: [[1, 0, 0], [0, 1, 0], [9, 9, 9]] }, moved);
  // 10⁴·(0.2 Å)² = 400 kcal/mol, pulling the pair together along x.
  expect(value.energy).toBeCloseTo(401, 9);
  [1 - 4000, 0, 0, 4000, 1, 0].forEach((expected, i) => expect(value.gradient[i]).toBeCloseTo(expected, 6));
  expect(problem.physicalEnergy(value.energy, moved)).toBeCloseTo(1, 9);
  expect(problem.objective({ energy: NaN, gradient: [] }, moved).gradient).toHaveLength(6);
});
