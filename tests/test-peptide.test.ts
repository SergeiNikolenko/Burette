import { beforeAll, expect, test } from "bun:test";
import { Molecule } from "openchemlib";
import { buildPeptideSmiles, PEPTIDE_RESIDUES } from "../apps/desktop/src/lib/molecular-workbench/peptide";

function parse(sequence: string, options = {}) {
  const molecule = Molecule.fromSmiles(buildPeptideSmiles(sequence, options));
  molecule.ensureHelperArrays(Molecule.cHelperCIP);
  return molecule;
}
function stereochemistry(molecule: Molecule) {
  return Array.from({ length: molecule.getAllAtoms() }, (_, index) => molecule.getAtomCIPParity(index)).filter(Boolean);
}

test("all 20 amino acids have parsable neutral residue graphs and correct termini", () => {
  expect(PEPTIDE_RESIDUES).toHaveLength(20);
  for (const { code } of PEPTIDE_RESIDUES) {
    const molecule = parse(code);
    expect(molecule.getMolecularFormula().formula).not.toContain("+");
    expect(molecule.getMolecularFormula().formula).not.toContain("-");
  }
  expect(parse("A").getMolecularFormula().formula).toBe("C3H7NO2");
  expect(parse("GAS").getMolecularFormula().formula).toBe("C8H15N3O5");
  expect(parse("AA").getMolecularFormula().formula).toBe("C6H12N2O3");
  expect(parse("A", { nTerminus: "acetyl", cTerminus: "amide" }).getMolecularFormula().formula).toBe("C5H10N2O2");
  expect(parse("APG").getMolecularFormula().formula).toBe("C10H17N3O4");
});

test("L and D templates retain alpha and side-chain absolute stereochemistry", () => {
  const S = Molecule.cAtomCIPParitySorP, R = Molecule.cAtomCIPParityRorM;
  expect(stereochemistry(parse("A"))).toEqual([S]);
  expect(stereochemistry(parse("A", { chirality: "D" }))).toEqual([R]);
  expect(stereochemistry(parse("C"))).toEqual([R]);
  expect(stereochemistry(parse("P"))).toEqual([S]);
  expect(stereochemistry(parse("T"))).toEqual([S, R]);
  expect(stereochemistry(parse("I"))).toEqual([S, S]);
  expect(stereochemistry(parse("T", { chirality: "D" }))).toEqual([R, S]);
  expect(stereochemistry(parse("I", { chirality: "D" }))).toEqual([R, R]);
  expect(stereochemistry(parse("AA", { chirality: ["L", "D"] }))).toEqual([S, R]);
  expect(stereochemistry(parse("G"))).toEqual([]);
  expect(() => buildPeptideSmiles("AX")).toThrow("standard amino-acid");
  expect(() => buildPeptideSmiles("WWWWWWWWWWW")).toThrow("256");
  expect(() => buildPeptideSmiles("AA", { chirality: ["D"] })).toThrow("each residue");
});



