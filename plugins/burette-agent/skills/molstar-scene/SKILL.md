---
name: molstar-scene
description: "Use when operating an active Mol* scene through allowlisted Burette actions and typed observe/action results."
---

# Molstar Scene

Use this workflow for scene operations:

- focus ligand;
- label the active selection or a precise component;
- show ligands;
- select residues;
- focus selection;
- compute lightweight contacts;
- hide or show waters;
- show molecular surface;
- color by chain;
- reset camera;
- apply a compact declarative scene schema for target/component requests such
  as highlighting protein, selecting active-site loops, and focusing a named
  selection;
- load a complete MolViewSpec scene payload when the agent already has one;
- translate user requests into MolViewSpec-informed selectors, components,
  representations, color, opacity, labels, camera, focus, and canvas concepts;
- export image or screenshot when supported.

For multi-step narratives, tours, presentations, or explanations, route to
[mvs-story](../mvs-story/SKILL.md). `load_mvs` loads a complete payload, while
the Story workflow also creates, validates, packages, observes, and navigates
the snapshots.

## Contract

For exact native atom selection or numerical geometry, use the revisioned route
through `burette.control_inline_viewer`:

- Query: `{"type":"query_atoms","selectionVersion":1,"expression":{"fields":{"auth_asym_id":"A","auth_seq_id":378}},"limit":32}`.
  Expressions support exact `fields`, `kind`, returned `ids`, `allOf`, `anyOf`
  and `not`. Auth and label identifiers are separate namespaces. Inspect returned
  atom identities, including model/unit/altloc and occupancy; do not infer them.
- Group query: `type: "query_groups"`, `groupBy: residue|chain`, and the same
  expression/version/pagination fields. Read `matchedAtoms`, `wholeGroupAtoms`
  and `partial`. `groupExpression` intentionally selects the whole loaded group;
  intersect it with your original filter to repeat only matching atoms.
  These are loaded unit instances, not reconstructed complete biological entities.
- Spatial selection: `{"within":{"radiusAngstrom":5,"of":{"fields":{"label_comp_id":"PYZ"}}}}`.
  This includes the reference atoms and uses current Cartesian coordinates;
  combine with `not` to exclude them. Occupancy/altloc/H atoms are not implicitly
  filtered. Wrap an expression in `byResidue` or `byChain` for whole loaded groups.
- `{"current":true}` addresses the actual current selection. To freeze it under
  a name, use `type: "named_selection"`, `operation: "save"`, `name`,
  `expression: {current:true}` and current scene/version/revision fields.
  Query through `{"named":"name"}`; list/delete use the same action's operation.
  Replacement requires `overwrite:true`. Missing atoms fail rather than shrink
  a saved selection. Names are viewer-instance bookmarks, not durable projects.
- Continue at `nextOffset` with the same expression, returned `sceneId` and
  `expectedRevision`. A stale revision requires a fresh query, not a blind retry.
- Select: `type: "select_atoms"`, `selectionVersion: 1`, the returned `sceneId`,
  `expectedRevision`, `expression`, and `mode: set|add|subtract|intersect`.
  `dryRun: true` validates without changing selection; use a JSON boolean.
- Measure: `type: "measure_geometry"`, the same scene/revision fields,
  `measurement: distance|angle|dihedral`, and exactly 2/3/4 distinct ordered
  `atomIds` from the query. Read the returned endpoints, units and warnings.
  This does not create persistent measurement labels or classify chemical bonds.
- Layers: use `type:"list_scene_layers"`, `selectionVersion:1` to inspect owned
  layers. `type:"patch_scene_layers"` additionally requires current scene/revision
  and 1–8 operations, each with a unique `layerId` and `type:create|update|delete`.
  Create needs an exact `structureId`, `expression` and `appearance`, for example
  `{type:"ball-and-stick",color:{name:"uniform",value:"#ff8800"},opacity:1}`.
  Other styles: cartoon, spacefill, line; other colors: element-symbol, chain-id.
  Update preserves omitted appearance; a changed expression requires structureId.
  Delete accepts only type/layerId. Optional label names the layer (not 3D text);
  visible is boolean. IDs match `[a-z][a-z0-9_-]{0,47}`. Boolean dryRun validates
  without changes. Wait for applied:true and inspect returned actual layers.
  The whole patch is one data-tree Undo entry with rollback, not a camera/selection
  transaction or isolation from direct UI writers. Foreign dependencies block
  edits. Maximum 32 layers and 50000 atoms per layer; empty selections fail.

Limits: 32 output atoms per page, 250000 atomic input atoms, expression depth 8
and 128 nodes. Queries fail on non-atomic/oversized scenes rather than truncating
calculation input. Scene IDs expire with their viewer instance. UI camera,
selection and state edits invalidate revisions. Legacy `apply_scene` is neither
atomic nor available through the native allowlist; do not substitute it for
this contract or claim full scene/project parity from these commands.

