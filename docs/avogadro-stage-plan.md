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
  3. Add a step limit (1–1000) to the Optimize menu.
  4. Keep method, iterations and frames in the Z-matrix result and show
     **Open steps**; show `optimizerLabel` in every result line.
  5. Post `{ iteration, energy }` progress from the worker and show it in the
     running status.
  6. Disable unsupported minimizer choices with a reason, or update
     `docs/graph-editing-and-properties.md` if all choices are valid.
  A Geometry lock holds the value its field shows, and typing a value moves the
  atoms there first, so Geometry needs no separate target per lock.
- **Done when:** SDF → freeze two atoms and lock one distance at a new target →
  optimize with UFF/L-BFGS → watch progress → Open steps → Undo, with residuals
  checked against RDKit.
- **Checks:** `test:structure-edit-controls`, `test:geometry-ui`,
  `test:minimizer-core`, `test:optimization-reference`, `test:zmatrix-draft`.

## Stage 3A. Energy models and Avogadro's chunked optimizer

- **User gets:** an **Automatic** force-field choice that picks MMFF94, then UFF,
  for the structure's elements, and Lennard-Jones only for structures without
  bonds (clusters, noble gases); models without parameters for an element are
  disabled with the element named.
- **Where:** `lib/molecular-workbench/minimizer.ts`, `energy-models.ts`,
  `chemistry.ts`, `components/workbench/optimize-button.tsx`.
- **How:** the minimizer keeps FIRE, quasi-Newton, stall and energy-window state
  between `run(count)` calls (Avogadro `OptimizerState`); quasi-Newton steps at
  the noise floor restart once from steepest descent and then stop as
  `stalled`. A registry describes each model's elements and whether it needs the
  bond graph; Lennard-Jones follows `calc/lennardjones.cpp`.
- **Done when:** a tetramethyltin SDF and an Ar cluster XYZ → Automatic picks
  UFF and Lennard-Jones → optimize → the Ar pairs sit at the summed Alvarez radii.
- **Checks:** `test:minimizer-core`, `test:workbench-physics`,
  `test:structure-edit-controls`, `test:optimization-reference`.

## Stage 3B. Optimize Geometry command

- **User gets:** Avogadro's **Optimize Geometry** (⌥⌘O) in the command palette,
  the Edit menu and the native Structure menu, applying steps to the 3D view as
  they run with energy and Cancel, and one Undo for the whole run; **Calculate
  Energy** and **Configure…** (model, energy and gradient convergence, step
  limit); **Freeze/Unfreeze Selected Atoms**. The xTB job keeps its own name
  (**Optimize with xTB**).
- **Where:** `optimize-button.tsx`, `structure-edit-panel.tsx`,
  `geometry-panel.tsx`, `command-palette`, `src-tauri/src/menu/build.rs`,
  `use-app-native-menu.ts`, `compute-worker.ts`.
- **How:** worker progress carries coordinates at most every 100 ms; the panel
  pushes them through `update_geometry` and publishes one edit at the end or
  restores the start on Cancel.
- **Done when:** SDF → ⌥⌘O → the view moves while the energy falls → Cancel
  restores → ⌥⌘O → Undo returns to the start in one step.

## Stage 3C. Auto Optimize tool

- **User gets:** **Auto Optimize**: the structure relaxes continuously while
  atoms are dragged in the 3D view, with a live ΔE readout, Start/Stop and one
  Undo per session.
- **How:** a worker session runs chunks sized to ~33 ms of work
  (`adaptChunkIterations`) on a persistent minimizer; viewer.js gains atom drag
  that sends positions to the session, which restarts its state on each move.
