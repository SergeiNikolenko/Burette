import {expect,test} from 'bun:test';
import {Molecule} from 'openchemlib';
import {snapshotMolecule} from '../apps/desktop/src/lib/molecular-workbench/molecular-graph';
import {runChemistryTask} from '../apps/desktop/src/lib/molecular-workbench/compute-client';
test('independent: almost opposed carbon bonds must not publish a compressed C-H bond',async()=>{
 const mol=Molecule.fromSmiles('CCO');
 [[-1.4,0,0],[0,0,0],[1.4,.001,0]].forEach((p,i)=>{mol.setAtomX(i,p[0]+.1234567890123);mol.setAtomY(i,p[1]-.234567890123);mol.setAtomZ(i,p[2]+.345678901234);});
 const before=snapshotMolecule(mol);
 const original=structuredClone(before); let after;
 try { after=await runChemistryTask({action:'add-hydrogens',molecule:before}); } catch(error) { expect(String(error)).toMatch(/hydrogen|geometry|direction/i); expect(before).toEqual(original); return; }
 expect(after.atoms.slice(0,3)).toEqual(before.atoms);
 for(const bond of after.bonds.filter(b=>(b.a===1&&b.b>=3)||(b.b===1&&b.a>=3))){
  const h=after.atoms[bond.a===1?bond.b:bond.a],c=after.atoms[1];
  const distance=Math.hypot(h.x-c.x,h.y-c.y,h.z-c.z);
  console.log('central C-H angstrom',distance);expect(distance).toBeGreaterThan(.5);
 }
});
