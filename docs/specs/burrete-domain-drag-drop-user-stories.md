# Burrete Domain Drag-and-Drop User Stories

This document defines Burrete's product-level domain drag-and-drop and
structure-intake behavior. Burrete should accept molecular entities from the
places users already work in - Finder, the open workspace, active viewers,
sidebar cards, tabs, Ketcher, grids, and clipboard text - and resolve each
input into the least surprising domain action without data loss.

The goal is not generic drag-and-drop coverage. The goal is a predictable,
non-destructive molecular intake model:

- one domain resolver contract for all structure-intake surfaces;
- virtual or derived outputs by default, with explicit Save As for persistence;
- explicit choices when a drop has multiple plausible meanings;
- independent per-item success and failure for batch inputs;
- tests that cover each target context before new behavior is added.

## Incremental Delivery Plan

### Milestone 1: Lock Down Current Behavior

Goal: document and test what already works before changing semantics.

Scope:

- empty workspace drops open files as tabs;
- active viewer drops route by context: grid append, xyzrender sheet add,
  docking, Ketcher import, or generic open;
- sidebar cards can act as explicit targets for grid append, docking, and
  sheet add;
- file tabs can be dragged as structure payloads while tab reorder still works;
- empty tab-strip regions open dropped structure batches as document tabs;
- Ketcher can import dropped structures and export sketches to viewer or
  collection;
- mixed supported and unsupported files produce partial success instead of
  blocking the whole open.

Tests:

- unit tests for docking request construction, collection family detection,
  structure payload parsing, and text classification;
- contract tests for active viewer, sidebar card, tab strip, Ketcher, grid, and
  clipboard handlers;
- a manual smoke matrix using small PDB, SDF, XYZ, MOL, CSV, TSV, and TXT
  fixtures.

Exit criteria:

- current behavior is captured in tests and this spec;
- no drop path silently overwrites user files;
- failures show status text with enough detail to diagnose rejected inputs.

### Milestone 2: Introduce a Documented Drop Resolver Contract

Goal: make the implicit routing rule explicit before adding richer UX.

Scope:

- define `DropTargetContext`, `DropSourceContext`, `DropAction`, and
  `DropActionChoice`;
- keep component handlers local where that is the smallest change, while routing
  shared browser, Tauri, paste, sidebar, tab, Ketcher, and grid inputs through
  the same action vocabulary;
- represent ambiguous drops as choices without forcing every high-confidence
  drop through a menu.

Tests:

- table-driven tests for payload plus target combinations;
- explicit tests for priority conflicts such as SDF onto grid, SDF onto
  receptor, SDF onto xyzrender sheet, SDF onto Ketcher, and SDF onto empty
  workspace;
- regression tests proving tab reorder is not mistaken for external file drop.

Exit criteria:

- every domain drop action has a named action kind;
- ambiguous actions can be represented as choices;
- all MVP cases map to either an implemented action or a documented product
  gap.

### Milestone 3: Add Ambiguity UX

Goal: prevent surprising behavior when a drop has more than one plausible
meaning.

Scope:

- protein plus ligand chooser: dock, open separately, or add to an existing
  docking view;
- mixed multi-receptor chooser: choose which receptor candidate to use;
- generic fallback choice to open payloads separately.

Tests:

- resolver tests for multi-receptor and existing docking-view choices;
- shell contract tests for native context-menu dispatch;
- regression tests that high-confidence single-action drops still run without
  extra prompts.

Exit criteria:

- no destructive or replacing action runs without explicit user intent;
- deterministic defaults remain available for high-confidence actions;
- status messages explain the selected action.

### Milestone 4: Expand Text and Clipboard Intake

Goal: treat pasted molecular text as first-class input.

Scope:

- classify SMILES, MOL block, SDF, PDB text, CIF/mmCIF text, XYZ text, and path
  lists;
- route classified text through the same resolver as dragged structures;
- support paste in the workspace, active viewer, Ketcher, and grid contexts;
- expose an explicit Open from Clipboard command for users who prefer command
  palette workflows.

Tests:

- classifier tests for each accepted text family;
- paste/drop tests for workspace, Ketcher, protein viewer, docking view, and
  grid;
- regression tests that editable text controls keep their normal paste behavior.

Exit criteria:

- clipboard inputs can create virtual documents or Ketcher fragments;
- pasted ligands can route to active protein or docking targets;
- unsupported text fails with a clear status instead of a no-op.

### Milestone 5: Grid and Collection Workflows

Goal: make grid drops useful without mutating source files.

Scope:

- append molecule records or collection files into an existing grid;
- infer a single CSV/TSV structure column when headers are non-standard but
  values are unambiguous;
- reject ambiguous CSV/TSV structure columns with actionable status instead of
  silently choosing the first plausible column;
- drag one or more grid rows as rich structure records;
- replace a specific grid row from a single inline record;
- keep dirty virtual grid state separate from source files until explicit
  export or Save As.

Tests:

- grid append tests for SDF, SMILES, CSV, TSV, single-column inference, and
  ambiguous structure columns;
- grid card drag tests for single and selected-row payloads;
- row-level replace contract tests for single inline records;
- export/status tests proving original files are unchanged.

Exit criteria:

- grid edits are virtual and visibly dirty;
- dropped files on grid backgrounds append rather than silently creating a
  separate document;
