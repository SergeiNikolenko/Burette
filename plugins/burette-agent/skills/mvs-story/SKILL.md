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
3. Build or customize a complete `root` scene for every snapshot. Keep selectors,
   representations, colors, labels, primitives, and camera settings inside the
   snapshot so any step can be loaded independently.
4. Give every snapshot a unique stable `key`, concise `title`, markdown
   `description`, `linger_duration_ms`, and `transition_duration_ms`.
5. When authoring without a template, call `burette.create_story` with the Story and an output ending in `.mvsj`
   or `.mvsx`. For local or relative resources, pass a `resources` mapping and
   use `.mvsx`; do not hand off a broken standalone `.mvsj`.
6. Call `burette.validate_story` on the resulting file.
7. Open it with `burette.open_workspace`, open the returned Browser URL when
   required, and wait for workspace readiness.
8. Call `burette.observe_story`. Confirm the title, step count, current key,
   description, and playback state.
9. Exercise `burette.control_story` with at least `next` and `previous`; use
   `goto`, `play`, and `pause` when the user asked for them.
10. Run Browser visual QA on the first step and one transitioned step. A valid
   JSON file alone does not prove that structures, labels, or resources render.

## Installed Templates

- `structure-overview`: global fold to ligand context.
- `binding-site-tour`: overview, pocket focus, and evidence-qualified interpretation.
- `docking-pose-comparison`: receptor, two poses, and a consistently encoded overlay.
- `aligned-structure-comparison`: reference, candidate, and overlay; inputs must
  already share a coordinate frame.

The template catalog declares variables, storyboard purpose/evidence, and
caveats. Templates do not compute contacts, docking confidence, affinity,
alignment, RMSD, or trajectory metrics. Add those claims only after a named
calculation and include method status, units, and uncertainty in the step text.

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

- Prefer absolute HTTPS URLs for portable `.mvsj` files.
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
- relative resources are present in MVSX or accessible beside MVSJ;
- the workspace and viewer report ready;
- `observe_story.available` is true and `stepCount` matches the storyboard;
- next/previous returns the expected step metadata;
- Browser shows a nonblank molecular scene for at least two steps.
