#!/usr/bin/env node
// The expected atom counts here are not invented: each was produced by building
// the query as a real Mol* component against samples/structures/proteins/1htb.pdb
// and reading the component's elementCount, then checked against the number the
// composition panel prints for the same row. They are recorded as comments so a
// future change to the mapping can be re-checked the same way.
import assert from "node:assert/strict";

const { pymolQueryForSelector } = await import("../apps/desktop/src/lib/molstar-selection-query.ts");

// Group rows. Mol* builds the same four components itself, so these agree with
// the scene tree by construction: polymer 5552, solvent 142, inorganic 5.
assert.equal(pymolQueryForSelector({ kind: "polymer" }), "polymer");
assert.equal(pymolQueryForSelector({ kind: "water" }), "solvent");
assert.equal(pymolQueryForSelector({ kind: "ion" }), "inorganic");
assert.equal(pymolQueryForSelector({ kind: "ligand" }), "organic");

// A polymer chain. `chain A` alone is 2913 atoms because it sweeps up the ligands
// and waters that share the chain id; `polymer and chain A` is 2776, which is the
// figure the Chain A row prints. The kind term is what makes the two agree.
assert.equal(pymolQueryForSelector({ kind: "polymer", auth_asym_id: "A" }), "polymer and chain A");

// A ligand instance: 44 atoms, matching "NAD A 377 · 44 atoms".
assert.equal(
  pymolQueryForSelector({ kind: "ligand", label_comp_id: "NAD", auth_asym_id: "A", auth_seq_id: 377 }),
  "organic and resn NAD and chain A and resi 377"
);
// 6 atoms, matching "PYZ B 378 · 6 atoms".
assert.equal(
  pymolQueryForSelector({ kind: "ligand", label_comp_id: "PYZ", auth_asym_id: "B", auth_seq_id: 378 }),
  "organic and resn PYZ and chain B and resi 378"
);

// An ion species: 4 zinc, 1 chloride.
assert.equal(pymolQueryForSelector({ kind: "ion", label_comp_id: "ZN" }), "inorganic and resn ZN");
assert.equal(pymolQueryForSelector({ kind: "ion", label_comp_id: "CL" }), "inorganic and resn CL");

// Whole-structure selectors collapse to one term rather than repeating it.
assert.equal(pymolQueryForSelector({ kind: "all" }), "all");
assert.equal(pymolQueryForSelector({ structure: "primary" }), "all");

// Several values for one field become an or-group, parenthesised so it cannot
// bind loosely against the terms around it.
assert.equal(
  pymolQueryForSelector({ kind: "polymer", auth_asym_id: ["A", "B"] }),
  "polymer and (chain A or chain B)"
);

// Null is the answer whenever the query would be wider than the row. A component
// holding more atoms than the row it came from is worse than no component.
assert.equal(pymolQueryForSelector(null), null);
assert.equal(pymolQueryForSelector({}), null);
// An insertion code has no checked spelling in this transpiler.
assert.equal(
  pymolQueryForSelector({ kind: "ligand", label_comp_id: "NAG", auth_seq_id: 1, pdbx_PDB_ins_code: "A" }),
  null
);
// An unmapped kind, and an unmapped field.
assert.equal(pymolQueryForSelector({ kind: "nucleic" }), null);
assert.equal(pymolQueryForSelector({ kind: "polymer", type_symbol: "ZN" }), null);
// Values that could break out of the query are refused rather than escaped.
assert.equal(pymolQueryForSelector({ kind: "polymer", auth_asym_id: "A or polymer" }), null);
assert.equal(pymolQueryForSelector({ kind: "ligand", label_comp_id: "" }), null);

// The query is only useful if something builds a component from it, so the path
// from the row's menu to the viewer is pinned here too.
const { readFile } = await import("node:fs/promises");
const { fileURLToPath } = await import("node:url");
const { dirname, join } = await import("node:path");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

const panel = await read("apps/desktop/src/components/structure-info-panel.tsx");
const viewer = await read("PreviewExtension/Web/viewer.js");
const composition = await read("apps/desktop/src/lib/structure-composition.ts");

