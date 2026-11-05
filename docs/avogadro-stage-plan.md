# Avogadro parity: staged delivery plan

The [adoption contract](avogadro-adoption.md) lists every obligation and the
[acceptance ledger](avogadro-parity-checklist.md) records evidence. This plan
orders the remaining work into stages that each end with one finished user
workflow. Work on one stage at a time; do not start the next stage while the
current one has open code or acceptance items.

## Rules for every stage

- Scope: the user workflow named in **Done when**. Edge cases outside it go to
  a later stage or the ledger, not into the current diff.
- Size: one or more commits of at most ~500 changed non-generated lines each.
- Checks: the focused tests listed for the stage, plus one browser scenario run
  on a remote host (Gauss) with the browser agent shell. The Mac runs only light
  unit tests and Apple-platform work.
- Finish: commit, push the branch, update the stage's ledger row with the
  evidence link, then move to the next stage.

## Stage 1. Compare trajectory frames in a restored scene

- **User gets:** after reopening a saved scientific scene (MOLX) with a
  multi-frame trajectory, **All** shows every frame together and **Align**
  superimposes them onto the current frame. Both survive Save scene and reopen.
- **Where:** pose toolbar in `PreviewExtension/Web/viewer.js`
  (`createSceneFrameComparisonControls`, `installDockingPoseControls`); graph
  operations in `PreviewExtension/Web/scene-file-actions.js`
  (`setTrajectoryComparisons`, `setTrajectoryComparisonAlignment`,
  `trajectoryComparisonMode`).
- **How:** All calls the existing comparison transaction. Align inserts one
  tagged `TransformStructureConformation` per comparison with an atom-order
  Kabsch fit onto the source frame and refits when the source frame changes. The
  source structure is never transformed, so its science binding is unchanged.
- **Done when:** open MOLX → All → Align → Next frame → Save scene → reopen →
  Align off → All off → Save scene, with an independent Kabsch/RMSD check of the
  displayed coordinates and unchanged scientific attachments.
- **Checks:** `vp run test:science-runtime`, `bun tests/test-indexed-trajectory.mjs`,
  `node tests/test-ui-shell-contract.mjs`.

## Stage 2. Geometry panel: complete XYZ and Z-matrix editing

- **User gets:** one consistent Geometry panel for XYZ files: Undo and Redo,
  convert to Z-matrix at any time, copy and download in both modes, and a 3D
  measurement that jumps to the matching Geometry row.
- **Where:** `apps/desktop/src/components/geometry-panel.tsx`,
  `components/workbench/zmatrix-panel.tsx`,
  `hooks/use-app-viewer-state-messages.ts`, measurement menu in `viewer.js`.
- **How:**
  1. Add a `future` stack to the Cartesian editor history and a Redo action next
     to Undo; new edits clear it.
  2. Offer **Convert to Z-matrix** whenever conversion is possible, not only for
     the collinear error state.
  3. Add **Export Z-matrix** to the Cartesian toolbar and **Copy Z-matrix** to
     the Z-matrix toolbar, reusing `writeCoordinateInterchange`.
  4. Allow Set distance/angle/dihedral for XYZ in the viewer; route it to the
     Geometry tab with a focus request that matches `row.refs`.
  5. Pass `zmatrixLockUnavailable` into the lock toggles.
- **Done when:** XYZ → edit a distance from the 3D measurement → Undo → Redo →
  convert → Copy and Export Z-matrix → reopen the exported file with identical
  geometry.
- **Checks:** `test:geometry-ui`, `test:zmatrix-controls`,
  `test:coordinate-interchange`, `test:measurement-source-preview`.

## Stage 3. Optimization with constraints for every editable molecule

- **User gets:** MOL/SDF optimization with frozen atoms and locked
  distances/angles/dihedrals with target values, a step limit, live progress,
  and **Open steps** for every optimization result.
- **Where:** `components/workbench/optimize-button.tsx`,
  `structure-edit-panel.tsx`, `geometry-panel.tsx`, `zmatrix-session.ts`,
  `lib/workbench/use-graph-draft.ts`, `lib/molecular-workbench/compute-worker.ts`
  and `compute-client.ts`.
- **How:**
  1. Extend the graph `optimize` operation with `constraints` and
     `maxIterations` and forward them to the chemistry task.
  2. Add freeze/lock controls for the current selection in the Edit panel and
     show constraint residuals as Geometry does.
  3. Store a target value per lock in Geometry.
  4. Add a step limit (1–1000) to the Optimize menu.
  5. Keep method, iterations and frames in the Z-matrix result and show
     **Open steps**; show `optimizerLabel` in every result line.
  6. Post `{ iteration, energy }` progress from the worker and show it in the
     running status.
  7. Disable unsupported minimizer choices with a reason, or update
     `docs/graph-editing-and-properties.md` if all choices are valid.
