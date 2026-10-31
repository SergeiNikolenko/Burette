import { beforeAll, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { Molecule } from 'openchemlib';
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { buildPeptideGeometry, PEPTIDE_BACKBONE_PRESETS, type PeptideGeometry } from '../apps/desktop/src/lib/molecular-workbench/peptide-geometry';
import { peptideMmcif } from '../apps/desktop/src/lib/molecular-workbench/peptide-mmcif';
import { serializePhysicalMolfile } from '../apps/desktop/src/lib/molecular-workbench/molecule-serialization';
const require = createRequire(import.meta.url);
const { CIF } = require('molstar/lib/commonjs/mol-io/reader/cif.js');
const { trajectoryFromMmCIF } = require('molstar/lib/commonjs/mol-model-formats/structure/mmcif.js');
const { Structure, StructureProperties, StructureElement } = require('molstar/lib/commonjs/mol-model/structure.js');
let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
const sub = (a: number[], b: number[]) => a.map((x,i) => x-b[i]);
const dot = (a: number[], b: number[]) => a.reduce((s,x,i) => s+x*b[i],0);
const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function torsion(a: number[], b: number[], c: number[], d: number[]) {
  const bc=sub(c,b), u=bc.map(x=>x/Math.hypot(...bc)), ab=sub(a,b), cd=sub(d,c);
  const v=ab.map((x,i)=>x-dot(ab,u)*u[i]), w=cd.map((x,i)=>x-dot(cd,u)*u[i]);
  return Math.atan2(dot(cross(u,v),w),dot(v,w))*180/Math.PI;
}
function molecule(p: PeptideGeometry) {
  const m = new Molecule(p.atoms.length,p.bonds.length);
  for(const [i,a] of p.atoms.entries()) {
    const k=m.addAtom(Molecule.getAtomicNoFromLabel(a.element));
    m.setAtomX(k,a.position[0]);m.setAtomY(k,a.position[1]);m.setAtomZ(k,a.position[2]);m.setAtomCharge(k,a.charge);m.setAtomMapNo(k,i+1,false);
  }
  for(const b of p.bonds)m.setBondType(m.addBond(b.a,b.b),b.order===2?Molecule.cBondTypeDouble:Molecule.cBondTypeSingle);
  m.ensureHelperArrays(Molecule.cHelperCIP);return m;
}

test('all native backbone presets measure requested phi/psi/trans omega and peptide bond geometry', () => {
  for(const preset of Object.values(PEPTIDE_BACKBONE_PRESETS)) for(const chirality of ['L','D'] as const) {
    const p=buildPeptideGeometry('ACIPGT',{...preset,chirality});
    const at=(residue:number,name:string)=>p.atoms.find(a=>a.residueNumber===residue&&a.name===name)!.position;
    for(let r=2;r<=6;r++) {
      const measured=[torsion(at(r-1,'C'),at(r,'N'),at(r,'CA'),at(r,'C')),torsion(at(r-1,'N'),at(r-1,'CA'),at(r-1,'C'),at(r,'N')),torsion(at(r-1,'CA'),at(r-1,'C'),at(r,'N'),at(r,'CA'))];
      for(const [i,value] of measured.entries()) expect(Math.abs(((value-[preset.phi,preset.psi,180][i]+540)%360)-180)).toBeLessThan(1e-8);
      expect(Math.hypot(...sub(at(r,'N'),at(r-1,'C')))).toBeCloseTo(1.329,10);
      const angle=(a:number[],b:number[],c:number[])=>Math.acos(dot(sub(a,b),sub(c,b))/Math.hypot(...sub(a,b))/Math.hypot(...sub(c,b)))*180/Math.PI;
      expect(angle(at(r-1,'CA'),at(r-1,'C'),at(r,'N'))).toBeCloseTo(116.2,8);
      expect(angle(at(r-1,'C'),at(r,'N'),at(r,'CA'))).toBeCloseTo(121.7,8);
    }
  }
});

test('all 20 native residue coordinates have correct L/D stereochemistry and independently parse as valence-complete MOL', () => {
  for(const code of 'ARNDCQEGHILKMFPSTWYV') for(const chirality of ['L','D'] as const) {
    const p=buildPeptideGeometry(code,{chirality});const m=molecule(p);
    const stereo=Array.from({length:m.getAllAtoms()},(_,i)=>({name:p.atoms[m.getAtomMapNo(i)-1].name,parity:m.getAtomCIPParity(i)})).filter(a=>a.parity);
    const S=Molecule.cAtomCIPParitySorP,R=Molecule.cAtomCIPParityRorM;
    const expected=code==='G'?[]:[{name:'CA',parity:code==='C'?R:S},...(code==='I'||code==='T'?[{name:'CB',parity:code==='I'?S:R}]:[])];
    if(chirality==='D')for(const a of expected)a.parity=a.parity===S?R:S;
    expect(stereo).toEqual(expected);
    for(let i=0;i<m.getAllAtoms();i++)m.setAtomMapNo(i,0,false);
    const reopened=rdkit.get_mol(serializePhysicalMolfile(m));expect(reopened).not.toBeNull();
    try {
      const descriptors=JSON.parse(reopened!.get_descriptors());expect(descriptors.NumAtoms).toBe(p.atoms.length);
      expect(descriptors.NumUnspecifiedAtomStereoCenters).toBe(0);
      expect(descriptors.NumAtomStereoCenters).toBe(expected.length);
    } finally {reopened?.delete();}
    const charge=p.atoms.reduce((sum,a)=>sum+a.charge,0);expect(charge).toBe('RKH'.includes(code)?1:0);
  }
});

test('charged termini, Pro ring valence and mixed residue identity remain explicit and bounded', () => {
  for(const sequence of ['P','PP','APG','CIT']) for(const nTerminus of ['amine','ammonium'] as const) for(const cTerminus of ['acid','carboxylate'] as const) {
    const p=buildPeptideGeometry(sequence,{nTerminus,cTerminus,chain:'Z'}),m=molecule(p);
    expect(p.atoms.every(a=>a.chain==='Z')).toBe(true);
    const n=p.atoms.find(a=>a.name==='N'&&a.residueNumber===1)!;
    expect(n.charge).toBe(nTerminus==='ammonium'?1:0);
    expect(p.atoms.reduce((s,a)=>s+a.charge,0)).toBe(Number(nTerminus==='ammonium')-Number(cTerminus==='carboxylate'));
    for(let i=0;i<m.getAllAtoms();i++)m.setAtomMapNo(i,0,false);
    const reopened=rdkit.get_mol(serializePhysicalMolfile(m));expect(reopened).not.toBeNull();
    try {expect(JSON.parse(reopened!.get_descriptors()).NumAtoms).toBe(p.atoms.length);}finally{reopened?.delete();}
    expect(new Set(p.atoms.map(a=>`${a.chain}:${a.residueNumber}:${a.name}`)).size).toBe(p.atoms.length);
    for(const [i,a] of p.atoms.entries())if(a.residue==='PRO'&&a.name==='N') {
      const valence=p.bonds.filter(b=>b.a===i||b.b===i).reduce((s,b)=>s+b.order,0);expect(valence).toBe(3+a.charge);
    }
  }
  const mixed=buildPeptideGeometry('AAA',{chirality:['L','D','L']});
  const m=molecule(mixed);expect(Array.from({length:m.getAllAtoms()},(_,i)=>({source:m.getAtomMapNo(i)-1,parity:m.getAtomCIPParity(i)})).filter(a=>a.parity).sort((a,b)=>a.source-b.source).map(a=>a.parity)).toEqual([2,1,2]);
  expect(buildPeptideGeometry('A'.repeat(25)).atoms).toHaveLength(253);
  expect(()=>buildPeptideGeometry('A'.repeat(26))).toThrow('256');
  for(const sequence of ['','ß','ſ','A0','X'])expect(()=>buildPeptideGeometry(sequence)).toThrow('standard');
  expect(()=>buildPeptideGeometry('AA',{chirality:new Array(2)})).toThrow('each residue');
  expect(()=>buildPeptideGeometry('AA',{phi:NaN})).toThrow('angles');
  expect(()=>buildPeptideGeometry('AA',{chain:'A\ninjection'})).toThrow('chain');
});

test('actual MolStar mmCIF reopening retains atom/residue/chain identity, charges, coordinates and the complete bond graph', async () => {
  for(const chirality of ['L','D',['L','D','L','D']] as const) {
    const p=buildPeptideGeometry('CIPK',{phi:-60,psi:-40,chirality: typeof chirality==='string'?chirality:[...chirality],nTerminus:'ammonium',cTerminus:'carboxylate',chain:'B'});
    const parsed=await CIF.parse(peptideMmcif(p)).run();expect(parsed.isError).toBe(false);
    const trajectory=await trajectoryFromMmCIF(parsed.result.blocks[0]).run();const s=Structure.ofModel(trajectory.representative);
    expect(s.elementCount).toBe(p.atoms.length);expect(s.polymerResidueCount).toBe(4);
    const loc=StructureElement.Location.create(s),indexOf=new Map<string,number>(),observed=[];
    for(const unit of s.units)for(let i=0;i<unit.elements.length;i++) {
      loc.unit=unit;loc.element=unit.elements[i];indexOf.set(`${unit.id}:${i}`,observed.length);
      observed.push([StructureProperties.atom.label_atom_id(loc),StructureProperties.atom.label_comp_id(loc),StructureProperties.residue.label_seq_id(loc),StructureProperties.chain.label_asym_id(loc),StructureProperties.atom.pdbx_formal_charge(loc),StructureProperties.atom.x(loc),StructureProperties.atom.y(loc),StructureProperties.atom.z(loc)]);
    }
    expect(observed.map(row=>row.slice(0,5))).toEqual(p.atoms.map(a=>[a.name,a.residue,a.residueNumber,a.chain,a.charge]));
    for(const [i,row] of observed.entries())for(let k=0;k<3;k++)expect(Math.abs(row[k+5]-p.atoms[i].position[k])).toBeLessThan(1e-5);
    const bonds=[];
    for(const unit of s.units)for(let e=0;e<unit.bonds.a.length;e++) {
      const {a,b,edgeProps}=unit.bonds;if(a[e]>=b[e])continue;
      const x=indexOf.get(`${unit.id}:${a[e]}`)!,y=indexOf.get(`${unit.id}:${b[e]}`)!;
      bonds.push(`${Math.min(x,y)}:${Math.max(x,y)}:${edgeProps.order[e]}`);
    }
    expect(s.interUnitBonds.edgeCount).toBe(0);
    expect(bonds.sort()).toEqual(p.bonds.map(b=>`${Math.min(b.a,b.b)}:${Math.max(b.a,b.b)}:${b.order}`).sort());
  }
});

test('ammonium hydrogens form a tetrahedron without changing any heavy atom or creating overlapping protons', () => {
  for(const code of 'ARNDCQEGHILKMFPSTWYV')for(const chirality of ['L','D'] as const) {
    const p=buildPeptideGeometry(code,{chirality,nTerminus:'ammonium'}),neutral=buildPeptideGeometry(code,{chirality});
    expect(p.atoms.filter(a=>a.element!=='H').map(a=>[a.name,a.position])).toEqual(neutral.atoms.filter(a=>a.element!=='H').map(a=>[a.name,a.position]));
    const n=p.atoms[0],attached=p.bonds.filter(b=>b.a===0||b.b===0).map(b=>p.atoms[b.a===0?b.b:b.a]);
    const hs=attached.filter(a=>a.element==='H'),heavy=attached.filter(a=>a.element!=='H');
    expect(hs.length+heavy.length).toBe(4);
    for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++)expect(Math.hypot(...sub(hs[i].position,hs[j].position))).toBeGreaterThan(1.5);
    for(const h of hs) {
      expect(Math.hypot(...sub(h.position,n.position))).toBeCloseTo(1.009,10);
      for(const c of heavy) {
        const u=sub(h.position,n.position),v=sub(c.position,n.position);
        expect(dot(u,v)/Math.hypot(...u)/Math.hypot(...v)).toBeCloseTo(-1/3,10);
      }
    }
  }
});

