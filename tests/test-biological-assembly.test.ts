import { expect, test } from "bun:test";
import { parseCifText } from "@molstar/io/reader/cif/text/parser";
import { listBiologicalAssemblies, materializeBiologicalAssembly } from "../apps/desktop/src/lib/molecular-workbench/biological-assembly";

const operators = `loop_
_pdbx_struct_oper_list.id
_pdbx_struct_oper_list.matrix[1][1]
_pdbx_struct_oper_list.matrix[1][2]
_pdbx_struct_oper_list.matrix[1][3]
_pdbx_struct_oper_list.vector[1]
_pdbx_struct_oper_list.matrix[2][1]
_pdbx_struct_oper_list.matrix[2][2]
_pdbx_struct_oper_list.matrix[2][3]
_pdbx_struct_oper_list.vector[2]
_pdbx_struct_oper_list.matrix[3][1]
_pdbx_struct_oper_list.matrix[3][2]
_pdbx_struct_oper_list.matrix[3][3]
_pdbx_struct_oper_list.vector[3]
1 1 0 0 0 0 1 0 0 0 0 1 0
2 1 0 0 5 0 1 0 0 0 0 1 0
R 0 -1 0 0 1 0 0 0 0 0 1 0
`;
const sites = `loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.label_alt_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.pdbx_PDB_model_num
ATOM 1 C CA GLY A 1 1 . 1 2 3 1 12 Z 10 ? 1
ATOM 2 N N GLY A 1 1 B 2 2 3 0 15 Z 10 ? 1
HETATM 3 O O HOH B 2 . . 7 8 9 .5 20 W 20 ? 1
`;
const fixture = (expression = "(1-2)", rows = sites) => `data_fixture
_pdbx_struct_assembly.id 1
_pdbx_struct_assembly.details 'Test assembly'
_pdbx_struct_assembly_gen.assembly_id 1
_pdbx_struct_assembly_gen.oper_expression '${expression}'
_pdbx_struct_assembly_gen.asym_id_list A
${operators}${rows}`;
async function readSites(text: string) {
  const parsed = await parseCifText(text).run();
  if (parsed.isError) throw Error(parsed.message);
  return parsed.result.blocks[0].categories.atom_site;
}
test("explicit assembly uses label chains, retains alternate/zero-occupancy atoms and exports unique identities", async () => {
  expect(await listBiologicalAssemblies(fixture(), "cif")).toEqual({ assemblies: [{ id: "1", details: "Test assembly", copies: 2 }], models: ["1"] });
  const result = await materializeBiologicalAssembly(fixture(), "cif", "1");
  expect([result.atomCount, result.chainCount, result.warnings]).toEqual([4, 2, []]);
  const output = await readSites(result.cif);
  expect(Array.from({ length: 4 }, (_, i) => output.getField("Cartn_x")!.float(i))).toEqual([1, 2, 6, 7]);
  expect(Array.from({ length: 4 }, (_, i) => output.getField("label_asym_id")!.str(i))).toEqual(["A1", "A1", "A2", "A2"]);
  expect(output.getField("occupancy")!.float(3)).toBe(0);
  expect(output.getField("label_alt_id")!.str(3)).toBe("B");
  expect(new Set(Array.from({ length: 4 }, (_, i) => output.getField("id")!.str(i))).size).toBe(4);
  expect(result.cif).not.toContain("_pdbx_struct_assembly_gen");
});
test("Cartesian operator products act rightmost first and repeated operators do not duplicate atoms", async () => {
  const result = await materializeBiologicalAssembly(fixture("(2)(R)"), "cif", "1");
  const output = await readSites(result.cif);
  expect(["x", "y", "z"].map(axis => output.getField(`Cartn_${axis}`)!.float(0))).toEqual([3, 1, 3]);
  expect((await materializeBiologicalAssembly(fixture("(1,1)"), "cif", "1")).atomCount).toBe(2);
});
test("multiple source models require explicit choice", async () => {
  const input = fixture("1", sites + "ATOM 4 C CA GLY A 1 1 . 21 2 3 1 12 Z 10 ? 2\n");
  await expect(materializeBiologicalAssembly(input, "cif", "1")).rejects.toThrow("Choose one source model");
  const result = await materializeBiologicalAssembly(input, "cif", "1", "2");
  expect(result.atomCount).toBe(1);
  expect((await readSites(result.cif)).getField("Cartn_x")!.float(0)).toBe(21);
});
test("malformed and unbounded operations reject before expansion", async () => {
  for (const expression of ["(1-999999999999)", "(1-1000)(1-1000)", "(2-1)", "(1", "()", "missing", "1,,2"]) {
    await expect(materializeBiologicalAssembly(fixture(expression), "cif", "1")).rejects.toThrow();
  }
  await expect(materializeBiologicalAssembly(fixture().replace("asym_id_list A", "asym_id_list Z"), "cif", "1")).rejects.toThrow("label_asym_id");
  await expect(materializeBiologicalAssembly(fixture().replace("R 0 -1", "R 0 1"), "cif", "1")).rejects.toThrow("proper rigid");
  await expect(materializeBiologicalAssembly(fixture(), "cif", "unknown")).rejects.toThrow("not found");
});

