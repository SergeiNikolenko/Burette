---
name: molstar-scene
description: "Operate the active Mol* scene through allowlisted Burrete agent actions and typed observe/action results."
---

# Molstar Scene

Use this workflow for scene operations:

- focus ligand;
- show ligands;
- select residues;
- focus selection;
- compute lightweight contacts;
- hide or show waters;
- show molecular surface;
- color by chain;
- reset camera;
- export image or screenshot when supported.

## Contract

Use one typed action surface:

```bash
bun scripts/burrete-agent.mjs act --session-dir <dir> '{"type":"hide_waters"}' --wait-ms 12000
```

Do not add one endpoint per Mol* command. The action body must be allowlisted
and serializable.

## Verification

After scene actions, run `observe` and inspect the action result. Use Browser or
Computer only for visual confirmation. If the active fixture has no waters,
`hide_waters` should return a successful typed no-op such as `componentCount: 0`
instead of a false failure.

## Unsupported Cases

If a selector cannot resolve, return or report typed failures such as
`SELECTION_EMPTY` or `NO_STRUCTURE`. Do not guess from screenshots.
