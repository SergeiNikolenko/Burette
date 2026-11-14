# Feature gap stage plan: Avogadro, Chemcraft and DataWarrior

The Avogadro parity stages 1–13 are in [avogadro-stage-plan.md](avogadro-stage-plan.md).
This plan continues with what Avogadro 2, Chemcraft and DataWarrior still do that
Burette does not, as of 2026-11-06. One stage at a time; each stage ends with
tests, screenshots in `Burette-media/avogadro-parity/stage-NN-<feature>/`, the
user docs and Features cards on the landing branch, and a LinkedIn draft (see
the repository AGENTS rule on docs and landing).

Stages run browser first. Desktop-only parts say so. Acceptance runs on Gauss
for the browser shell and on a `macvm` guest on Orion for the packaged app.

## A. Calculation results (Avogadro, Chemcraft)

### Stage 14. Charges, dipole and thermochemistry from calculation logs

- **They have:** Chemcraft labels atoms with Mulliken, Löwdin, NBO or ESP
  charges, colours atoms by charge and draws the dipole arrow. Avogadro's
  Molecule Properties lists the dipole moment, and its Label tool shows partial
  charges.
- **We have:** the quantum readers already keep printed charge sets and the
  dipole per frame (`scientific-types.ts` `charges`, `dipoleDebye`), but no
  UI shows them; Properties offers only Gasteiger charges as a CSV.
- **User gets:** an Info dock **Charges** card with the charge models of the
  current frame. Charges can be shown as 3D labels or as atom colours on a
  red–white–blue scale, and the dipole can be drawn as an arrow. Frequency jobs
  add a thermochemistry card with ZPE, H, G and S at the printed temperature.
- **Where:** readers in `lib/molecular-workbench/quantum/*` (thermochemistry
  blocks for Gaussian, ORCA, Psi4, Q-Chem, NWChem); the card next to the
  existing coordinate-set card in `structure-info-panel.tsx`; labels, colours
  and the arrow through the viewer bridge (`viewer.js` Mol* label and shape
  representations).
- **Done when:** a Gaussian and an ORCA frequency log show the charge models
  they print, labels and colour match the log numbers, and the dipole arrow
  length and direction match the printed vector. ZPE, H and G match the log.
- **Done (0148fc910, 6fd801780, f29c88978):** thermochemistry from Gaussian,
  ORCA (output and property file), Psi4, NWChem, Q-Chem and xtb `--ohess`,
  checked against each program's printed numbers (`test:thermochemistry`); ORCA
  output now also keeps Mulliken and Löwdin charges and the dipole, and Gaussian
  `freq=hpmodes` logs open. The Info dock shows **Charges** (model, *Color
  atoms*, *Labels*, *Dipole arrow*, one angstrom per debye from the centre of
  the atoms) and **Thermochemistry** for the geometry the scene shows. Colours
  use the app's colour-blind-safe scale (negative blue, positive orange) in
  place of red–white–blue. Fixing the colouring found that multi-part agent
  selections had kept only their last part. Browser shell verified on Gauss
  (p-nitroaniline xtb, Psi4 water, both themes); the packaged app on a `macvm`
  guest is not, because Orion froze when the guest started the app.

### Stage 15. Orbital level diagram and convergence plots

- **They have:** Chemcraft's MO diagram (levels with occupancy, α/β columns,
  click to show an orbital), SCF and optimization convergence graphs. Avogadro
  lists orbitals with energies in its Orbitals window.
- **We have:** an orbital list and HOMO–LUMO gap in `orbitals-panel.tsx`;
  frame energies in the Plots panel.
- **User gets:** a level diagram in the Orbitals panel (α and β side by side
  for unrestricted files). Clicking a level shows its surface. Plots gains
  energy, maximum force and RMS force by optimization step for any log that
  prints them.
- **Where:** `orbitals-panel.tsx` (SVG diagram, keyboard selectable),
  `plots-panel.tsx` series from `output-history.ts`.
- **Done when:** the unrestricted CJSON fixture and a Gaussian optimization log
  show the expected levels and convergence values in both themes.