async function readFrame(text: string) {
  const parsed = await parseCifText(text).run();
  if (parsed.isError) throw Error(parsed.message);
  return parsed.result.blocks[0];
}
const connection = `loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_label_asym_id
_struct_conn.ptnr1_label_comp_id
_struct_conn.ptnr1_label_seq_id
_struct_conn.ptnr1_label_atom_id
_struct_conn.ptnr1_auth_asym_id
_struct_conn.ptnr2_label_asym_id
_struct_conn.ptnr2_label_comp_id
_struct_conn.ptnr2_label_seq_id
_struct_conn.ptnr2_label_atom_id
_struct_conn.ptnr2_auth_asym_id
c1 covale A GLY 1 CA Z A GLY 1 N Z
`;
test("connections resolve selected-model atoms and remap both label and author chains", async () => {
  const input = fixture() + connection;
  const result = await materializeBiologicalAssembly(input, "cif", "1");
  const output = (await readFrame(result.cif)).categories.struct_conn;
  expect(output.rowCount).toBe(2);
  for (let row = 0; row < 2; row++) for (const partner of [1, 2]) {
    expect(output.getField(`ptnr${partner}_label_asym_id`)!.str(row)).toBe(`A${row + 1}`);
    expect(output.getField(`ptnr${partner}_auth_asym_id`)!.str(row)).toBe(`Z_A${row + 1}`);
  }
  expect(result.warnings).toEqual([]);
  const withModels = fixture("(1-2)", sites + "ATOM 4 C CA GLY A 1 1 . 21 2 3 1 12 Z 10 ? 2\n") + connection;
  const selected = await materializeBiologicalAssembly(withModels, "cif", "1", "2");
  expect((await readFrame(selected.cif)).categories.struct_conn).toBeUndefined();
  expect(selected.warnings.join(" ")).toContain("absent/ambiguous atoms");
});
test("unsupported third partners and crystal connections are omitted with a warning", async () => {
  for (const extra of ["_struct_conn.pdbx_ptnr3_label_asym_id A\n", "_struct_conn.ptnr1_symmetry 2_555\n"]) {
    const result = await materializeBiologicalAssembly(fixture() + connection + extra, "cif", "1");
    expect((await readFrame(result.cif)).categories.struct_conn).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("1 connection records");
  }
});
test("PDB assembly separates polymer and ligand entities sharing one author chain", async () => {
  const pdb = `REMARK 350 BIOMOLECULE: 1
REMARK 350 APPLY THE FOLLOWING TO CHAINS: A
REMARK 350   BIOMT1   1  1.000000  0.000000  0.000000        0.00000
REMARK 350   BIOMT2   1  0.000000  1.000000  0.000000        0.00000
REMARK 350   BIOMT3   1  0.000000  0.000000  1.000000        0.00000
ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 12.00           C
HETATM    2  C1  BTN A 101       2.000   2.000   3.000  1.00 12.00           C
END
`;
  const result = await materializeBiologicalAssembly(pdb, "pdb", "1");
  const output = await readFrame(result.cif), atoms = output.categories.atom_site, chains = output.categories.struct_asym;
  expect([result.atomCount, result.chainCount]).toEqual([2, 2]);
  for (let row = 0; row < 2; row++) {
    expect(atoms.getField("label_asym_id")!.str(row)).toBe(chains.getField("id")!.str(row));
    expect(atoms.getField("label_entity_id")!.str(row)).toBe(chains.getField("entity_id")!.str(row));
  }
  expect(atoms.getField("label_entity_id")!.str(0)).not.toBe(atoms.getField("label_entity_id")!.str(1));
});
test("repeated arbitrary attributes are limited before output expansion", async () => {
  const input = fixture("(" + Array(1024).fill("1").join(",") + ")").replace("Test assembly", "Budget")
    .replace("_atom_site.group_PDB", "_atom_site.extra\n_atom_site.group_PDB")
    .replace(/^(ATOM|HETATM)/gm, "'" + "x".repeat(9000) + "' $1");
  await expect(materializeBiologicalAssembly(input, "cif", "1")).rejects.toThrow("allocation budget");
  const connectionInput = fixture("(" + Array(1024).fill("1").join(",") + ")") + connection.replace("_struct_conn.id", "_struct_conn.details\n_struct_conn.id").replace("c1 covale", "'" + "x".repeat(20_000) + "' c1 covale");
  // Identical transforms are deduplicated. One long connection remains affordable.
  expect((await materializeBiologicalAssembly(connectionInput, "cif", "1")).atomCount).toBe(2);
});

