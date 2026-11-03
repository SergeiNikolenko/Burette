import{test,expect}from'bun:test';
import{readFileSync}from'node:fs';
import initRDKitModule from'@rdkit/rdkit';
import{Molecule}from'openchemlib';
import{parseMolecule}from'../apps/desktop/src/lib/molecular-workbench/chemistry';
import { serializePhysicalMolfile } from '../apps/desktop/src/lib/molecular-workbench/molecule-serialization';
const fixture=(id:string)=>readFileSync(new URL(`./fixtures/source-stereo/${id}.mol`,import.meta.url),'utf8');

test('physical serialization preserves coincident coordinates without mutating its input', () => {
  const molecule = Molecule.fromSmiles('CCO');
  molecule.ensureHelperArrays(Molecule.cHelperCIP);
  const coordinates = [[-0.4669, -0.3078, -0.4089], [-0.4669, -0.3078, -0.4089], [-1.4301, 0.6702, -0.0447]];
  coordinates.forEach(([x, y, z], index) => {
    molecule.setAtomX(index, x);
    molecule.setAtomY(index, y);
    molecule.setAtomZ(index, z);
  });
  const output = serializePhysicalMolfile(molecule);
  expect(coordinates.map((_, index) => [molecule.getAtomX(index), molecule.getAtomY(index), molecule.getAtomZ(index)])).toEqual(coordinates);
  const rows = output.split('\n');
  const begin = rows.indexOf('M  V30 BEGIN ATOM');
  expect(rows.slice(begin + 1, begin + 4).map(row => row.split(/\s+/).slice(4, 7).map(Number))).toEqual(coordinates);
});

test('oversized MOL is refused before processing its unknown stereo centers',()=>{
 const atoms:string[]=[],bonds:string[]=[];
 for(let k=0;k<60;k++){
  const first=k*5+1;
  for(const[i,element]of ['C','F','Cl','Br','I'].entries())atoms.push(`M  V30 ${first+i} ${element} ${k*5+(i===1?1:i===2?-1:0)} ${i===3?1:0} ${i===4?1:0} 0`);
  for(let i=1;i<=4;i++)bonds.push(`M  V30 ${k*4+i} 1 ${first} ${first+i}${i===1?' CFG=2':''}`);
 }
 const source=['bounds','  authored          3D','','  0  0  0  0  0  0              0 V3000','M  V30 BEGIN CTAB','M  V30 COUNTS 300 240 0 0 0','M  V30 BEGIN ATOM',...atoms,'M  V30 END ATOM','M  V30 BEGIN BOND',...bonds,'M  V30 END BOND','M  V30 END CTAB','M  END'].join('\n');
 const parsed=Molecule.fromMolfile(source);
 expect([parsed.getAllAtoms(),parsed.getAllBonds()]).toEqual([300,240]);
 const prototype=Object.getPrototypeOf(parsed), original=prototype.convertStereoBondsToSingleBonds;
 let calls=0;
 prototype.convertStereoBondsToSingleBonds=function(this:Molecule,...args:unknown[]){calls++;return original.apply(this,args);};
 try{
  expect(()=>parseMolecule(source,'mol')).toThrow('Browser chemistry supports 1–256 atoms.');
  expect(calls).toBe(0);
 }finally{prototype.convertStereoBondsToSingleBonds=original;}
});

function reopen(source:string){
 const states=[parseMolecule(source,'mol')];
 for(let i=0;i<3;i++){
  const previous=states.at(-1)!,next=parseMolecule(previous.molfile,'mol');
  next.atoms.forEach((a,j)=>(['x','y','z']as const).forEach(axis=>expect(a[axis]).toBeCloseTo(previous.atoms[j][axis],8)));
  states.push(next);
 }
 return states;
}

test('ordinary reopen retains known and unknown neighboring tetrahedra, incoming bonds, and quaternary centers',async()=>{
 const rdkit=await initRDKitModule();
 for(const[id,known,unknown]of [
  ['mixed-known-first-3d',[[1,'R']],3],['mixed-unknown-first-3d',[[3,'R']],1],
  ['unknown-incoming-3d',[],3],['unknown-quaternary-incoming-3d',[],4],
 ]as const){
  for(const m of reopen(fixture(id))){
   const mol=rdkit.get_mol(m.molfile)!;
   try{
    const json=JSON.parse(mol.get_json()),row=json.molecules[0];
    expect(row.extensions.find((x:any)=>x.name==='rdkitRepresentation').cipCodes??[]).toEqual(known.map(([i,cip])=>[m.atomMap?.[i]??i,cip]));
    expect(row.atoms[m.atomMap?.[unknown]??unknown].stereo??json.defaults.atom.stereo).toBe('unspecified');
   }finally{mol.delete();}
  }
 }
});

test('ordinary reopen keeps explicit unknown allene termini without choosing a source configuration',()=>{
 for(const id of ['unknown-pentadiene-3d','unknown-haloallene-3d']){
  for(const m of reopen(fixture(id))){
   const markers=m.molfile.split('\n').flatMap(line=>{
    const q=/^M  V30 \d+ 1 (\d+) (\d+).*\bCFG=(\d+)/u.exec(line);
    return q?[{from:Number(q[1])-1,to:Number(q[2])-1,cfg:Number(q[3])}]:[];
   }).filter(q=>[1,3].includes(q.from)||[1,3].includes(q.to));
   expect(markers.some(q=>[1,3].includes(q.from)&&q.cfg===2)).toBe(true);
   expect(markers.some(q=>q.cfg===1||q.cfg===3)).toBe(false);
  }
 }
});

test('ordinary reopen preserves declared 2D allene stereo and literal 3D Cartesian handedness',()=>{
 for(const[id,sign]of [['known-pentadiene-plus-3d',1],['known-pentadiene-minus-3d',-1],['known-haloallene-plus-2d',null],['known-haloallene-minus-2d',null]]as const){
  const source=Molecule.fromMolfile(fixture(id));source.ensureHelperArrays(Molecule.cHelperCIP);
  const declared=source.getAtomCIPParity(2);expect([1,2]).toContain(declared);
  for(const m of reopen(fixture(id))){
   const parsed=Molecule.fromMolfile(m.molfile);parsed.ensureHelperArrays(Molecule.cHelperCIP);
   expect(parsed.getAtomCIPParity(m.atomMap?.[2]??2)).toBe(declared);
   if(sign!==null){
    const a=m.atoms,sub=(i:number,j:number)=>[a[i].x-a[j].x,a[i].y-a[j].y,a[i].z-a[j].z];
    const axis=sub(3,1),left=sub(0,1),right=sub(4,3);
    const cross=[left[1]*right[2]-left[2]*right[1],left[2]*right[0]-left[0]*right[2],left[0]*right[1]-left[1]*right[0]];
    expect(Math.sign(axis.reduce((s,v,i)=>s+v*cross[i],0))).toBe(sign);
   }
  }
 }
});
