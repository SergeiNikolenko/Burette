import { expect, test } from 'bun:test';
import { createMinimizer, minimize, type MinimizerMethod } from '../apps/desktop/src/lib/molecular-workbench/minimizer';
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