For the native/inline MCP App, send these actions through
`burette.control_inline_viewer` with its `sessionId`; inspect the returned
acknowledged status and `observe_inline_viewer.scene`. For Browser workspaces,
use `burette.control_viewer` or the CLI below.

- `{"type":"color_by_chain","palette":["#34c759","#af52de"]}` colors
  chains green and purple in Mol* author-chain order, repeating for additional
  chains. Palette accepts 1–32 `#RRGGBB` colors. Preserve the current session,
  camera and tabs; this is not a source-code edit. Observe actual layer palettes
  after acknowledgement. This is an ordered palette, not a named chain mapping;
  do not claim an explicit A/B assignment without verifying chain order.

- `{"type":"set_scene_motion","mode":"spin","speed":0.1}`; modes
  `off`, `spin` (0.01–1/s), `rock` (0.02–1.5/s).
- `{"type":"set_scene_wiggle","mode":"even"}`; modes `off`, `even`,
  `uncertainty`. This is procedural representation motion, not MD or normal modes.
- `{"type":"rotate_camera","axis":[0,1,0],"angleDegrees":30}` changes
  the camera only, not molecular coordinates.
- `{"type":"observe_scene"}` returns bounded actual layers, colors,
  camera, motion and wiggle settings.

`set_molstar_style` waits for the existing preset controller; a failed,
superseded or rolled-back application must not be reported as successful.

Use one typed action surface:

```bash
bun scripts/burette-agent.mjs act --session-dir <dir> '{"type":"hide_waters"}' --wait-ms 12000
```

For `browser-agent-shell`, use the `sessionDir` returned by
`open --mode browser-agent-shell`; the browser shell polls that session over its
local dev-server endpoint and relays actions to the active Mol* iframe. Do not
use Browser DOM clicks for scene edits when this session contract is available.
If the user is already looking at a browser-agent-shell URL and the session
directory is not in context, pass that URL directly with `--url`; the CLI will
resolve the shell session through `/__burette/agent-session/session.json` when
the shell is alive.

Do not add one endpoint per Mol* command. The action body must be allowlisted
and serializable.

## MolViewSpec-informed scene language

Use MolViewSpec as the mental model for agent scene requests, but keep two
execution paths separate:

- `apply_scene` edits the currently active Burette/Mol* viewer by relaying
  allowlisted commands. Use it for highlight, select, focus, contact
  neighborhood, water/surface/theme toggles, screenshot, and reset camera.
- `load_mvs` loads a complete MolViewSpec state (`mvsj` JSON or `mvsx` archive)
  through Mol* `loadMvsData`. Use it when the request really needs a full
  MVS tree: download/parse/structure/transform/component/representation/color/
  opacity/label/tooltip/focus/camera/canvas/primitives/volume/animation.

Before authoring an unfamiliar full MVS tree, route to the
[Story authoring reference](../mvs-story/references/molviewspec-authoring.md)
and call `burette.get_mvs_authoring_reference`. Request the overview first and
then one exact node contract at a time. Do not guess parameters from memory.

Map natural language to these MVS concepts:

- component: what atoms/residues/chains are affected.
- representation: how that component is drawn, e.g. `cartoon`,
  `ball_and_stick`, `line`, `spacefill`, `surface`.
- color/opacity: visual emphasis for the component or a sub-selection.
- label/tooltip: textual annotation for a component.
- focus: camera fit to a component.
- camera: explicit root-level camera orientation (`target`, `position`, `up`).
- canvas: global view settings such as background color.
- transform/instance: coordinate movement or duplicated transformed instances;
  only promise this through a full MVS scene, not through quick `apply_scene`.

Selectors follow MolViewSpec vocabulary. Prefer these static selectors when
they match the request:

```json
"all" | "polymer" | "protein" | "nucleic" | "branched" | "ligand" | "ion" | "water"
```

For precise requests, use an object selector. Prefer `label_*` identifiers when
the file exposes them, but accept `auth_*` when the user names author/PDB
numbering:

```json
{"label_asym_id":"A"}
{"label_asym_id":"A","beg_label_seq_id":45,"end_label_seq_id":58}
{"auth_asym_id":"A","beg_auth_seq_id":100,"end_auth_seq_id":112}
{"label_comp_id":"PYZ"}
{"comp_id":"PYZ"}
{"label_asym_id":"A","label_seq_id":377,"label_atom_id":"CA"}
```

Use an array of selector objects as a union, e.g. multiple chains or separated
loop ranges.

`apply_scene` accepts MVS-like components or operations with `selector`/`target`,
optional `label`, optional visual hints, and operation flags:

```bash
bun scripts/burette-agent.mjs act --session-dir <dir> '{
  "type": "apply_scene",
  "components": [
    {"selector": "protein", "label": "Protein", "highlight": true, "color": "#4f8cff"},
    {"selector": {"chain": "A", "range": [45, 58]}, "label": "Active loop", "select": true, "focus": true}
  ]
}' --wait-ms 12000
```

Use these request patterns:

