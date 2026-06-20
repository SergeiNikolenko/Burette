---
name: molstar-scene
description: "Operate the active Mol* scene through allowlisted Burrete agent actions and typed observe/action results."
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

## Contract

Use one typed action surface:

```bash
bun scripts/burrete-agent.mjs act --session-dir <dir> '{"type":"hide_waters"}' --wait-ms 12000
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

- `apply_scene` edits the currently active Burrete/Mol* viewer by relaying
  allowlisted commands. Use it for highlight, select, focus, contact
  neighborhood, water/surface/theme toggles, screenshot, and reset camera.
- `load_mvs` loads a complete MolViewSpec state (`mvsj` JSON or `mvsx` archive)
  through Mol* `loadMvsData`. Use it when the request really needs a full
  MVS tree: download/parse/structure/transform/component/representation/color/
  opacity/label/tooltip/focus/camera/canvas/primitives/volume/animation.

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
bun scripts/burrete-agent.mjs act --session-dir <dir> '{
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
bun scripts/burrete-agent.mjs act --session-dir <dir> '{
  "type": "apply_scene",
  "components": [
    {"selector": "protein", "label": "Protein", "highlight": true, "color": "#4f8cff"}
  ]
}' --wait-ms 12000

# Select and focus an active loop by residue range.
bun scripts/burrete-agent.mjs act --session-dir <dir> '{
  "type": "apply_scene",
  "components": [
    {"selector": {"label_asym_id": "A", "beg_label_seq_id": 45, "end_label_seq_id": 58}, "label": "Active loop", "select": true, "focus": true}
  ]
}' --wait-ms 12000

# Focus a ligand and ask for a local protein neighborhood/contacts.
bun scripts/burrete-agent.mjs act --session-dir <dir> '{
  "type": "focus_ligand",
  "selector": {"comp_id": "PYZ"},
  "allowAmbiguous": true,
  "showNeighborhood": true,
  "radiusA": 5
}' --wait-ms 12000

# Add a visible 3D label to the last focused/selected ligand.
bun scripts/burrete-agent.mjs act --session-dir <dir> '{
  "type": "label_selection",
  "selection": "last",
  "text": "PYZ A:378"
}' --wait-ms 12000

# Reset camera after manual movement.
bun scripts/burrete-agent.mjs act --session-dir <dir> '{"type":"reset_camera","args":{"durationMs":250}}' --wait-ms 12000
```

When a user says "move the scene", decide which meaning applies:

- camera movement/orientation: use `focus_selection`, `focus_ligand`,
  `reset_camera`, or a future explicit camera action. Do not simulate this with
  Browser drag events.
- structure movement/rotation/instances: build and load a complete MVS scene
  with `transform` or `instance` nodes via `load_mvs`.

Use `load_mvs` only for complete MolViewSpec (`mvsj` or `mvsx`) payloads that
should be handed to Mol* `loadMvsData` as scene state:

```bash
bun scripts/burrete-agent.mjs act --session-dir <dir> '{
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
`BurreteSceneActions` handler first.