assert.ok(!panel.includes('text: "Add to scene as component"'));
assert.match(composition, /type: "create_component";/);
assert.match(viewer, /createComponent: createMolstarComponentFromQuery/);
assert.match(viewer, /if \(type === 'create_component'\)/);
// PyMOL, not mol-script: the reason is load-bearing, so it stays written down.
assert.match(viewer, /language: 'pymol', expression: query/);
// The helper hands back a whole parameter object; wrapping it again in `{ type }`
// silently produced a component with no representation at all.
assert.match(viewer, /addRepresentation\(component, representation, \{ tag: 'burette-selection' \}\)/);
// nullIfEmpty is what stops an unmatched selector leaving an empty row behind.
assert.match(viewer, /nullIfEmpty: true,\s*\n\s*label\s*\n?\s*\}, key, 'burette-selection'\)/);

// Two presses do make two components - "Current Selection" is a referencesCurrent
// query and Mol* will not fold two of those together, which was measured rather
// than assumed. So the label has to carry something that tells them apart.
assert.match(viewer, /`Selection · \$\{atoms\.toLocaleString\(\)\} \$\{atoms === 1 \? 'atom' : 'atoms'\}`/);
assert.match(viewer, /options: \{ label: componentLabel, checkExisting: true \}/);

console.log("molstar selection query contract ok");

const { compositionSceneAction } = await import("../apps/desktop/src/lib/composition-scene-actions.ts");
const chainRow = {
  label: "Chain A", value: "374 residues / 2776 atoms",
  action: { type: "select_residues", label: "Select chain A", selector: { kind: "polymer", auth_asym_id: "A" }, granularity: "residue" },
};
for (const operation of ["hide", "show", "remove"]) {
  assert.deepEqual(compositionSceneAction(chainRow, operation), {
    type: `${operation}_components`,
    label: `${operation[0].toUpperCase()}${operation.slice(1)} chain a`,
    kind: "polymer", query: "polymer and chain A", componentLabel: "Chain A",
  });
}
const ligandRow = {
  label: "NAD B 377", value: "44 atoms",
  action: { type: "focus_ligand", label: "Focus NAD B 377", selector: { kind: "ligand", label_comp_id: "NAD", auth_asym_id: "B", auth_seq_id: 377 } },
};
assert.equal(compositionSceneAction(ligandRow, "remove").query, "organic and resn NAD and chain B and resi 377");
assert.deepEqual(compositionSceneAction({ ...chainRow, label: "Polymers", action: { ...chainRow.action, selector: { kind: "polymer" } } }, "hide"), {
  type: "hide_components", label: "Hide polymers", kind: "polymer", query: "polymer", componentLabel: "Polymers",
});
assert.equal(compositionSceneAction({ ...ligandRow, action: { ...ligandRow.action, selector: { ...ligandRow.action.selector, pdbx_PDB_ins_code: "A" } } }, "remove"), null,
  "an inexact query must not fall back to removing every ligand");
assert.equal(compositionSceneAction({ label: "Metadata", value: "1" }, "hide"), null);
console.log("composition row scene actions ok");

const { compositionStyleMenu } = await import("../apps/desktop/src/components/composition-style-menu.ts");
const edits = [];
const menu = compositionStyleMenu(chainRow, action => edits.push(action));
menu.find(item => item.id === "component-opacity").items.find(item => item.text === "50%").action();
menu.find(item => item.id === "component-tint").action("#e85d5d");
assert.deepEqual(edits, [
  { type: "edit_components", label: "Update Chain A", query: "polymer and chain A", componentLabel: "Chain A", kind: "polymer", edit: { operation: "opacity", value: 0.5 } },
  { type: "edit_components", label: "Update Chain A", query: "polymer and chain A", componentLabel: "Chain A", kind: "polymer", edit: { operation: "color", value: "#e85d5d" } },
]);
assert.deepEqual(compositionStyleMenu({ ...ligandRow, action: { ...ligandRow.action, selector: { ...ligandRow.action.selector, pdbx_PDB_ins_code: "A" } } }, () => {}), []);
console.log("composition style menu routing ok");