test("connection attribute expansion obeys the same allocation budget", async () => {
  const ids = Array.from({ length: 100 }, (_, i) => `T${i}`);
  const extra = ids.map((id, i) => `${id} 1 0 0 ${i + 10} 0 1 0 0 0 0 1 0`).join("\n") + "\n";
  const input = fixture(`(${ids.join(",")})`).replace(operators, operators + extra)
    + connection.replace("_struct_conn.id", "_struct_conn.details\n_struct_conn.id").replace("c1 covale", "'" + "x".repeat(200_000) + "' c1 covale");
  await expect(materializeBiologicalAssembly(input, "cif", "1")).rejects.toThrow("allocation budget");
});

test('standard PDB CONECT bonds survive missing label_seq_id when author residue identity is present',async()=>{
 const pdb=`REMARK 350 BIOMOLECULE: 1
REMARK 350 APPLY THE FOLLOWING TO CHAINS: A
REMARK 350   BIOMT1   1  1.000000  0.000000  0.000000        0.00000
REMARK 350   BIOMT2   1  0.000000  1.000000  0.000000        0.00000
REMARK 350   BIOMT3   1  0.000000  0.000000  1.000000        0.00000
ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 12.00           C
HETATM    2  C1  BTN A 101       2.000   2.000   3.000  1.00 12.00           C
HETATM    3  C2  BTN A 101       3.000   2.000   3.000  1.00 12.00           C
CONECT    2    3
END
`;
 const result=await materializeBiologicalAssembly(pdb,'pdb','1');
 const parsed=await parseCifText(result.cif).run();if(parsed.isError)throw Error(parsed.message);
 const output=parsed.result.blocks[0];
 expect({connections:output.categories.struct_conn?.rowCount??0,warnings:result.warnings}).toEqual({connections:1,warnings:[]});
});

test('connection budget includes expanded replacement author-chain identities before encoding',async()=>{
 const author='X'.repeat(5000);
 const fields=['group_PDB','id','type_symbol','label_atom_id','label_comp_id','label_asym_id','label_entity_id','label_seq_id','label_alt_id','Cartn_x','Cartn_y','Cartn_z','occupancy','auth_asym_id','auth_seq_id','pdbx_PDB_model_num'];
 const text=`data_budget
_pdbx_struct_assembly.id 1
_pdbx_struct_assembly_gen.assembly_id 1
_pdbx_struct_assembly_gen.oper_expression 1
_pdbx_struct_assembly_gen.asym_id_list A
_pdbx_struct_oper_list.id 1
_pdbx_struct_oper_list.matrix[1][1] 1
_pdbx_struct_oper_list.matrix[1][2] 0
_pdbx_struct_oper_list.matrix[1][3] 0
_pdbx_struct_oper_list.vector[1] 0
_pdbx_struct_oper_list.matrix[2][1] 0
_pdbx_struct_oper_list.matrix[2][2] 1
_pdbx_struct_oper_list.matrix[2][3] 0
_pdbx_struct_oper_list.vector[2] 0
_pdbx_struct_oper_list.matrix[3][1] 0
_pdbx_struct_oper_list.matrix[3][2] 0
_pdbx_struct_oper_list.matrix[3][3] 1
_pdbx_struct_oper_list.vector[3] 0
loop_
${fields.map(f=>'_atom_site.'+f).join('\n')}
ATOM 1 C CA GLY A 1 1 . 1 2 3 1 ${author} 1 1
ATOM 2 N N GLY A 1 1 . 2 2 3 1 ${author} 1 1
loop_
_struct_conn.id
_struct_conn.conn_type_id
_struct_conn.ptnr1_label_asym_id
_struct_conn.ptnr1_label_seq_id
_struct_conn.ptnr1_label_atom_id
_struct_conn.ptnr1_auth_asym_id
_struct_conn.ptnr2_label_asym_id
_struct_conn.ptnr2_label_seq_id
_struct_conn.ptnr2_label_atom_id
_struct_conn.ptnr2_auth_asym_id
${Array.from({length:6500},(_,i)=>`c${i} covale A 1 CA ? A 1 N ?`).join('\n')}
`;
 await expect(materializeBiologicalAssembly(text,'cif','1')).rejects.toThrow('allocation budget');
});
