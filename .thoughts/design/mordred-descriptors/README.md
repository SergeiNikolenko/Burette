# Mordred Descriptors

Date: 2026-06-13

## Goal

Add a first-class small-molecule descriptor layer to Burrete using
`mordredcommunity` as the descriptor engine. The feature must work beyond the
2D grid: it should cover every Burrete context where a small molecule is the
active object and Ketcher is already a meaningful editor or viewer companion.

## Scope

Supported first-version sources:

- Single small-molecule documents: `.mol`, single-record `.sdf` or `.sd`, and
  selected records from `.smi` or `.smiles` grids.
- Collection documents where Burrete already uses the `grid2d` runtime, mostly
  multi-record SDF and SMILES-backed grids. SMILES files remain grid-routed in
  the first version, even when the file contains only one molecule.
- The current Ketcher sketch when it can be exported as molfile or SMILES.
- A selected row or selected record inside a collection, when the grid can
  provide stable record identity.

Explicit first-version non-goals:

- Protein, biopolymer, PDB, mmCIF, trajectory, volumetric, and docking-pose
  descriptor calculation.
- Automatic ligand extraction from protein structures.
- 3D descriptors by default.
- Quick Look descriptor calculation.
- A separate descriptor application surface outside the existing Burrete shell.

## Product Shape

Descriptors should appear as a new right-dock tab named `Descriptors`. The tab
is context-aware:

- For a supported single molecule, it shows runtime status, calculate controls,
  key descriptor values, missing/error counts, and export/copy actions.
- For a supported collection, it shows run status, descriptor presets, filters,
  selected columns, and selected-record details.
- For an unsupported document, it explains why descriptors are unavailable.

Collections also need a table view in the main grid surface. Descriptor filters
belong in the right dock, but their results should affect both card and table
views. Cards should show only a small set of selected descriptor chips.

## Design Documents

- [Research](./research.md)
- [Architecture](./01-architecture.md)
- [UX Behavior](./02-ux-behavior.md)
- [Data Model](./03-data-model.md)
- [API Contract](./04-api-contract.md)
- [Runtime And Packaging](./05-runtime-packaging.md)
- [Risks](./06-risks.md)
- [Testing](./07-testing.md)
- [Implementation Phases](./08-implementation-phases.md)

## Decision Summary

- Use `mordredcommunity` as the descriptor calculator.
- Prefer `uv` for the managed Python runtime, because Burrete already has a
  uv-shaped bundled Python runtime pattern for `xyzrender`.
- Keep `pixi` as a fallback or future packaging option, not the primary path.
- Start with 2D descriptors only.
- Make descriptors a desktop-app feature first; do not run heavy descriptor
  jobs inside Quick Look.
- Store collection descriptors in the grid runtime database and single-molecule
  descriptors in an application descriptor cache keyed by source hash and
  descriptor engine version. Collection descriptor persistence across reopen is
  deferred until stable record identity is explicitly implemented.
- Add a real table view for descriptor-heavy collections instead of overloading
  cards.