- **Done (b18816cba, be897365d, ecf9d52a1):** Gaussian, ORCA, Psi4, Q-Chem and
  NWChem optimizations keep each step's maximum and RMS force and step with the
  printed thresholds (`test:optimization-convergence`); Plots draws the chosen
  item on a log axis with the threshold dashed. Orbitals has a level diagram
  with α and β strips on one axis (redrawn in 018894015: every level labelled
  with its energy on a leader, the HOMO–LUMO gap shaded, the same orbital of
  both spins joined by a dashed line, levels gliding between frames). A click or the
  arrow keys pick a level and show its surface at once. The diagram keeps to
  the valence region (20 eV past the frontier levels); core levels stay in the
  table. xtb's optimizer log and SCF iteration graphs are not read yet. Browser
  shell verified on Gauss with the CH₂ triplet CJSON and the Gaussian divinyl-
  benzene optimization in both themes.
- **Extraction audit (2084c5760 … 6d44d62d0):** every program reader was checked
  against cclib and program regression outputs for what it printed but Burette
  dropped. Now read as well: GAMESS step forces, the energy change of ORCA,
  Q-Chem, Psi4, NWChem and xtb steps, and xtb's gradient norm; ORCA Mulliken, Löwdin and Hirshfeld spins, ⟨S²⟩ and
  gradients; Gaussian TD-DFT/CIS/EOM states, ECD from velocity rotatory
  strengths, GIAO shieldings, Mulliken spins, ⟨S²⟩ and forces; Q-Chem, GAMESS
  and NWChem excited states; CJSON energies, dipoles and charges; QCSchema SCF
  dipoles. Every reader fills the Calculation card (program and version,
  keywords or route, basis, charge, multiplicity, termination, run time). Readers
  also stopped mistaking reprinted, displaced, ghost and SAD-guess geometries
  for frames. The electronic and ECD window now widens to cover every
  transition. Browser shell verified on Gauss with ORCA UKS, Gaussian TD-DFT and
  NMR and NWChem TDDFT in both themes.

### Stage 16. Electrostatic potential surfaces

- **They have:** Avogadro colours molecular surfaces by electrostatic potential
  from partial charges. Chemcraft maps an ESP or density cube onto an isosurface.
- **User gets:** a surface coloured by ESP. It is computed from the charges
  (stage 14, or Gasteiger when the file has none) or taken from a potential
  cube. The colour range is adjustable.
- **Where:** cube fields in `lib/molecular-workbench` and the surface
  representation in `viewer.js`; Mol* volume colouring of an isosurface by a
  second volume.
- **Done when:** water and formaldehyde ESP values at sample surface points
  match an independent Coulomb sum from the same charges, and a density + ESP
  cube pair from a Gaussian job colours as cubegen does.
- **Done (c62dc80a6, 92ffda6f1, 701fefdf6):** Compute → "Show electrostatic
  potential" opens a Potential tab for calculations, MOL and SDF files. The
  potential comes from the shown frame's charge sets, Gasteiger charges (MOL,
  SDF and CJSON graphs; XYZ has no bond orders), another field of a multi-field
  Cube, or a potential Cube opened next to a density Cube. Charges give a
  Coulomb grid (hartree/e, 0.3 Å, coarser for large molecules) drawn on a
  smooth van der Waals surface; a Cube pair draws the 0.0004 e/bohr³ density
  isosurface. Both travel as one two-field Cube, and Mol*'s `external-volume`
  theme colours the surface red to blue across a range that defaults to the
  98th percentile of |V| on the surface and is adjustable. Tests: water and
  formaldehyde potentials against an independent Python Coulomb sum
  (`test:electrostatic-potential`), and a PySCF B3LYP water density and
  potential pair whose surface potential agrees in sign with TIP3P charges.
  Browser shell verified on Gauss in both themes with Gaussian water Mulliken
  charges, a p-nitroaniline MOL (Gasteiger) and a p-nitroaniline density +
  potential pair. The Mol* molecular surface is not offered: building it from
  the Cube's atoms adds a second structure to the scene.

### Stage 17. Cube arithmetic and slices

- **They have:** Chemcraft adds, subtracts and scales cube files (difference
  densities) and draws 2D contour slices. Avogadro 1 drew a slice plane.
- **User gets:** **New field** from two cubes on the same grid (A − B, A + B,
  k·A), and a slice plane with contours and colour that can be moved through
  the field.
- **Where:** the multi-field Cube reader from stage 6; a slice panel next to
  the field picker.
- **Done when:** a difference density integrates to the expected electron
  difference, and slice values match the cube at grid points.