```bash
# Highlight the whole protein.
bun scripts/burette-agent.mjs act --session-dir <dir> '{
  "type": "apply_scene",
  "components": [
    {"selector": "protein", "label": "Protein", "highlight": true, "color": "#4f8cff"}
  ]
}' --wait-ms 12000

# Select and focus an active loop by residue range.
bun scripts/burette-agent.mjs act --session-dir <dir> '{
  "type": "apply_scene",
  "components": [
    {"selector": {"label_asym_id": "A", "beg_label_seq_id": 45, "end_label_seq_id": 58}, "label": "Active loop", "select": true, "focus": true}
  ]
}' --wait-ms 12000

# Focus a ligand and ask for a local protein neighborhood/contacts.
bun scripts/burette-agent.mjs act --session-dir <dir> '{
  "type": "focus_ligand",
  "selector": {"comp_id": "PYZ"},
  "allowAmbiguous": true,
  "showNeighborhood": true,
  "radiusA": 5
}' --wait-ms 12000

# Add a visible 3D label to the last focused/selected ligand.
bun scripts/burette-agent.mjs act --session-dir <dir> '{
  "type": "label_selection",
  "selection": "last",
  "text": "PYZ A:378"
}' --wait-ms 12000

# Reset camera after manual movement.
bun scripts/burette-agent.mjs act --session-dir <dir> '{"type":"reset_camera","args":{"durationMs":250}}' --wait-ms 12000
```

When a user says "move the scene", decide which meaning applies:

- camera movement/orientation: use `focus_selection`, `focus_ligand`,
  `reset_camera`, or `rotate_camera`. Do not simulate this with
  Browser drag events.
- structure movement/rotation/instances: build and load a complete MVS scene
  with `transform` or `instance` nodes via `load_mvs`.

Use `load_mvs` only for complete MolViewSpec (`mvsj` or `mvsx`) payloads that
should be handed to Mol* `loadMvsData` as scene state:

```bash
bun scripts/burette-agent.mjs act --session-dir <dir> '{
  "type": "load_mvs",
  "json": {
    "metadata": {"title": "Protein and ligand view", "version": "1"},
    "root": {"kind": "root", "children": []}
  },
  "options": {"replaceExisting": true}
}' --wait-ms 12000
```

## Upstream References

Ground new scene language in:

- MolViewSpec docs: https://molstar.org/mol-view-spec-docs/
- Tree schema: https://molstar.org/mol-view-spec-docs/tree-schema/
- Selectors: https://molstar.org/mol-view-spec-docs/selectors/
- Camera settings: https://molstar.org/mol-view-spec-docs/camera-settings/
- MolViewSpec repository: https://github.com/molstar/mol-view-spec
- Mol* examples: https://github.com/molstar/molstar/tree/master/src/examples

Relevant local Mol* examples when `node_modules` is installed:

- `node_modules/molstar/lib/examples/basic-wrapper/index.js`
- `node_modules/molstar/lib/examples/proteopedia-wrapper/index.js`
- `node_modules/molstar/lib/examples/interactions/index.js`
- `node_modules/molstar/lib/examples/mvs-stories/stories/`
- `node_modules/molstar/lib/extensions/mvs/camera.js`

## Verification

For the native workspace, use `control_inline_viewer` with
`action: { type: "capture_scene", scope: "auto" }` for a visual self-check.
The response contains an 800×600 PNG of the current Mol* scene and, when one
ligand is selected, a 400×400 RDKit 2D PNG of that same selection. `scope: "ligand"`
requires a selected ligand; first focus an exact ligand with `focus_ligand` when
needed. Capture itself does not move the camera or change selection. Use
`scope: "scene"` to omit 2D. Check `depiction.status`: unavailable is a partial
visual result, not a valid 2D image. Coordinate-only inputs can have inferred
bond orders, so the depiction is not independent chemical identity evidence.
Use the images alongside typed observation, not instead of it. To verify live
layer colors, send `action: { type: "observe_scene" }`; the lightweight
`observe_inline_viewer` is not the full layer readback.

After scene actions, run `observe` and inspect the action result. Use Browser or
Computer only for visual confirmation. If the active fixture has no waters,
`hide_waters` should return a successful typed no-op such as `componentCount: 0`
instead of a false failure.

For browser-agent-shell and desktop sessions, check `observe.scene.selection`
first. It reports the last known selection/focused ligand with `selectionId`,
ligand identity, and counts when the active viewer returned them.

Ligand focus can be a partial success. If `showNeighborhood` cannot resolve a
protein/contact target, the action should still succeed when the ligand was
selected/focused and return `neighborhood.ok: false` with a typed error. Do not
retry the whole focus just because contacts failed.

## Unsupported Cases

If a selector cannot resolve, return or report typed failures such as
`SELECTION_EMPTY` or `NO_STRUCTURE`. Do not guess from screenshots.

Persistent overpaint and arbitrary representation graph rewriting are not yet a
general `apply_scene` guarantee. If durable representation, opacity, labels,
tooltips, primitives, volumes, animations, or coordinate transforms are required,
prefer a full `load_mvs` payload or implement a new allowlisted
`BuretteSceneActions` handler first.