test('close nonbonded contacts stay nonbonded through full mmCIF import and native re-export', async () => {
  const { to_mmCIF } = require('molstar/lib/commonjs/mol-model/structure/export/mmcif.js');
  for(const [sequence,phi,psi] of [['WICPTAGHENKR',-87,143],['GG',0,0],['PP',90,-90]] as const) {
    const p=buildPeptideGeometry(sequence,{phi,psi,chirality:[...sequence].map((_,i)=>i%2?'D':'L'),nTerminus:'ammonium',cTerminus:'carboxylate',chain:'7'});
    let text=peptideMmcif(p);
    for(let cycle=0;cycle<2;cycle++) {
      const parsed=await CIF.parse(text).run();expect(parsed.isError).toBe(false);
      const model=(await trajectoryFromMmCIF(parsed.result.blocks[0]).run()).representative,s=Structure.ofModel(model),loc=StructureElement.Location.create(s);
      const ids=new Map<string,number>(),bonds:string[]=[];expect(s.elementCount).toBe(p.atoms.length);
      for(const unit of s.units)for(let i=0;i<unit.elements.length;i++) {
        loc.unit=unit;loc.element=unit.elements[i];
        const name=StructureProperties.atom.label_atom_id(loc),residue=StructureProperties.residue.label_seq_id(loc);
        const source=p.atoms.findIndex(a=>a.name===name&&a.residueNumber===residue);expect(source).toBeGreaterThanOrEqual(0);
        ids.set(`${unit.id}:${i}`,source);const expected=p.atoms[source];
        expect([StructureProperties.chain.label_asym_id(loc),StructureProperties.atom.label_comp_id(loc),StructureProperties.atom.type_symbol(loc),StructureProperties.atom.pdbx_formal_charge(loc)]).toEqual([expected.chain,expected.residue,expected.element,expected.charge]);
        const position=[StructureProperties.atom.x(loc),StructureProperties.atom.y(loc),StructureProperties.atom.z(loc)];
        // The native exporter writes 3 decimal places; the producer writes 10.
        for(let k=0;k<3;k++)expect(Math.abs(position[k]-expected.position[k])).toBeLessThan(cycle?0.00051:1e-5);
      }
      for(const unit of s.units)for(let e=0;e<unit.bonds.a.length;e++) {
        const {a,b,edgeProps}=unit.bonds;if(a[e]>=b[e])continue;
        const x=ids.get(`${unit.id}:${a[e]}`)!,y=ids.get(`${unit.id}:${b[e]}`)!;
        bonds.push(`${Math.min(x,y)}:${Math.max(x,y)}:${edgeProps.order[e]}`);
      }
      expect(s.interUnitBonds.edgeCount).toBe(0);
      expect(bonds.sort()).toEqual(p.bonds.map(b=>`${Math.min(b.a,b.b)}:${Math.max(b.a,b.b)}:${b.order}`).sort());
      text=to_mmCIF('peptide_roundtrip',s,false,{copyAllCategories:true});
    }
  }
});
