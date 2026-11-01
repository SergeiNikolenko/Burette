import{test,expect}from'bun:test';
import{readFileSync}from'node:fs';
import initRDKitModule from'@rdkit/rdkit';
import{runChemistryTask as task}from'../apps/desktop/src/lib/molecular-workbench/compute-client';
import type{MolecularStructure}from'../apps/desktop/src/lib/molecular-workbench/chemistry';
const fixture=(id:string,group='to-ocl-boundary')=>readFileSync(new URL(`./fixtures/${group}/${id}.${group==='source-stereo'?'mol':'sdf'}`,import.meta.url),'utf8');
const cfg=(text:string,index:number)=>Number(new RegExp(`^M  V30 ${index+1} \\S+ [^\\n]*\\bCFG=([123])(?:\\s|$)`,'m').exec(text)?.[1]??0);
const coordinatesOnly=(text:string)=>text.replace(/ CFG=\d+/g,'').replace(/M  V30 BEGIN COLLECTION[\s\S]*?M  V30 END COLLECTION\n/g,'');

test('actual worker preserves specified source R/S, isotope, ring and E/Z configurations with actual returned energies',async()=>{
 const rdkit=await initRDKitModule();
 for(const[id,known,ez]of[
  ['lactic-at',[[1,'S']],null],['lactic-atat',[[1,'R']],null],['isotope-stereo',[[1,'S']],null],
  ['decalin',[[3,'S'],[8,'S']],null],['alkene-e',[],-1],['alkene-z',[],1],
 ]as const){
  const source=await task({action:'parse',source:fixture(id),format:'sdf'}),saved=JSON.stringify(source);
  for(const seed of[1,17])for(const result of await task({action:'conformers',molecule:source,options:{count:2,seed}})){
   const m=result.molecule,mol=rdkit.get_mol(coordinatesOnly(m.molfile),JSON.stringify({removeHs:false}))!;
   try{
    const codes=JSON.parse(mol.get_json()).molecules[0].extensions.find((x:any)=>x.name==='rdkitRepresentation').cipCodes??[];
    for(const[i,expected]of known)expect(codes.find((x:any)=>x[0]===(m.atomMap?.[i]??i))?.[1]).toBe(expected);
   }finally{mol.delete();}
   if(ez!==null){
    const a=m.atoms,sub=(i:number,j:number)=>[a[i].x-a[j].x,a[i].y-a[j].y,a[i].z-a[j].z];
    const axis=sub(2,1),unit=axis.map(v=>v/Math.hypot(...axis)),left=sub(0,1),right=sub(3,2);
    const dot=(x:number[],y:number[])=>x.reduce((s,v,i)=>s+v*y[i],0);
    const l=left.map((v,i)=>v-dot(left,unit)*unit[i]),r=right.map((v,i)=>v-dot(right,unit)*unit[i]);
    expect(Math.sign(dot(l,r))).toBe(ez);
   }
   expect(await task({action:'energy',molecule:m})).toBeCloseTo(result.energy,7);
  }
  expect(JSON.stringify(source)).toBe(saved);
 }
},30_000);

test('worker sampling retains unspecified 2D and mixed 3D source constraints without adding known labels',async()=>{
 const rdkit=await initRDKitModule();
 for(const[id,group,unknown,known]of[['unspecified-center','to-ocl-boundary',1,null],['mixed-known-first-3d','source-stereo',3,1]]as const){
  const source=await task({action:'parse',source:fixture(id,group),format:'mol'});
  for(const result of await task({action:'conformers',molecule:source,options:{count:2,seed:17}})){
   const m=result.molecule,mol=rdkit.get_mol(m.molfile,JSON.stringify({removeHs:false}))!;
   try{
    const json=JSON.parse(mol.get_json()),row=json.molecules[0];
    expect(row.atoms[m.atomMap?.[unknown]??unknown].stereo??json.defaults.atom.stereo).toBe('unspecified');
    if(known!==null)expect(row.extensions.find((x:any)=>x.name==='rdkitRepresentation').cipCodes.find((x:any)=>x[0]===(m.atomMap?.[known]??known))?.[1]).toBe('R');
   }finally{mol.delete();}
   expect(await task({action:'energy',molecule:m})).toBeCloseTo(result.energy,7);
  }
 }
});

test('3D no-op publication follows reflected physical coordinates rather than stale source labels',async()=>{
 const rdkit=await initRDKitModule(),source=await task({action:'parse',source:fixture('lactic-at'),format:'mol'});
 const original=(await task({action:'conformers',molecule:source,options:{count:2,seed:1}}))[0].molecule;
 const reflected={...original,atoms:original.atoms.map(a=>({...a,x:-a.x}))};
 const output=await task({action:'add-hydrogens',molecule:reflected});
 output.atoms.forEach((a,i)=>(['x','y','z']as const).forEach(axis=>expect(a[axis]).toBe(reflected.atoms[i][axis])));
 const actual=rdkit.get_mol(coordinatesOnly(output.molfile),JSON.stringify({removeHs:false}))!;
 try{
  const codes=JSON.parse(actual.get_json()).molecules[0].extensions.find((x:any)=>x.name==='rdkitRepresentation').cipCodes;
  const index=output.atomMap?.[1]??1;expect(codes.find((x:any)=>x[0]===index)?.[1]).toBe('R');
  expect(cfg(output.molfile,index)).toBe(cfg(actual.get_v3Kmolblock(),index));
 }finally{actual.delete();}
});

test('worker forces retain caller H mapping and physical axes under a proper rigid transform',async()=>{
 const source=await task({action:'parse',source:fixture('interspersed-h'),format:'mol'});
 const pose=(await task({action:'conformers',molecule:source,options:{count:2,seed:1}}))[0].molecule;
 const body:MolecularStructure={...pose,atoms:pose.atoms.map(a=>({...a,x:a.x*1.03,y:a.y*1.03,z:a.z*1.03}))};
 const moved={...body,atoms:body.atoms.map(a=>({...a,x:a.z+7,y:-a.x+3,z:-a.y-2}))};
 const before=JSON.stringify(body),a=await task({action:'energy-forces',molecule:body}),b=await task({action:'energy-forces',molecule:moved});
 expect(b.energy).toBeCloseTo(a.energy,7);expect(Math.hypot(...a.forces.flat())).toBeGreaterThan(1e-6);
 a.forces.forEach((f,i)=>[f[2],-f[0],-f[1]].forEach((v,j)=>expect(b.forces[i][j]).toBeCloseTo(v,4)));
 expect(JSON.stringify(body)).toBe(before);expect(moved.atomMap).toEqual(body.atomMap);
});