- **Done when:** SDF → freeze two atoms and lock one distance at a new target →
  optimize with UFF/L-BFGS → watch progress → Open steps → Undo, with residuals
  checked against RDKit.
- **Checks:** `test:structure-edit-controls`, `test:geometry-ui`,
  `test:minimizer-core`, `test:optimization-reference`, `test:zmatrix-draft`.

## Stage 4. Quantum input export from any structure

- **User gets:** **Export input file…** (ORCA, Gaussian, Psi4, CP2K) for MOL,
  SDF, PDB and CIF documents, with a Z-matrix coordinate style where the
  program supports it.
- **Where:** `structure-edit-panel.tsx` (More actions),
  `components/command-palette/index.tsx`,
  `lib/molecular-workbench/input-export.ts`,
  `components/workbench/input-export-dialog.tsx`.
- **How:** open the existing input dialog from the Edit menu and the command
  palette; add `coordinates: "cartesian" | "zmatrix"` to `generateQuantumInput`
  using the definition or coordinate-block presets, excluding dummy rows.
- **Done when:** SDF → Export input file → Gaussian Z-matrix and ORCA Cartesian
  → both files parse back to the same geometry with real atom numbering.
- **Checks:** `test:quantum-input-export`, `test:input-export`.

## Stage 5. Scientific readers: complete CJSON and multi-frame orbitals

- **User gets:** CJSON files with vibrations, orbitals, basis and unit cell open
  with their Vibrations/Orbitals/Crystal tools; files with several coordinate
  sets get a set selector; Gaussian optimization logs keep their orbitals.
- **Where:** `lib/molecular-workbench/cjson-graph.ts`, `quantum.ts`,
  `quantum/output-history.ts`, `lib/science-session/scientific-document.ts`,
  `codec.ts`, `export.ts`, `lib/workbench/scientific-source-state.ts`.
- **How:** parse the CJSON sections and map them instead of the empty arrays;
  extend the MOLX v4 checks; write the chosen coordinate set to the graph and
  bump the source revision; keep document-level orbitals for trajectories.
  Restore `docs/scientific-format-coverage.md`, which the evidence links to.
- **Done when:** an Avogadro-written CJSON with frequencies and MOs → Vibrations
  animate, an orbital surface shows → Save scene → reopen preserves both.
- **Checks:** `test:cjson-graph`, `test:cjson-import`, `test:science-codec`,
  `test:quantum-science-session`, `test:gaussian-log-orbitals`.

## Stage 6. Orbitals and fields: multi-field Cube and colours

- **User gets:** a dataset selector for multi-field Cube files, editable
  positive/negative surface colours, and fields that refuse to show on a frame
  they do not belong to.
- **Where:** `components/workbench/orbitals-panel.tsx`, `show_scalar_field` in
  `viewer.js`, `lib/workbench/scalar-source.ts`.
- **How:** select from `science.gridDatasets`; include dataset and frame in the
  field identity and export name; add colour props to the viewer action.
- **Done when:** a multi-orbital Cube → switch datasets → recolour → Export Cube
  → reopen; values checked against PySCF or the producer's own Cube.
- **Checks:** `test:orbitals-owner`, `test:molstar-cube-datasets`,
  `test:cube-worker`, `test:orbital-agent`.

## Stage 7. Trajectory plots for XTC and DCD in the browser

- **User gets:** the Plots dock (distances, speeds, energies) and CSV export for
  browser-opened XTC/DCD trajectories, plus a whole-trajectory range scan.
- **Where:** `scripts/molstar-indexed-trajectory.js`, trajectory pair loading
  in `viewer.js`, `components/workbench/indexed-plots-panel.tsx`.
- **How:** add raw XTC (frame-offset scan) and DCD (fixed-size frames) adapters
  modelled on the TRR adapter; add a bounded, cancellable range job to Plots.
- **Done when:** PDB + XTC → Plots → distance over all frames → CSV matches
  MDAnalysis.
- **Checks:** `test:indexed-trajectory-runtime`, `test:indexed-plots`,
  `test:built-indexed-trajectory`.

## Stage 8. Builders in the Compute menu and insertion into documents

