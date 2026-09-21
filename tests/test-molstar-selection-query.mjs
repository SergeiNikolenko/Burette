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

assert.match(panel, /text: "Add to scene as component"/);
assert.match(panel, /type: "create_component"/);
// A chain row has no componentKind of its own, so the representation is chosen
// from the selector instead - without this a chain came out as ball-and-stick.
assert.match(panel, /compositionComponentKindFromSelector\(componentSelector\)/);
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

// The same act is offered on the viewer's own right click, for whatever is
// selected there rather than only for a row in the panel. Same wording, because
// it is the same thing.
assert.match(viewer, /\['represent:component', 'Add to scene as component'\]/);
assert.match(viewer, /action === 'represent:component'/);
// It sits outside the componentRef check on purpose: the item exists for targets
// that have no component yet.
assert.doesNotMatch(
  viewer,
  /if \(molstarContextComponentRef\(target\)\) \{[^}]*represent:component/
);
// Two presses do make two components - "Current Selection" is a referencesCurrent
// query and Mol* will not fold two of those together, which was measured rather
// than assumed. So the label has to carry something that tells them apart.
assert.match(viewer, /`Selection · \$\{atoms\.toLocaleString\(\)\} \$\{atoms === 1 \? 'atom' : 'atoms'\}`/);
assert.match(viewer, /options: \{ label: componentLabel, checkExisting: true \}/);

console.log("molstar selection query contract ok");
