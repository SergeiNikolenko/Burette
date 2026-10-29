import { expect, test } from 'bun:test';
import { runChemistryTask } from '../apps/desktop/src/lib/molecular-workbench/compute-client';
import { parseZmatrixDocument, atomsFromZmatrixDocument } from '../scripts/zmatrix-document.mjs';
import { serializeXyz } from '../apps/desktop/src/lib/molecular-workbench/xyz';

test('real worker retains AddH, all force fields and optimizer methods, charges and force batches', async()=>{
 const source = await runChemistryTask({action:'generate',smiles:'O'});
 const heavy = await runChemistryTask({action:'remove-hydrogens',molecule:source});
 const molecule = await runChemistryTask({action:'add-hydrogens',molecule:heavy});
 expect(molecule.atoms).toHaveLength(3);
 for(const forceField of ['MMFF94','MMFF94s','UFF'] as const) {
  const energy = await runChemistryTask({action:'energy',molecule,forceField});
  expect(Number.isFinite(energy)).toBe(true);
  for(const method of ['lbfgs','fire','abc-fire','hybrid'] as const) {
   const result = await runChemistryTask({action:'optimize',molecule,options:{forceField,method,maxIterations:5,constraints:[{kind:'freeze',atoms:[0]}]}});
   expect(result.molecule.atoms[0]).toEqual(molecule.atoms[0]);
   expect(result.forceField).toBe(forceField);
   expect(Number.isFinite(result.energy)).toBe(true);
  }
  const forces = await runChemistryTask({action:'energy-forces',molecule,forceField});
  expect(forces.energy).toBeCloseTo(energy,8);
  const batch = await runChemistryTask({action:'frame-forces',molecule,frames:[molecule.atoms],forceField});
  expect(batch).toEqual([forces]);
 }
 expect((await runChemistryTask({action:'charges',molecule})).charges).toHaveLength(3);
});

test('actual coupled Z-matrix worker branch preserves frozen source position',async()=>{
 const definition=parseZmatrixDocument('O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 1.15\nA = 50\n');
 const atoms=atomsFromZmatrixDocument(definition).map(({element,position:[x,y,z]})=>({element,x:4-z,y:-2+x,z:8-y}));
 const molecule=await runChemistryTask({action:'parse',format:'xyz',source:serializeXyz(atoms)});
 const result=await runChemistryTask({action:'optimize-zmatrix',molecule,definition,options:{method:'lbfgs',maxIterations:200,frozenRows:[2]}});
 expect(result.converged).toBe(true);
 expect(result.energy).toBeLessThan(result.initialEnergy-20);
 expect(result.molecule.atoms[1]).toEqual(molecule.atoms[1]);
 expect(result.definition.rows).toEqual(definition.rows);
});