- **Done (d9d3a8de5, 109904dae, 0c05358d9):** Compute → "Slice and combine
  fields" opens a **Fields** tab for Cube documents. It shows the field's
  integral (Σ value × voxel volume in bohr³), a slice along the XY, XZ or YZ grid
  plane with a slider through the field, drawn in the panel as a colour map with
  contours (dashed below zero) and the atoms near the plane, and in the scene as
  the same plane coloured by Mol*'s `slice` representation. **New field** makes
  A − B, A + B or k × A from the file's fields and Cubes opened on the same grid,
  and opens the result as a new Cube document. Tests (`test:scalar-field-ops`):
  the B3LYP/6-31G* water density minus the cation density on one 24-point grid
  integrates to 0.9826 electrons, as NumPy gives from the same files; slice values
  equal the Cube's numbers at its grid points; contours of a paraboloid lie on its
  circle. Browser shell verified on Gauss in both themes. Slices follow the grid
  axes only; an arbitrary plane is not offered.

### Stage 18. Relaxed scans and IRC paths

- **They have:** Chemcraft reads Gaussian/ORCA relaxed scans and IRC runs and
  plots the energy against the scanned coordinate or the reaction coordinate.
  Each point is linked to its geometry.
- **User gets:** a Scan / IRC plot that selects the matching frame when a point
  is clicked, with the scanned bond, angle or dihedral detected from the input.
- **Where:** readers in `quantum/gaussian-log.ts`, `orca-*` (scan and IRC
  blocks); `plots-panel.tsx` series linked to frames.
- **Done when:** a Gaussian ModRedundant scan and an ORCA IRC log give the
  printed energies and coordinates, and clicking a point shows that geometry.
- **Done (d27276bc5, bfb9ba835, 497c84e56):** quantum logs keep a scan or
  reaction path next to their frames, and **Plots** draws it first: "Scan, ΔE"
  against the scanned bond, angle or dihedral (read from the ModRedundant `S`
  lines or ORCA's `%geom Scan` box; several scanned coordinates fall back to the
  step number), or "Reaction path, ΔE" against the reaction coordinate. Clicking a
  point or stepping with the arrow keys moves the scene to that geometry; scan
  points whose optimization did not converge are drawn hollow. Gaussian relaxed
  scans take the last geometry of each scan point; a Gaussian IRC opens ordered
  by the reaction coordinate with the TS as reference; ORCA relaxed and
  unrelaxed surface scans take one geometry per point; ORCA's `_IRC_Full_trj.xyz`
  links each point to its geometry (x = step from the TS, energies from the
  comment lines). Tests (`test:reaction-paths`) check the energies and
  coordinates against the summaries the programs print, on public Gaussian 09/16
  and ORCA 4.2/6.1 outputs in `tests/fixtures/quantum/reaction-paths/`. Browser
  shell verified on Gauss in both themes. An ORCA IRC `.out` has no geometries
  along the path, so its plot is not linked to frames; the trajectory file is.

## B. Building and manipulation in 3D (Avogadro)

### Stage 19. Draw tool

- **They have:** Avogadro's Draw tool: click empty space to add an atom of the
  chosen element, drag from an atom to add a bonded atom, click a bond to
  cycle its order. Hydrogens are adjusted as you go.
- **User gets:** a Draw mode in the 3D view of MOL, SDF and XYZ files, with an
  element and bond-order picker, live hydrogen adjustment, and every stroke as
  one Undo step of the existing edit draft.
- **Where:** pointer handling in `viewer.js` next to the atom drag of stage 3C;
  graph edits through `graph-edit.ts` and the structure-edit draft.
- **Done when:** drawing ethanol from methane in clicks gives the same graph as
  RDKit from SMILES, and Undo walks back stroke by stroke.

### Stage 20. Manipulate, bond-centric tool and Select menu

- **They have:** Avogadro's Manipulate tool (move or rotate the selection),
  Bond-Centric Manipulate (rotate one side about a bond, stretch the bond),
  and a Select menu: all, none, invert, by element, by residue, by SMARTS,
  enlarge selection.
- **User gets:** the same three tools on the selection bar of the 3D view and a
  Select submenu in the 3D context menu and command palette.
- **Where:** `preview-controls/viewer-selection-toolbar` and the Mol*
  selection managers; moves through the Geometry/Edit drafts.
