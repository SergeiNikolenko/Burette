import { expect, test } from 'bun:test';
import { minimize, type MinimizerMethod } from '../apps/desktop/src/lib/molecular-workbench/minimizer';
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