- **User gets:** peptide, DNA/RNA and metal-complex builders in Compute; Insert
  into the open document for every builder.
- **Where:** `components/editor-area/scene-compute-menu.tsx`,
  `lib/molecular-workbench/graph-edit.ts`, builder dialogs under
  `components/workbench/`, `package.json`.
- **How:** add the menu items; wire the nucleic tests into `package.json` and
  `test:ui`; add dative bond order 9 to graph editing; reuse
  `InsertBuiltStructureButton` in the polymer and metal builders; decide and
  document how PDB/mmCIF targets receive inserted residues (metadata-aware
  append or scene composition).
- **Done when:** SDF → insert a peptide and a metal complex → Undo → Save →
  reopen with formula and connectivity checked by RDKit.
- **Checks:** `test:insert-built-structure`, `test:fragment-insertion`,
  `test:metal-complex`, the new nucleic scripts.

## Stage 9. Crystals: editable sources after Save scene

- **User gets:** CIF/POSCAR crystals saved as a scene reopen editable in the
  Crystal panel; biological assemblies and XRD broadening are scriptable.
- **Where:** `lib/science-session/export.ts`, `use-crystal-draft.ts`,
  `scripts/workbench-agent-contract.mjs`, `lib/workbench/agent-crystal-jobs.ts`.
- **How:** attach CIF/POSCAR source text like SDF sources; restore it into the
  crystal draft; add a `biological_assembly` job kind; add `shape` and `fwhm` to
  `powder_xrd`.
- **Done when:** CIF → supercell → Save scene → reopen → edit cell again →
  export CIF that reopens with the same lattice.
- **Checks:** `test:crystal-edit`, `test:crystal-io`, `test:crystal-agent`,
  `test:assembly-worker`.

## Stage 10. Export to every structure format

- **User gets:** Export → Structure as XYZ, MOL, CIF, POSCAR and CJSON, an
  optional compressed copy, and 3D model export for agents.
- **Where:** `hooks/use-workspace-file-actions.ts`,
  `components/workspace-file-menu.ts`, `lib/compressed-files/task.ts`,
  `scripts/burette-agent.mjs`, `scripts/molstar-scene-export.js`.
- **How:** widen the export format union and write through the existing
  coordinate writers; add a compression choice using `encodeCompressedBlob`;
  add an `export_scene_model` viewer action.
- **Done when:** one SDF exported to each format and reopened with the same
  atoms; a gzip copy reopens through the picker.
- **Checks:** `test:coordinate-source-writers`, `test:coordinate-export`,
  `test:compressed-sources`, `test:scene-export`.

## Stage 11. Automation counterparts for UI actions

- **User gets:** typed CLI/MCP/Python jobs for the remaining UI actions: atom
  and bond edits, Z-matrix edits, builder insertion, assemblies, input export,
  structure and model export, camera projection and axis views.
- **Where:** `scripts/workbench-agent-contract.mjs` and its `.d.mts`,
  `lib/workbench/agent-*.ts`, `plugins/burette-agent/python/burette_workbench.py`,
  plugin mirrors.
- **How:** follow the recipe in `docs/agent-platform.md` for each kind, one kind
  per commit.
- **Done when:** a Python script builds, edits, exports and reopens a molecule
  without the UI.
- **Checks:** `test:workbench-automation-jobs`, `test:workbench-python-client`,
  `test:plugin`.

## Stage 12. Extensions and interaction polish

- **User gets:** Avogadro plugins that add file formats and input generators,
  Edit/Geometry/Properties entries in the 3D context menu, and the full
  fragments library.
- **Where:** `lib/extensions/avogadro-command-io.ts`,
  `avogadro-plugin-runner.ts`, `components/molstar-context-menu.ts`,
  `lib/workbench/focus-tool-dock.ts`.
- **Done when:** install one format plugin, open its file; right-click an atom
  and open Geometry.
- **Checks:** `test:extension-runner`, `test:extension-ui`,
  `test:avogadro-commands`.

## Stage 13. Hardening and other surfaces

- **User gets:** the finished workflows behave in light and dark themes, narrow
  windows, keyboard-only use and reduced motion, then in the packaged app and
  Quick Look.
- **Known items:** light-theme contrast in builder dialogs, the 760 px molecular
  crop after resizing, missing `prefers-reduced-motion` rules in workbench CSS,
  narrow layouts of the Crystal and Symmetry panels.
- **Done when:** every stage scenario above passes at 1400 and 900 px in both
  themes on the browser shell, and the stage 1–4 scenarios pass in the packaged
  macOS app.