import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { type PeptideOptions } from "../apps/desktop/src/lib/molecular-workbench/peptide";
import references from "./fixtures/peptide/references.json";
let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
const formulas: Record<string, string> = {
  A:"C3H7NO2", R:"C6H14N4O2", N:"C4H8N2O3", D:"C4H7NO4", C:"C3H7NO2S",
  E:"C5H9NO4", Q:"C5H10N2O3", G:"C2H5NO2", H:"C6H9N3O2", I:"C6H13NO2",
  L:"C6H13NO2", K:"C6H14N2O2", M:"C5H11NO2S", F:"C9H11NO2", P:"C5H9NO2",
  S:"C3H7NO3", T:"C4H9NO3", W:"C11H12N2O2", Y:"C9H11NO3", V:"C5H11NO2",
};
type Atom = { z:number; impHs:number; chg:number };
type Bond = { bo:number; atoms:[number,number] };
function inspect(sequence: string, options: PeptideOptions = {}) {
  const mol = rdkit.get_mol(buildPeptideSmiles(sequence, options));
  if (!mol) throw new Error("RDKit rejected peptide");
  try {
    const json = JSON.parse(mol.get_json()) as { defaults:{atom:Atom;bond:Bond};molecules:{atoms:Partial<Atom>[];bonds:Partial<Bond>[]}[] };
    return { canonical:mol.get_smiles(), stereo:JSON.parse(mol.get_stereo_tags()).CIP_atoms as [number,string][],
      descriptors:JSON.parse(mol.get_descriptors()) as Record<string,number>,
      atoms:json.molecules[0].atoms.map(a=>({...json.defaults.atom,...a})),
      bonds:json.molecules[0].bonds.map(b=>({...json.defaults.bond,...b})) };
  } finally { mol.delete(); }
}
function formulaAtoms(formula: string) {
  return Array.from(formula.matchAll(/[A-Z][a-z]?(\d*)/g),match=>Number(match[1] || 1)).reduce((a,b)=>a+b,0);
}
function checkGraph(graph: ReturnType<typeof inspect>) {
  const valence=graph.atoms.map(a=>a.impHs), adjacent=graph.atoms.map(()=>[] as number[]);
  for (const b of graph.bonds) { const [a,c]=b.atoms; valence[a]+=b.bo;valence[c]+=b.bo;adjacent[a].push(c);adjacent[c].push(a); }
  const seen=new Set([0]),todo=[0];
  while(todo.length) for(const n of adjacent[todo.pop()!]) if(!seen.has(n)){seen.add(n);todo.push(n);}
  expect(seen.size).toBe(graph.atoms.length);
  expect(graph.atoms.map(a=>a.chg)).toEqual(graph.atoms.map(()=>0));
  const targets:Record<number,number>={6:4,7:3,8:2,16:2};
  expect(valence).toEqual(graph.atoms.map(a=>targets[a.z]));
}

test("independent RDKit graphs agree with all residue formulas, connectivity, valence and L/D configurations", () => {
  for (const code of Object.keys(formulas)) for(const chirality of ["L","D"] as const) {
    const graph=inspect(code,{chirality});checkGraph(graph);
    const ocl=parse(code,{chirality});
    expect(ocl.getMolecularFormula().formula).toBe(formulas[code]);
    expect([graph.descriptors.NumAtoms,graph.atoms.length,graph.bonds.length]).toEqual([formulaAtoms(formulas[code]),ocl.getAllAtoms(),ocl.getAllBonds()]);
    const expected=code==="G"?[]:code==="C"?["(R)"]:code==="I"?["(S)","(S)"]:code==="T"?["(S)","(R)"]:["(S)"];
    expect(graph.stereo.map(s=>s[1])).toEqual(chirality==="L"?expected:expected.map(s=>s==="(R)"?"(S)":"(R)"));
    expect(graph.descriptors.NumUnspecifiedAtomStereoCenters).toBe(0);
  }
});

test("canonical graphs match primary PubChem structures and preserve stereo through actual MOL roundtrip", () => {
  for(const ref of references.residues) {
    const reference=rdkit.get_mol(ref.smiles)!;
    const reopened=rdkit.get_mol(parse(ref.code).toMolfileV3())!;
    try {
      expect([inspect(ref.code).canonical,reopened.get_smiles()]).toEqual([reference.get_smiles(),reference.get_smiles()]);
      expect(parse(ref.code).getMolecularFormula().formula).toBe(ref.formula);
    } finally {reopened.delete();reference.delete();}
  }
  for(const chirality of ["L","D"] as const) {
    const before=inspect("CITP",{chirality}), mol=parse("CITP",{chirality});
    expect([mol.getMolecularFormula().formula,before.descriptors.NumAmideBonds]).toEqual(["C18H32N4O6S",3]);
    const expected=["(R)","(S)","(S)","(S)","(R)","(S)"];
    expect(before.stereo.map(s=>s[1])).toEqual(chirality==="L"?expected:expected.map(s=>s==="(R)"?"(S)":"(R)"));
    const reopened=rdkit.get_mol(mol.toMolfileV3())!;
    try {expect(reopened.get_smiles()).toBe(before.canonical);}finally{reopened.delete();}
  }
});

