import { expect, test } from 'bun:test';
import type { MinimizerMethod } from '../apps/desktop/src/lib/molecular-workbench/minimizer';
import { getEnergy, optimize, parseMolecule } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
const methods: MinimizerMethod[] = ['lbfgs','fire','abc-fire','hybrid'];
for(const method of methods) test(`${method} lowers actual water energy with a frozen atom`,()=>{
  const molecule=parseMolecule('3\nwater\nH .95 0 0\nO 0 0 0\nH -.23 .93 0','xyz');
  const result=optimize(molecule,{method,maxIterations:150,constraints:[{kind:'freeze',atoms:[0]}]});
  expect(result.molecule.atoms[0]).toEqual(molecule.atoms[0]);
  expect(result.energy).toBeLessThan(result.initialEnergy);
  expect(result.energy).toBeCloseTo(getEnergy(result.molecule),10);
  expect(result.frames!.length).toBeGreaterThan(2);
});
test('frozen systems validate limits and keep serialized optimized coordinates',()=>{
 const molecule=parseMolecule('3\nwater\nH .95 0 0\nO 0 0 0\nH -.23 .93 0','xyz');
 expect(()=>optimize(molecule,{method:'fire',maxIterations:Infinity,constraints:[0,1,2].map(i=>({kind:'freeze',atoms:[i]}))})).toThrow();
 const result=optimize(molecule,{method:'hybrid',maxIterations:100});
 const reloaded=parseMolecule(result.molecule.molfile,'mol');
 expect(getEnergy(reloaded)).toBeCloseTo(result.energy,3);
});
