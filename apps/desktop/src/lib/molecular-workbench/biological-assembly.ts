import { parseCifText } from "molstar/lib/mol-io/reader/cif/text/parser.js";
import { parsePDB } from "molstar/lib/mol-io/reader/pdb/parser.js";
import { pdbToMmCif } from "molstar/lib/mol-model-formats/structure/pdb/to-cif.js";
import type { CifCategory, CifFrame } from "molstar/lib/mol-io/reader/cif/data-model.js";
import { CifWriter } from "molstar/lib/mol-io/writer/cif.js";

import { assemblyChainKey, writeAssemblyConnections } from "./assembly-connections";

export type AssemblyFormat = "pdb" | "cif";
type Transform = { rotation: number[][]; translation: number[] };
type Generator = { chains: string[]; transforms: Transform[] };
export type AssemblyChoice = { id: string; details: string; copies: number };
const MAX_ATOMS = 250_000;
const MAX_COPIES = 1024;
const identity = (): Transform => ({ rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] });
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const apply = (t: Transform, p: number[]) => t.rotation.map((row, i) => dot(row, p) + t.translation[i]);
const compose = (a: Transform, b: Transform): Transform => ({
  rotation: a.rotation.map(row => [0, 1, 2].map(column => dot(row, b.rotation.map(r => r[column])))),
  translation: apply(a, b.translation),
});
function required(category: CifCategory | undefined, name: string, row: number) {
  const field = category?.getField(name);
  if (!field || field.valueKind(row) !== 0 || !field.str(row)) throw new Error(`Assembly data is missing ${category?.name ?? "category"}.${name}.`);
  return field.str(row);
}
function finite(value: string) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new Error("Assembly coordinates and operators require finite numbers.");
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1e6) throw new Error("Assembly coordinates or operators exceed supported bounds.");
  return number;
}
function operatorGroups(expression: string, operators: Map<string, Transform>) {
  if (expression.length > 8192) throw new Error("Assembly operation expression is too large.");
  const value = expression.replace(/\s+/g, "");
  const groups = value.includes("(") ? value.match(/\([^()]+\)/g) : [value];
  if (!groups || groups.join("") !== value || groups.length > 4) throw new Error("Invalid assembly operation expression.");
  let count = 1;
  return groups.map(group => {
    const ids: string[] = [];
    for (const token of group.replace(/[()]/g, "").split(",")) {
      const range = /^(\d+)-(\d+)$/.exec(token);
      if (range) {
        const start = Number(range[1]), end = Number(range[2]);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start >= MAX_COPIES) throw new Error("Assembly operation range exceeds the copy limit.");
        for (let i = start; i <= end; i++) ids.push(String(i));
      } else {
        if (!/^[A-Za-z0-9_]+$/.test(token)) throw new Error("Unsupported assembly operator identifier.");
        ids.push(token);
      }
      if (ids.length > MAX_COPIES) throw new Error("Assembly operation list exceeds the copy limit.");
    }
    count *= ids.length;
    if (count > MAX_COPIES) throw new Error("Assembly operation product exceeds the copy limit.");
    return ids.map(id => {
      const operator = operators.get(id);
      if (!operator) throw new Error(`Unknown assembly operator: ${id}.`);
      return operator;
    });
  });
}

