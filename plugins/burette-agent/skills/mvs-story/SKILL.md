---
name: mvs-story
description: "Use when creating, validating, opening, observing, or navigating a multi-step MolViewSpec Story in Burette."
---

# MolViewSpec Story

Use Story as the primary agent-to-user explanation surface when a molecular
task benefits from a sequence: overview, target or pocket, ligand pose,
contacts, comparison, and conclusion. A Story is not a list of viewer clicks.
It is a reproducible MolViewSpec object with `kind: "multiple"` and one complete
scene tree per snapshot.

## Workflow

1. Call `burette.list_story_templates`. Reuse the closest installed scaffold
   when its scientific purpose matches; otherwise write a short storyboard
   before generating JSON. Give every step one scientific purpose and one
   user-facing conclusion.
2. For a matching scaffold, call `burette.create_story_from_template` with all
   required variables and local resources. Treat the result as a starting
   point: replace generic prose with observed evidence and preserve its
   scientific caveats.
3. For nodes or features not already demonstrated by the template, read
   [the bundled authoring reference](references/molviewspec-authoring.md), then
   call `burette.get_mvs_authoring_reference` for the scene or animation
   overview and each unfamiliar node. This returns the exact contract from the
   Mol* version installed with Burette instead of relying on recalled syntax.
4. Build or customize a complete `root` scene for every snapshot. Keep selectors,
   representations, colors, labels, primitives, and camera settings inside the
   snapshot so any step can be loaded independently.
5. Give every snapshot a unique stable `key`, concise `title`, markdown
   `description`, `linger_duration_ms`, and `transition_duration_ms`.
6. When authoring without a template, call `burette.create_story` with the Story and an output ending in `.mvsj`
   or `.mvsx`. For local or relative resources, pass a `resources` mapping and
   use `.mvsx`; do not hand off a broken standalone `.mvsj`.
7. Call `burette.validate_story` on the resulting file.
8. Open it with `burette.open_workspace`, open the returned Browser URL when
   required, and wait for workspace readiness.
9. Call `burette.observe_story`. Confirm the title, step count, current key,
   description, and playback state.
10. Exercise `burette.control_story` with at least `next` and `previous`; use
   `goto`, `play`, and `pause` when the user asked for them.
11. Run Browser visual QA on the first step and one transitioned step. A valid
   JSON file alone does not prove that structures, labels, or resources render.

## Documentation boundary

The bundled reference covers every main upstream MolViewSpec documentation
area and links to the official pages. The reference tool is the version-matched
source of truth for supported nodes and parameters. Upstream tutorials and
demos remain external and should be consulted only when the task needs their
prose or runnable examples; do not inject the full website into every agent
turn.

## Installed Templates

- `structure-overview`: global fold to ligand context.
- `binding-site-tour`: overview, pocket focus, and evidence-qualified interpretation.
- `docking-pose-comparison`: receptor, two poses with required computed key-interaction
  primitive layers, matching endpoint-residue annotations, compact element-aware
  ball-and-stick ligands, and a consistently encoded overlay.
- `aligned-structure-comparison`: reference, candidate, and overlay; inputs must
  already share a coordinate frame.

The template catalog declares variables, storyboard purpose/evidence, and
caveats. Templates do not compute contacts, docking confidence, affinity,
alignment, RMSD, or trajectory metrics. The docking comparison refuses to
package without explicit interaction resources, endpoint-residue annotations,
and evidence summaries for both poses, but those inputs still must come from a
named calculation with method status, units, and uncertainty in the step text.

## Authoring Shape

`burette.create_story` accepts either a standard MolViewSpec multi-state object
or a compact authoring object:

```json
{
  "title": "Binding-site tour",
  "description": "Protein-ligand interaction walkthrough",
  "steps": [
    {
      "key": "overview",
      "title": "Complex overview",
      "description": "# Overview\nProtein and ligand in context.",
      "root": {
        "kind": "root",
        "children": []
      },
      "lingerDurationMs": 8000,
      "transitionDurationMs": 1000
    }
  ]
}
```

The tool normalizes this into:

```json
{
  "kind": "multiple",
  "metadata": {
    "title": "Binding-site tour",
    "timestamp": "...",
    "version": "1"
  },
  "snapshots": []
}
```

## Resource Rules

- Use only absolute HTTP(S) or data URLs in portable `.mvsj` files.
- Prefer `.mvsx` for local PDB, mmCIF, SDF, volume, annotation, or other
  sidecar resources.
- Resource keys in `resources` must exactly match relative `download.url`
  values in the scene trees; a leading `./` is normalized for compatibility
  with Mol* exports.
- External resources may use HTTP(S) or bounded data URLs. `file:` URLs and
  absolute filesystem paths are rejected; package those files in MVSX.
- Archive paths cannot be absolute, empty, contain backslashes, or traverse
  with `.` or `..`.
- Creation refuses to overwrite an existing output unless the user explicitly
  requests replacement.

## Story Controls

Use `burette.observe_story` for typed state. Use
`burette.control_story` with:

- `next` or `previous`;
- `goto` plus `index`, `key`, or snapshot `id`;
- `play` with optional `restart`;
- `pause`.

The Burette Story dock mirrors the current Mol* snapshot and exposes visible
Previous, Play/Pause, and Next controls. Do not substitute DOM clicks when the
typed tools are available.

## Completion Gate

Complete only when:

- validation returns `ok: true`;
- every relative resource is present in MVSX;
- the workspace and viewer report ready;
- `observe_story.available` is true and `stepCount` matches the storyboard;
- next/previous returns the expected step metadata;
- Browser shows a nonblank molecular scene for at least two steps.
