import { expect, test } from 'bun:test';
import { getEnergy, parseMolecule } from '../apps/desktop/src/lib/molecular-workbench/chemistry';
import { evaluateEnergyForces, evaluateFrameBatch } from '../apps/desktop/src/lib/molecular-workbench/energy-forces';
const water = () => parseMolecule('3\nwater\nH .95 0 0\nO 0 0 0\nH -.23 .93 0','xyz');

test('forces are the negative derivative in external atom order and conserve translation', () => {
  const m = water(), saved = JSON.stringify(m), result = evaluateEnergyForces(m);
  const shifted = { ...m, atoms: m.atoms.map(a => ({...a, x:a.x+10, y:a.y-3, z:a.z+2})) };
  expect(evaluateEnergyForces(shifted).energy).toBeCloseTo(result.energy, 10);
  for(let axis=0;axis<3;axis++) expect(Math.abs(result.forces.reduce((sum,f)=>sum+f[axis],0))).toBeLessThan(.002);
  const h=2e-5, plus={...m,atoms:m.atoms.map((a,i)=>({...a,x:a.x+(i===0?h:0)}))}, minus={...m,atoms:m.atoms.map((a,i)=>({...a,x:a.x-(i===0?h:0)}))};
  expect(result.forces[0][0]).toBeCloseTo(-(getEnergy(plus)-getEnergy(minus))/(2*h),3);
  expect(JSON.stringify(m)).toBe(saved);
});
test('batch produces per-frame energies and forces and rejects identity changes',()=>{
  const m=water(), second=m.atoms.map((a,i)=>({...a,x:a.x+(i===0?.1:0)}));
  const result=evaluateFrameBatch(m,[m.atoms,second]);
  expect(result).toHaveLength(2);
  expect(result[1].energy).toBeCloseTo(getEnergy({...m,atoms:second}),10);
  expect(result[0].energy).not.toBe(result[1].energy);
  expect(()=>evaluateFrameBatch(m,[second.map(a=>({...a,element:'C'}))])).toThrow('identities');
  expect(()=>evaluateFrameBatch(m,[])).toThrow();
});