async function readAssemblySource(text: string, format: AssemblyFormat) {
  if (text.length > 20_000_000 || new TextEncoder().encode(text).length > 20_000_000) throw new Error("Assembly input exceeds 20 MB.");
  let frame: CifFrame;
  if (format === "pdb") {
    const parsed = await parsePDB(text).run();
    if (parsed.isError) throw new Error(`Invalid PDB: ${parsed.message}`);
    frame = await pdbToMmCif(parsed.result);
  } else if (format === "cif") {
    const parsed = await parseCifText(text).run();
    if (parsed.isError) throw new Error(`Invalid mmCIF: ${parsed.message}`);
    const blocks = parsed.result.blocks.filter(block => block.categories.atom_site?.getField("Cartn_x"));
    if (blocks.length !== 1) throw new Error("Choose a file with one macromolecular coordinate block.");
    frame = blocks[0];
  } else throw new Error("Assembly input must be PDB or text mmCIF.");
  const sites = frame.categories.atom_site;
  if (!sites?.rowCount || sites.rowCount > MAX_ATOMS) throw new Error("Assembly source requires 1–250,000 atoms.");
  const models = new Set<string>(), chains = new Set<string>();
  for (let row = 0; row < sites.rowCount; row++) {
    models.add(sites.getField("pdbx_PDB_model_num")?.str(row) || "1");
    chains.add(required(sites, "label_asym_id", row));
    for (const axis of ["x", "y", "z"]) finite(required(sites, `Cartn_${axis}`, row));
  }
  const definitions = frame.categories.pdbx_struct_assembly;
  const generators = frame.categories.pdbx_struct_assembly_gen;
  const operations = frame.categories.pdbx_struct_oper_list;
  if (!definitions?.rowCount || !generators?.rowCount || !operations?.rowCount) throw new Error("This file has no explicit biological assembly definition.");
  if (definitions.rowCount > 64 || generators.rowCount > 1024 || operations.rowCount > MAX_COPIES) throw new Error("Assembly metadata exceeds browser limits.");
  const operators = new Map<string, Transform>();
  for (let row = 0; row < operations.rowCount; row++) {
    const id = required(operations, "id", row);
    if (operators.has(id)) throw new Error("Assembly operator identifiers must be unique.");
    const rotation = [1, 2, 3].map(i => [1, 2, 3].map(j => finite(required(operations, `matrix[${i}][${j}]`, row))));
    const translation = [1, 2, 3].map(i => finite(required(operations, `vector[${i}]`, row)));
    const [a, b, c] = rotation;
    const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    if (Math.abs(determinant - 1) > 1e-4 || rotation.some((a, i) => rotation.some((b, j) => Math.abs(dot(a, b) - (i === j ? 1 : 0)) > 1e-4))) throw new Error("Biological assembly operators must be proper rigid rotations.");
    operators.set(id, { rotation, translation });
  }
  const choices: AssemblyChoice[] = [], byId = new Map<string, Generator[]>();
  for (let row = 0; row < definitions.rowCount; row++) {
    const id = required(definitions, "id", row);
    if (byId.has(id)) throw new Error("Assembly identifiers must be unique.");
    byId.set(id, []);
    choices.push({ id, details: definitions.getField("details")?.str(row) ?? "", copies: 0 });
  }
  for (let row = 0; row < generators.rowCount; row++) {
    const id = required(generators, "assembly_id", row), list = byId.get(id);
    if (!list) throw new Error("Assembly generator references an unknown assembly.");
    const selected = required(generators, "asym_id_list", row).split(",").map(chain => chain.trim());
    if (selected.some(chain => !chains.has(chain)) || new Set(selected).size !== selected.length) throw new Error("Assembly generator requires distinct label_asym_id chains from this file.");
    // The rightmost operation acts first, as specified by pdbx_struct_assembly_gen.
    let transforms = [identity()];
    for (const group of operatorGroups(required(generators, "oper_expression", row), operators)) transforms = transforms.flatMap(a => group.map(b => compose(a, b)));
    const choice = choices.find(choice => choice.id === id)!;
    choice.copies += transforms.length;
    if (choice.copies > MAX_COPIES) throw new Error("Assembly exceeds 1,024 operator copies.");
    list.push({ chains: selected, transforms });
  }
  if (choices.some(choice => choice.copies === 0)) throw new Error("Assembly definition has no generators.");
  return { frame, sites, models: [...models], choices, byId };
}

export async function listBiologicalAssemblies(text: string, format: AssemblyFormat) {
  const { choices, models } = await readAssemblySource(text, format);
  return { assemblies: choices, models };
}

/** Materializes an explicit deposited assembly. Does not infer biological symmetry.
 * Every source atom row (including altlocs and zero occupancy) is kept per copy.
 * Crystal symmetry and untransformed geometry annotations are not copied. */