- **Viewer side (done):** `geometry_binding`/`update_geometry` also cover
  single-model MOL/SDF through a generated XYZ baseline, and `atom_drag` with
  `atom-drag` events implements the drag (see
  [Atom dragging](renderer-support.md#atom-dragging)); the host API is
  `lib/atom-drag.ts`. Check: `test:atom-drag`, `test:geometry-update-runtime`.
- **Where:** `lib/molecular-workbench/auto-optimize-worker.ts` and
  `auto-optimize-client.ts`, `components/workbench/auto-optimize.tsx`
  (`useAutoOptimize`: session, status, drag mode while it runs), wired into
  `geometry-panel.tsx` and `structure-edit-panel.tsx`, which reads a Geometry
  binding for the SDF/MOL scene only while a session runs.
- **Done:** Ar₆ XYZ in Geometry and a water trimer SDF in Edit → Auto Optimize
  → the view relaxes with ΔE in the toolbar → an atom dragged in the 3D view
  stays under the pointer while the others follow → Stop publishes one edit →
  Undo restores the start (browser shell on Gauss, 2026-11-06).
- **Checks:** `test:workbench-physics` (`test-auto-optimize`),
  `test:geometry-ui` (`test-geometry-auto-optimize`), `test:atom-drag`.

## Stage 3D. External energy models

- **User gets:** xTB GFN-FF/GFN2 and Avogadro Python energy plugins (text-v1 and
  binary-v1 protocols from `[[tool.avogadro.energy-models]]`) as models in the
  same menu on desktop; agent jobs accept every model.
- **How:** an asynchronous objective drives the same chunked minimizer; plugin
  processes stay alive per session; the agent contract and job runner accept
  graph-free models.
- **Done (desktop core):** `minimizerSteps` is one generator driven by `drive`
  and `driveAsync`, so `optimizeCartesianAsync` takes the steps of
  `optimizeCartesian` over the shared `cartesianProblem`. Native sessions
  (`commands/energy_models`: `energy_models_list`, `energy_model_open`,
  `energy_model_evaluate`, `energy_model_close`) run `xtb --grad` or keep one
  plugin process per run, owned by the window. `optimizeWithEnergyModel` and
  `useEnergyModelOptions` put the models into Optimize, Configure, Calculate
  Energy, Edit, Geometry and Properties; Auto Optimize refuses them with a
  reason. `optimizeZmatrixWithEnergyModel` runs coupled Z-matrix variables over
  a session with one evaluation per point: the model's Cartesian gradient times
  the differenced Jacobian of the placed atoms (`optimizeZmatrixAsync`, gradient
  `chain-rule`). Agent jobs accept `LJ` for `energy`,
  `energy_forces`, `frame_energy_forces` and `optimize`.
- **Done (agent jobs):** the contract accepts `xtb:gfn2|gfn1|gfnff` and
  `avogadro:<package>/<identifier>` for `energy`, `energy_forces`,
  `frame_energy_forces` and `optimize`; the runner drives the native sessions
  (one per frame page) and refuses missing, unavailable or browser-shell models.
  Workbench reads and jobs run in `desktop-app` sessions as well as
  `browser-agent-shell`, so the desktop's models reach agents.
- **Done (models without gradients):** as Avogadro's
  `EnergyCalculator::finiteGradient`, they are differenced from energies
  (central, 1e-4 Å, frozen atoms skipped, up to 64 atoms); a binary-v1 model
  with `support.batch` answers the point and its 6N shifts in one
  `energy_model_evaluate_batch` request.
- **Done (unit cells):** an extended XYZ `Lattice` reaches the structure;
  Lennard-Jones takes minimum images as Avogadro's LJ and UFF do; MMFF94 and
  UFF here refuse a cell (no periodic terms), and Automatic picks
  Lennard-Jones only for unbonded atoms. External models get the cell only
  with `support.unit-cell`, as CJSON `unitCell` or an XYZ `Lattice`.
- **Open:** `pdb` input, and the packaged desktop acceptance with real xTB and
  Avogadro packages.
- **Checks:** `test:minimizer-core`, `test:workbench-physics`
  (`test-external-energy-models`, `test-periodic-energy`), `test:energy-agent`,
  `test:zmatrix-coupled-core` (`test-zmatrix-chain-rule`), and in
  `apps/desktop/src-tauri` `cargo test --lib energy_models` (the real
  avogadro-xtb-energy test is `--ignored`).

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
- **Done (2026-11-06):** the palette, Edit's More actions, Geometry and Z-matrix
  open the dialog; PDB reads its first model. Gaussian and Psi4 write Z-matrix
  rows in atom order (the Z-matrix panel's variables kept), ORCA `* gzmt`.
  Browser check on Gauss: ethanol SDF from the palette and from Edit, light and
  dark; the saved Gaussian Z-matrix places the atoms again within 6e-9 Å and the
  ORCA Cartesian file keeps them; `mini.pdb` exports from the palette.
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
- **Done (2026-11-06, part 1):** `cjson-science.ts` reads Avogadro's
  `vibrations` (flat or per conformer; zero-padded eigenvectors), `basisSet`
  (shell types 0…±4, contractions renormalized) and `orbitals` (closed and open
  shell, eV → Eh, occupations from `electronCount` when absent). A `unitCell`
  (cell vectors or a…γ, fractional coordinates) opens as extended XYZ with its
  Lattice. Vibrations animate live on CJSON scenes. The LUMO of avogadrodata's
  formaldehyde.cjson matches the cube Avogadro saved (correlation 1.000000);
  vibrations and orbitals survive the MOLX v4 codec; browser check on Gauss:
  1527 cm⁻¹ animates, the LUMO surface shows. Gaussian optimization logs with a
  basis already open on their final geometry with orbitals.
- **Open (part 2):** a coordinate-set selector that writes the chosen CJSON set
  to the graph; `docs/scientific-format-coverage.md`.
- **Checks:** `test:cjson-graph` (`test-cjson-science`), `test:cjson-graph-codec`,
  `test:cjson-import`, `test:science-codec`, `test:quantum-science-session`,
  `test:gaussian-log-orbitals`.

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
