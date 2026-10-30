import { expect, test } from 'bun:test';
import { generateQuantumInput, type InputConstraint, type QuantumEngine } from '../apps/desktop/src/lib/molecular-workbench/input-export';
import type { MolecularAtom } from '../apps/desktop/src/lib/molecular-workbench/types';
const atoms: MolecularAtom[] = [{element:'C',x:1,y:2,z:3},{element:'H',x:2,y:2,z:3},{element:'H',x:1,y:3,z:3},{element:'O',x:1,y:2,z:4}];
const constraints: InputConstraint[] = [{kind:'freeze',atoms:[2]},{kind:'distance',atoms:[3,0]},{kind:'angle',atoms:[1,0,3]},{kind:'dihedral',atoms:[2,0,3,1]}];
const basis = { charge:0, multiplicity:1, method:'B3LYP', basis:'def2-SVP', task:'optimize' as const, constraints };
test('independent: full constraint arities use primary-manual atom numbering without reordering coordinates', () => {
 const orca=generateQuantumInput(atoms,{...basis,engine:'orca'}).text;
 expect(orca.split('\n').filter(line=>line.trim().startsWith('{')).map(line=>line.trim())).toEqual(['{ C 2 C }','{ B 3 0 C }','{ A 1 0 3 C }','{ D 2 0 3 1 C }']);
 const gaussian=generateQuantumInput(atoms,{...basis,engine:'gaussian'}).text;
 expect(gaussian.trim().split('\n\n').at(-1)).toBe('X 3 F\nB 4 1 F\nA 2 1 4 F\nD 3 1 4 2 F');
 const psi=generateQuantumInput(atoms,{...basis,engine:'psi4'}).text;
 expect(psi.match(/set optking \{([\s\S]*?)\}/u)![1].trim().split('\n').map(line=>line.trim())).toEqual(['frozen_cartesian = "3 xyz"','frozen_distance = "4 1"','frozen_bend = "2 1 4"','frozen_dihedral = "3 1 4 2"']);
 const xyz='C 1.00000000 2.00000000 3.00000000\nH 2.00000000 2.00000000 3.00000000\nH 1.00000000 3.00000000 3.00000000\nO 1.00000000 2.00000000 4.00000000';
 for(const output of [orca,gaussian,psi]) expect(output).toContain(xyz);
 const cp=generateQuantumInput(atoms,{...basis,engine:'cp2k',method:'PBE',basis:'DZVP-MOLOPT-SR-GTH',constraints:[constraints[0]],cell:[[10,0,0],[3,11,0],[1,2,12]]}).text;
 expect(cp).toContain('LIST 3'); expect(cp).toContain('B 3.00000000 11.00000000 0.00000000');
 expect(cp.match(/&COORD\n([\s\S]*?)&END COORD/u)![1].trim().split('\n').map(line=>line.trim())).toEqual(xyz.split('\n'));
});
test('independent: all three documented task routes and deliberate unsupported combinations are truthful', () => {
 const tokens: Record<QuantumEngine, string[]>={orca:[' SP',' Opt',' Freq'],gaussian:[' SP',' Opt',' Freq'],psi4:["energy('B3LYP')","optimize('B3LYP')","frequency('B3LYP')"],cp2k:['RUN_TYPE ENERGY','RUN_TYPE GEO_OPT','RUN_TYPE VIBRATIONAL_ANALYSIS']};
 for(const engine of ['orca','gaussian','psi4','cp2k'] as const) for(const [i,task] of (['energy','optimize','frequencies'] as const).entries()) {
  const result=generateQuantumInput(atoms,{engine,task,charge:0,multiplicity:1,method:engine==='cp2k'?'PBE':'B3LYP',basis:engine==='cp2k'?'DZVP-MOLOPT-SR-GTH':'def2-SVP'});
  expect(result.text).toContain(tokens[engine][i]);
 }
 expect(()=>generateQuantumInput(atoms,{...basis,engine:'cp2k',method:'PBE'})).toThrow('frozen atoms only');
 expect(()=>generateQuantumInput(atoms,{...basis,engine:'cp2k',method:'B3LYP',constraints:[]})).toThrow('PBE and BLYP');
 expect(()=>generateQuantumInput(atoms,{...basis,engine:'orca',task:'frequencies'})).toThrow('optimization');
 expect(()=>generateQuantumInput(atoms,{...basis,engine:'cp2k',method:'PBE',constraints:[],cell:[[10,0,0],[0,0,0],[0,0,12]]})).toThrow('independent lattice');
});