export async function materializeBiologicalAssembly(text: string, format: AssemblyFormat, assemblyId: string, modelNumber?: string) {
  const { frame, sites, models, byId } = await readAssemblySource(text, format);
  const generators = byId.get(assemblyId);
  if (!generators) throw new Error("The selected biological assembly was not found.");
  const model = modelNumber ?? (models.length === 1 ? models[0] : undefined);
  if (!model || !models.includes(model)) throw new Error("Choose one source model for the biological assembly.");
  type Copy = { source: number; chain: string; authorChain: string; point: number[] };
  const copies: Copy[] = [], seen = new Set<string>();
  const chainCopies = new Map<string, { id: string; entity: string; author: string }>();
  const transformations = new Set<string>();
  const selectedRows = Array.from({ length: sites.rowCount }, (_, row) => row).filter(row => (sites.getField("pdbx_PDB_model_num")?.str(row) || "1") === model);
  let predicted = 0, predictedBytes = text.length * 4;
  const plans: (Generator & { rows: number[] })[] = [];
  for (const gen of generators) {
    const chainSelection = new Set(gen.chains);
    const rows = selectedRows.filter(row => chainSelection.has(required(sites, "label_asym_id", row)));
    predicted += rows.length * gen.transforms.length;
    if (predicted > MAX_ATOMS) throw new Error("Expanded biological assembly exceeds 250,000 atoms.");
    // Bound repeated arbitrary atom attributes as well as atom count before allocating
    // any copies. Four bytes per UTF-16 character safely overestimates UTF-8 output.
    predictedBytes += rows.reduce((sum, row) => sum + sites.fieldNames.reduce((size, name) => size + sites.getField(name)!.str(row).length * 4 + 8, 256), 0) * gen.transforms.length;
    if (predictedBytes > 64_000_000) throw new Error("Assembly export exceeds the 64 MB allocation budget.");
    plans.push({ ...gen, rows });
  }
  for (const gen of plans) {
    const rows = gen.rows;
    for (const transform of gen.transforms) {
      const key = JSON.stringify(transform);
      transformations.add(key);
      for (const source of rows) {
        const atomKey = `${source}:${key}`;
        if (seen.has(atomKey)) continue;
        seen.add(atomKey);
        const label = required(sites, "label_asym_id", source);
        const chainKey = assemblyChainKey(label, required(sites, "label_entity_id", source), key);
        let chain = chainCopies.get(chainKey);
        if (!chain) {
          const id = `A${chainCopies.size + 1}`;
          chain = { id, entity: required(sites, "label_entity_id", source), author: `${sites.getField("auth_asym_id")?.str(source) || label}_${id}` };
          chainCopies.set(chainKey, chain);
        }
        const point = apply(transform, ["x", "y", "z"].map(axis => finite(required(sites, `Cartn_${axis}`, source))));
        if (point.some(v => !Number.isFinite(v) || Math.abs(v) > 1e6)) throw new Error("Expanded assembly coordinates exceed supported bounds.");
        copies.push({ source, chain: chain.id, authorChain: chain.author, point });
      }
    }
  }
  if (!copies.length) throw new Error("The assembly selects no atoms from this model.");
  const encoder = CifWriter.createEncoder({ binary: false });
  encoder.startDataBlock("burette_assembly");
  const overrides: Record<string, (row: number) => string> = {
    id: row => String(row + 1), label_asym_id: row => copies[row].chain, auth_asym_id: row => copies[row].authorChain,
    Cartn_x: row => String(copies[row].point[0]), Cartn_y: row => String(copies[row].point[1]), Cartn_z: row => String(copies[row].point[2]),
  };
  const fields = [...new Set([...sites.fieldNames, ...Object.keys(overrides)])].map(name => CifWriter.Field.str(name,
    (row: number) => overrides[name]?.(row) ?? sites.getField(name)!.str(copies[row].source),
    { valueKind: (row: number) => overrides[name] ? 0 : sites.getField(name)!.valueKind(copies[row].source) }));
  encoder.writeCategory({ name: "atom_site", instance: () => ({ fields, source: [{ rowCount: copies.length }] }) });
  const chains = [...chainCopies.values()];
  encoder.writeCategory({ name: "struct_asym", instance: () => ({ fields: [CifWriter.Field.str("id", (i: number) => chains[i].id), CifWriter.Field.str("entity_id", (i: number) => chains[i].entity)], source: [{ rowCount: chains.length }] }) });
  const strandsByEntity = new Map<string, string>();
  for (const chain of chains) strandsByEntity.set(chain.entity, (strandsByEntity.get(chain.entity) ?? "") + (strandsByEntity.has(chain.entity) ? "," : "") + chain.author);
  const polymers = frame.categories.entity_poly;
  if (polymers?.getField("pdbx_strand_id")) for (let row = 0; row < polymers.rowCount; row++) {
    predictedBytes += (strandsByEntity.get(polymers.getField("entity_id")?.str(row) ?? "")?.length ?? 0) * 4 + 8;
    if (predictedBytes > 64_000_000) throw new Error("Assembly export exceeds the 64 MB allocation budget.");
  }
  // These categories describe chemistry/sequence rather than spatial instances.
  for (const name of ["entity", "entity_poly", "entity_poly_seq", "chem_comp", "chem_comp_bond", "chem_comp_atom"]) {
    const category = frame.categories[name];
    if (!category) continue;
    encoder.writeCategory({ name, instance: () => ({ fields: category.fieldNames.map(fieldName => {
      const field = category.getField(fieldName)!;
      if (name === "entity_poly" && fieldName === "pdbx_strand_id") return CifWriter.Field.str(fieldName, (i: number) => strandsByEntity.get(category.getField("entity_id")?.str(i) ?? "") ?? "");
      return CifWriter.Field.str(fieldName, (i: number) => field.str(i), { valueKind: (i: number) => field.valueKind(i) });
    }), source: [{ rowCount: category.rowCount }] }) });
  }
  const warnings = writeAssemblyConnections(encoder, sites, frame.categories.struct_conn,
    selectedRows, chainCopies, transformations, 64_000_000 - predictedBytes);
  if (frame.categories.atom_site_anisotrop?.rowCount) warnings.push("Anisotropic displacement tensors are not exported.");
  const cif = encoder.getData() as string;
  if (new TextEncoder().encode(cif).length > 64_000_000) throw new Error("Assembly export exceeds 64 MB.");
  return { cif, atomCount: copies.length, chainCount: chains.length, assemblyId, modelNumber: model, warnings };
}
