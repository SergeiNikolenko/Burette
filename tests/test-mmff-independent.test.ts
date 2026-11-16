import {expect,test} from 'bun:test';
import {Molecule} from 'openchemlib';
import {snapshotMolecule} from '../apps/desktop/src/lib/molecular-workbench/molecular-graph';
import {runChemistryTask} from '../apps/desktop/src/lib/molecular-workbench/compute-client';
test('independent inactive linear fragment must not misdiagnose a disconnected non-torsion singularity',async()=>{
 const m=new Molecule(7,5);
 const points=[[-.6,0,0],[.6,0,0],[-1.66,0,0],[1.66,0,0],[10,0,0],[10,0,0],[10,.95,0]];
 [6,6,1,1,8,1,1].forEach((z,i)=>{m.addAtom(z);m.setAtomX(i,points[i][0]);m.setAtomY(i,points[i][1]);m.setAtomZ(i,points[i][2]);});
 const triple=m.addBond(0,1);m.setBondType(triple,Molecule.cBondTypeTriple);m.addBond(0,2);m.addBond(1,3);m.addBond(4,5);m.addBond(4,6);
 const molecule=snapshotMolecule(m),before=structuredClone(molecule);let message='';
 try { await runChemistryTask({action:'energy',molecule,forceField:'MMFF94'}); } catch(error) { message=String(error); }
 expect(message).toMatch(/MMFF94.*(?:cannot evaluate|energy is not finite)/);
 expect(message).not.toContain('torsion');expect(message).not.toContain('MOL atoms');expect(molecule).toEqual(before);
});
