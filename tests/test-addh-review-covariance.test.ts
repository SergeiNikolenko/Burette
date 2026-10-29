import {expect,test} from 'bun:test';
import {Molecule} from 'openchemlib';
import {snapshotMolecule} from '../apps/desktop/src/lib/molecular-workbench/molecular-graph';
import {runChemistryTask} from '../apps/desktop/src/lib/molecular-workbench/compute-client';
test('independent: plausible H length cannot excuse a direction along an existing C-C bond',async()=>{
 const mol=Molecule.fromSmiles('CCO');
 [[-.3,0,0],[1.1,0,0],[2.5,.001,0]].forEach((p,i)=>{mol.setAtomX(i,p[0]);mol.setAtomY(i,p[1]);mol.setAtomZ(i,p[2]);});
 const before=snapshotMolecule(mol),original=structuredClone(before); let after;
 try { after=await runChemistryTask({action:'add-hydrogens',molecule:before}); } catch(error) { expect(String(error)).toMatch(/hydrogen|geometry|direction/i); expect(before).toEqual(original); return; }
 expect(after.atoms.slice(0,3)).toEqual(before.atoms);
 for(const bond of after.bonds.filter(b=>(b.a===1&&b.b>=3)||(b.b===1&&b.a>=3))){
  const h=after.atoms[bond.a===1?bond.b:bond.a],c=after.atoms[1],length=Math.hypot(h.x-c.x,h.y-c.y,h.z-c.z);
  console.log('H location/distance/axis cos',h,length,Math.abs((h.x-c.x)/length));
  expect(Math.abs((h.x-c.x)/length)).toBeLessThan(.1);
 }
});