- dropped single records on grid rows replace that row virtually;
- grid row drag emits records, not only paths.

### Milestone 6: Advanced Docking Workflows

Goal: make receptor/ligand intake predictable for docking and pose-review users.

Scope:

- choose a receptor when a drop contains multiple protein-like candidates;
- add ligand-like paths or inline grid records to an existing docking context;
- keep receptor tabs unchanged when opening derived docking documents.

Tests:

- multi-receptor resolver tests;
- existing docking-view append tests;
- inline grid-row-to-docking tests.

Exit criteria:

- exactly one clear receptor candidate opens docking directly;
- multiple receptor candidates produce choices;
- ligand records from grid rows can create temporary virtual ligand documents
  and then open a docking view.

## Drop Resolver Contract

`resolveDropActionChoices(payload, target, source)` returns ordered choices. The
first choice is the default for deterministic execution when no chooser UI is
needed.

Current action kinds:

- `open-documents`: open filesystem paths as normal documents;
- `open-structure-records`: open inline text records as virtual documents;
- `merge-collection`: create a derived merged collection document;
- `append-grid-records`: append records or supported source files into an
  existing grid document;
- `add-xyzrender-sheet-items`: add paths or inline records to an xyzrender sheet;
- `open-docking`: open a derived docking document from receptor and ligand
  paths;
- `open-docking-with-records`: open inline records as temporary ligand documents
  and then open docking;
- `import-ketcher-structures`: import paths or inline fragments into Ketcher.
- `prepare-fep-setup`: open a derived FEP setup workspace from an existing
  receptor/pose review context while preserving the dropped ligand payload.

Resolver priority:

1. Explicit target context wins over active document context.
2. Ketcher targets import editable structures.
3. Grid targets append collection-like payloads; row targets handle single
   inline replacement inside the grid runtime.
4. xyzrender sheet targets add sheet items.
5. Receptor or docking targets open docking, with choices for multiple receptor
   candidates.
6. Workspace targets open paths or virtual records separately.

## Manual Smoke Matrix

| Target | Input | Expected action |
| --- | --- | --- |
| Empty workspace | `mini.pdb` | Opens a Mol* document tab |
| Empty workspace | SDF text on clipboard | Opens a virtual SDF document |
| Active protein viewer | `ligand.sdf` | Offers or opens docking with the protein as receptor |
| Active docking view | `ligand-2.sdf` | Opens updated docking context with the same receptor |
| Active grid background | `extra.sdf` | Appends rows to the virtual grid |
| Active grid row | one inline SDF or SMILES record | Replaces the row virtually and marks the grid dirty |
| Active xyzrender sheet | `ligand.xyz` | Adds a sheet item |
| Sidebar protein card | `ligand.sdf` | Uses the sidebar card as receptor target |
| Sidebar grid card | `extra.sdf` | Appends to that grid, not the active tab |
| File tab | drag tab to viewer | Routes the tab path through the resolver |
| Ketcher | MOL/SDF file or inline MOL block | Imports first structure, then adds later fragments |
| Ketcher export | sketch to Mol* or xyzrender | Creates a virtual SDF and routes it |
| Mixed set | supported plus unsupported files | Opens supported inputs and reports rejected ones |

## Current Implementation Status

Implemented in this branch:

- documented `DropAction` resolver contract and table-driven resolver tests;
- source-aware resolver choices for known Finder, sidebar, tab, and clipboard
  inputs;
- native ambiguity chooser for multiple choices;
- workspace, active viewer, sidebar card, tab, Ketcher, grid, and paste routing
  through the action vocabulary;
- text classification for SMILES, MOL/SDF, PDB, CIF/mmCIF, XYZ, and path lists;
- command palette Open from Clipboard routing through the same resolver as paste;
- unsupported clipboard text reports a clear status instead of silently doing
  nothing;
- Ketcher path and inline fragment import;
- Ketcher drag-out as a rich structure payload;
- grid append command and host notification for virtual row additions;
- CSV/TSV structure-column inference for one clear non-standard column and
  explicit ambiguity errors for multiple possible structure columns;
- interactive CSV/TSV structure-column picker for ambiguous open and grid
  append flows, with retry through an explicit column selection;
- grid row drag as inline structure records, including selected-row payloads;
- grid row inline replacement with dirty virtual state;
- grid Save As for the current virtual collection, including appended,
  replaced, and removed rows, without modifying the original source file;
- docking choices for multiple receptor candidates and existing docking views;
- tab-strip empty-area drops for batch open without interfering with tab
  reorder or tab-target drops;
- inline grid-record ligand routing into docking through temporary virtual
  documents.
- pose-review sync bridge from SDF grids to Mol* docking views: selected grid
  pose opens the docking view at the same pose, and Mol* pose changes are
  reflected back into the grid selection when the grid view is mounted.
- dedicated side-by-side pose-review workspace that keeps a Mol* receptor/pose
  view and the SDF pose grid mounted together.
- FEP-specific setup workspace that keeps the receptor/pose viewer, ligand
  grid, reference pose, and non-destructive source-file status in one derived
  workspace.

## Completion Discipline

Each implementation slice should:

1. define the target context and user story;
2. add or confirm resolver behavior;
3. add unit tests for resolver/classification;
4. add contract or component tests for the UI target;
5. run the relevant manual smoke row when practical;
6. update this spec if behavior or priority changes.