// Exercise the viewer snapshot against real Mol* loci: hidden objects remain,
// removed subsets disappear, overlapping components do not double the counts,
// and an empty scene still sends the snapshot needed to clear the inspector.
const { Structure, StructureElement } = await import("molstar/lib/commonjs/mol-model/structure.js");
const { parsePDB } = await import("molstar/lib/commonjs/mol-io/reader/pdb/parser.js");
const { trajectoryFromPDB } = await import("molstar/lib/commonjs/mol-model-formats/structure/pdb.js");
const parsed = await parsePDB(await read("samples/mini.pdb")).run();
assert.equal(parsed.isError, false);
const trajectory = await trajectoryFromPDB(parsed.result).run();
const structure = Structure.ofModel(trajectory.representative);
const loci = Structure.toStructureElementLoci(structure);
const component = data => ({ cell: { obj: { data }, state: { isHidden: false } }, representations: [{ cell: { state: { isHidden: false } } }] });
const first = component(structure);
const hierarchy = { cell: { obj: { data: structure } }, components: [first, component(structure)] };
let structures = [hierarchy];
const snapshots = [];
const reportStart = viewer.indexOf("  function reportMolstarCompositionVisibility()");
const reportEnd = viewer.indexOf("  function queueMolstarQueryComponentAction(", reportStart);
const report = new Function("activeMolstarViewer", "molstarCurrentStructures", "molstarStructureRuntime", "compositionQueryLoci", "sceneTreeColorState", "sceneTreeColorHex", "post", `
  const molstarCompositionQueries = new Map([['polymer', new Set()]]);
  let molstarCompositionVisibilitySignature = '';
  ${viewer.slice(reportStart, reportEnd)}
  return reportMolstarCompositionVisibility;
`)(() => ({ plugin: { canvas3d: {} } }), () => structures, () => ({ Structure, StructureElement }),
  () => loci, () => ({ value: NaN }), () => null, (_, __, value) => snapshots.push(value.rows[0]));
const whole = { query: "polymer", present: true, counts: { atoms: 9, residues: 2, chains: 1, types: 2 }, hidden: false, color: null };
report();
assert.deepEqual(snapshots.at(-1), whole);
hierarchy.components = [first];
first.cell.state.isHidden = true;
report();
assert.deepEqual(snapshots.at(-1), { ...whole, hidden: true });
const fragment = StructureElement.Loci.toStructure(StructureElement.Loci(structure, [{ unit: structure.units[0], indices: Int32Array.from([0, 1, 2, 3]) }]));
hierarchy.components = [component(fragment)];
report();
assert.deepEqual(snapshots.at(-1), { ...whole, counts: { atoms: 4, residues: 1, chains: 1, types: 1 } });
hierarchy.components = [];
report();
assert.deepEqual(snapshots.at(-1), { ...whole, present: false, hidden: true, counts: { atoms: 0, residues: 0, chains: 0, types: 0 } });
hierarchy.components = [component(structure)];
report();
assert.deepEqual(snapshots.at(-1), whole, "Undo restores the same row and counts");
structures = [];
report();
assert.equal(snapshots.at(-1).present, false, "removing the last structure must clear Composition");

const { compositionRowFromScene } = await import("../apps/desktop/src/lib/composition-scene-state.ts");
const row = { label: "Polymers", value: "2 chains / 748 residues / 5552 atoms" };
assert.deepEqual(compositionRowFromScene(row), row, "a missing snapshot is not deletion");
assert.equal(compositionRowFromScene(row, snapshots.at(-1)), null);
assert.deepEqual(compositionRowFromScene(row, whole), { label: "Polymers", value: "1 chain / 2 residues / 9 atoms" });
assert.deepEqual(compositionRowFromScene(row, { present: true, counts: { atoms: -1 } }), row);
console.log("live Composition distinguishes hidden, removed and restored rows with exact union counts");