- **Done when:** rotating a butane end about C2–C3 changes only that dihedral
  (checked against the Geometry panel), and each select command picks the
  expected atoms.

### Stage 21. Vector graphics and movies

- **They have:** Avogadro exports SVG graphics and records movies of a
  rotation, a vibration or a trajectory.
- **User gets:** Export → Image as SVG for ball-and-stick and licorice views,
  and Record movie (WebM in the browser, MP4 in the Mac app) for spin,
  vibration and trajectory playback.
- **Where:** the screenshot path in `viewer.js` (`capture`), MediaRecorder on
  the Mol* canvas; the native encoder in `src-tauri` for MP4.
- **Done when:** the SVG opens in a vector editor with one element per atom and
  bond, and a 5 s vibration movie plays at the chosen frame rate.

## C. Collections and SAR (DataWarrior)

The August DataWarrior port (PR #609) brought the Collection, Analyze and
Database menus. These stages cover what it left out.

### Stage 22. Linked charts for collections

- **They have:** DataWarrior views: scatter, histogram, bar, box and pie
  charts. All views share the table's selection and filters, and colour and
  size follow any column.
- **User gets:** a Chart dock tab for a collection with scatter, histogram,
  bar and box charts of any columns. Selecting points selects grid rows and
  the other way round, and grid filters apply to the chart.
- **Where:** `grid-viewer.js` selection/filter state through `grid-ui.tsx`;
  a new chart component in the dock (canvas for 100k rows).
- **Done when:** a 10k-row SDF with descriptors keeps selection and filters in
  sync both ways at 60 fps pan and zoom.

### Stage 23. Matched molecular pairs and the SAR table

- **They have:** DataWarrior's matched-pair analysis (transformations with their
  mean property change) and SAR tables over a scaffold's R-groups.
- **We have:** R-group decomposition and activity cliffs.
- **User gets:** **Matched pairs** under Analyze, giving transformations with
  their count and mean Δ of a chosen column, plus the pairs behind each one.
  **SAR table** lays the R-group decomposition out as an R1 × R2 matrix
  coloured by activity.
- **Where:** `rgroup-decomposition-dialog.tsx`, the chemistry worker
  (fragmentation by single acyclic cuts as in Hussain–Rea).
- **Done when:** a small ChEMBL series gives the same transformations and means
  as mmpdb on the same data.

### Stage 24. Property models and Predict Missing Values

- **They have:** DataWarrior builds kNN, PLS and random-forest models from
  descriptors and fills missing values.
- **User gets:** **Build model** from a column and a descriptor set, with
  cross-validated R² or accuracy. The model predicts a new column or fills the
  missing cells, and shows the nearest training neighbours of a prediction.
- **Where:** descriptors from the derived-column channel; models in a worker
  (Rust/WASM or the compute crate).
- **Done when:** a public solubility set reproduces the R² of scikit-learn's
  kNN and random forest within 0.02 on the same split.

### Stage 25. Combinatorial enumeration

- **They have:** DataWarrior's combinatorial library from a scaffold with R
  positions and building-block lists, and reaction-based enumeration.
- **User gets:** **Enumerate library** from a core with R1…Rn and one
  collection per position, or from a reaction and reactant collections. The
  result is a new collection with the source of each part.
- **Where:** the Reaction submenu's reaction runner; RDKit reaction
  enumeration in the chemistry worker.
- **Done when:** a 3 × 4 amide library gives 12 products identical to RDKit's
  `EnumerateLibrary`.

### Stage 26. Data shaping: pivot, merge by key, category filters, row lists

- **They have:** DataWarrior's pivot and reverse pivot, merge of files by a key
  column, category filters with counts, named row lists and the form view.
- **User gets:**
  - Pivot / Unpivot and Merge by key in the Collection menu;
  - a category filter with value counts in the filter section;
  - saved row lists (named selections) to filter and export by;
  - a record form view for one row at a time.
- **Where:** `grid-filter-section.tsx`, the virtual edit layer of
  `grid-viewer.js`.
- **Done when:** pivot followed by unpivot returns the original table, and a
  merge by ChEMBL ID matches a pandas merge.

## Not planned yet

Yaehmop band structures, QTAIM and Flexophore have no open engine that runs in
the browser at a reasonable size. DataWarrior macros wait for the agent jobs to
cover the collection menus, and self-organizing maps wait for stage 22's
chart views. Revisit each with a concrete engine choice.