function matches(sequence:string,options:PeptideOptions,smarts:string) {
  const mol=rdkit.get_mol(buildPeptideSmiles(sequence,options))!,query=rdkit.get_qmol(smarts)!;
  try {const found=JSON.parse(mol.get_substruct_matches(query));return Array.isArray(found)?found.length:0;}finally{query.delete();mol.delete();}
}
test("neutral amine/acid and acetyl/amide caps retain terminal connectivity including Pro ring nitrogen", () => {
  for(const nTerminus of ["amine","acetyl"] as const) for(const cTerminus of ["acid","amide"] as const) {
    const options={nTerminus,cTerminus},graph=inspect("PG",options);checkGraph(graph);
    expect(graph.descriptors.NumAmideBonds).toBe(1+Number(nTerminus==="acetyl")+Number(cTerminus==="amide"));
    expect(matches("PG",options,"[CX3](=[OX1])[OX2H1]")).toBe(Number(cTerminus==="acid"));
    expect(matches("PG",options,"[CX3](=[OX1])[NX3H2]")).toBe(Number(cTerminus==="amide"));
    expect(matches("PG",options,"[NX3;R;H1]")).toBe(Number(nTerminus==="amine"));
    expect(parse("PG",options).getMolecularFormula().formula).toBe(nTerminus==="amine"?(cTerminus==="acid"?"C7H12N2O3":"C7H13N3O2"):(cTerminus==="acid"?"C9H14N2O4":"C9H15N3O3"));
  }
  const pro=inspect("PP");checkGraph(pro);
  expect([pro.descriptors.NumRings,pro.descriptors.NumAmideBonds,matches("PP",{},"[NX3;R;H1]")]).toEqual([2,1,1]);
  expect(inspect(" a p\ng ").canonical).toBe(inspect("APG").canonical);
  expect(inspect("AA",{chirality:["L","D"]}).stereo.map(s=>s[1])).toEqual(["(S)","(R)"]);
  expect(inspect("IT",{chirality:["D","L"]}).stereo.map(s=>s[1])).toEqual(["(R)","(R)","(S)","(R)"]);
  const directed="[NX3H2]-[CH](-[CH3])-[CX3](=[OX1])-[NX3H1]-[CH2]-[CX3](=[OX1])-[OX2H1]";
  expect([matches("AG",{},directed),matches("GA",{},directed)]).toEqual([1,0]);
});

test("the 256-atom budget counts actual implicit H and terminal atoms before graph construction", () => {
  expect(inspect("G".repeat(36),{cTerminus:"amide"}).descriptors.NumAtoms).toBe(256);
  expect(inspect("A".repeat(25)).descriptors.NumAtoms).toBe(253);
  for(const [sequence,options] of [["G".repeat(37),{}],["A".repeat(25),{nTerminus:"acetyl"}]] as [string,PeptideOptions][]) expect(()=>buildPeptideSmiles(sequence,options)).toThrow("256");
  for(const sequence of [""," ","AX","A0","ß","ſ","ﬀ","Ａ","A".repeat(65)]) expect(()=>buildPeptideSmiles(sequence)).toThrow("standard amino-acid");
  expect(()=>buildPeptideSmiles("AA",{chirality:["L","X"] as never})).toThrow("each residue");
  expect(()=>buildPeptideSmiles("AA",{chirality:new Array<"L"|"D">(2)})).toThrow("each residue");
  expect(()=>buildPeptideSmiles("A",{nTerminus:"charged" as never})).toThrow("terminal group");
  expect(()=>buildPeptideSmiles("A",{cTerminus:"ester" as never})).toThrow("terminal group");
});
