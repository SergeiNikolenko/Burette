# Implementation Phases

## Phase 0: Runtime Spike

Goal: prove that a controlled Python runner can calculate a small 2D descriptor
set from molfile, SDF, and SMILES payloads.

Deliverables:

- uv-managed development runtime,
- minimal descriptor runner,
- structured JSON output,
- import checks for RDKit and Mordred,
- no UI changes beyond developer-only verification.

Exit criteria:

- `.mol`, single-record `.sdf`, and SMILES payload smoke tests pass.
- Missing and error descriptor values are represented explicitly.

## Phase 1: Single-Molecule Descriptor Tab

Goal: add the right-dock `Descriptors` tab for active small molecules.

Deliverables:

- `descriptors` dock tab kind and panel,
- source eligibility for `.mol` and single-record `.sdf`/`.sd`,
- Ketcher sketch payload bridge from React to Rust,
- single-molecule descriptor cache,
- 2D `basic-2d` preset,
- unsupported-state messages.

Exit criteria:

- Descriptor tab works for `.mol`, single-record `.sdf`, and Ketcher sketch.
- Ketcher calculations include explicit molfile or SMILES payload.
- Unsupported PDB/mmCIF contexts are disabled with clear reasons.

## Phase 2: Collection Descriptor Runs

Goal: calculate descriptors for grid collections without persistent reopen
guarantees.

Deliverables:

- collection descriptor job,
- runtime-local descriptor storage in the grid database,
- exposed grid row id for descriptor results,
- run progress and cancellation,
- selected-row descriptor details in the right dock.

Exit criteria:

- Multi-record SDF collection can calculate `basic-2d`.
- One-row and multi-row SMILES files work through the grid route.
- Descriptor values remain correct after pagination during the same runtime.

## Phase 3: Descriptor Table And Filters

Goal: make descriptors useful for collection analysis.

Deliverables:

- `Cards` and `Table` grid view switch,
- descriptor column schema,
- selected descriptor columns,
- typed descriptor filters,
- descriptor sorting,
- stable secondary sort,
- visible-row CSV export.

Exit criteria:

- Numeric range filters change `grid_fetch_page` results.
- Descriptor sort is stable across pages.
- Cards and table reflect the same active filters.

## Phase 4: Release Packaging

Goal: ship descriptors without relying on the user's Python installation.

Deliverables:

- bundled descriptor runtime,
- codesigned Python/native libraries,
- release preflight,
- packaged app smoke test.

Exit criteria:

- Packaged app imports RDKit and Mordred from app resources.
- Packaged app calculates a descriptor summary for a small `.mol`.
- No global Python or PATH dependency is required.

## Deferred

- persistent collection descriptor cache across reopen,
- 3D descriptors,
- automatic ligand extraction from PDB/mmCIF,
- Quick Look descriptor calculation,
- spreadsheet-style editing of descriptor tables.
