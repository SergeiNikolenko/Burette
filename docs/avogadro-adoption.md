# Avogadro capability adoption

This is the complete Burette functional contract, based on the
[Avogadro 2.1 release](https://avogadro.cc/install/versions/v210.html) and the
expanded molecular construction, scientific IO, editing, crystallography,
persistence and automation scope. The release feature list is a baseline, not
an exhaustive inventory. Full parity remains incomplete.

The [acceptance ledger](avogadro-parity-checklist.md) separates adopted source,
partial integration and untested workflows. The [extension inventory](avogadro-extensions.md)
retains the resource and adapter contracts. Requirement IDs below identify
obligations, not completion claims. They remain in scope after a foundation is
implemented; only an explicit scope decision can retire a requirement.

## Scope and shared contracts

Evidence classifications and requirement **00.04** are defined in the acceptance ledger.

- **00.01** All twelve stages and the complete capability map remain normative; full browser
  functionality is the primary goal, with Codex UI Atlas and existing Burette surfaces. A working
  subset never closes a stage.

- **00.02** Pin source/data revisions, audit each adapted file/dependency license, retain
  notices/provenance and numerical references; reuse existing document/render/compute/job owners. No
  embedded Qt shell or unrestricted downloaded Python/JS execution.

- **00.05** Keep operation-specific finite size/depth/count/time/work limits, units, atom order,
  source identity, cancellation and bounded artifact paths; do not silently substitute engines,
  truncate scientific data or evict another Original to admit input.

- **00.06** Extend existing surfaces: per-structure Geometry/Info/Text/right dock, spectra/Plots
  bottom dock, long work in Jobs; content-dependent tools only appear for applicable active content.
  Do not create a separate workbench.

## 1. Internal-coordinate interchange

- **01.01** Bounded XYZ↔numeric/symbolic Z-matrix interchange through existing CLI and packaged
  runtime; exercise actual subprocess output and normal Burette open, refuse implicit overwrite.

- **01.02** Preserve atom order, pairwise distances, handedness and source orientation; reject
  unsupported/ambiguous/singular/non-finite/malformed inputs and enforce coordinate/output limits.

- **01.03** Retain named variables, signed uses and dummy reference rows through Copy/export/reopen;
  dummy X rows never become physical atoms or change physical atom numbering. Reference rows are labelled
  “Ref n” in italic, never as physical elements; variable rows list their bound coordinate uses
  beside the variable.

- **01.04** An unused variable or reference-only edit remains a revision without changing real atom
  lines or computed data; maintain one bounded definition marker and source import identity.

- **01.05** Support add/rename/remove variables, resolve removed signed uses to literals, reference
  selection with distinct earlier rows and swap behavior, positive/negative bindings only when
  physically valid; reject invalid forms locally without changing source.

- **01.06** Collinear-leading XYZ can acquire an internal definition without moving or creating a
  document; reference changes preserve geometry and drop only incompatible bindings. Retain near-
  collinear precision through numeric entry, serialization and re-export.

- **01.07** Quantum input export covers ORCA, Gaussian, Psi4 and CP2K templates with
  charge/multiplicity checks, applicable coordinate constraints and periodic cell metadata; export
  does not execute these engines. Verify exported real-atom numbering excludes dummy references.

## 2. Molecular document and coordinate editing

- **02.01** Typed atom/bond and distance/angle/torsion edits use stable IDs, units, revisions and
  transactions at the existing replacement boundary; coordinate editing moves the supported smaller
  connected fragment and explicitly refuses unsupported ring/nonbonded cuts.

- **02.02** Geometry hover/focus highlights defining atoms and measurements transiently without
  persistent selection; Text/Geometry share acknowledged serialized drafts, frame retention, Save
  and unsaved state. Failed/cancelled/stale ACKs leave text/history unchanged.

- **02.03** Add/remove/reorder atoms and reference rows after complete validation; preserve
  surviving atom source lines/positions, remap bonds/selection/properties/measurements, reject
  removing the last atom or a required reference and name bindings that cannot survive the new
  order.

- **02.04** Reference-only edits retain selection/science; topology edits preserve supported
  scene/camera/settings, invalidate atom-indexed data and incompatible selection, never infer bond
  orders, roll back failed reload and restore replaced Redo history without overwriting newer
  source.

- **02.05** Undo/Redo, save/reopen and source replacement must preserve exact revision identity
  across XYZ/Z-matrix/MOL/SDF/logical MOLX, including ring, disconnected, linear, near-linear and
  stereochemical cases.

- **02.06** Atom names, bond/residue/conformer metadata use stable IDs through
  reorder/add/delete/hydrogens; preserve foreign multiline fields and atom/conformer UUIDs. Extend
  beyond single-record SDF to PDB/mmCIF and ensembles; clear operations and
  malformed/duplicate/oversized reserved metadata need explicit behavior.

- **02.07** Preserve graph/charges/stereo, original bytes and source-owned metadata through preview,
  native MOLX state, Save scene and ordinary reopen; archive titles must not choose a renderer
  inconsistent with the logical source.

- **02.08** Retain all six supported measurement kinds, complete nested
  styles/material/clip/LOD/animation/interior, groups/hidden state and multiple measurements through
  edits and history; count checkpoint payloads coherently in UTF-8 and reject oversize before
  publication.

- **02.09** Revalidate exact document object/logical source/raw source/frame/request lifetime after
  awaits and immediately before publication; source edit/close/replacement or stale restores cannot
  overwrite a newer owner, including same-ID/path/revision and ABA histories.

- **02.10** Real picker/drop, Save copy, dirty-draft recovery, reload and cross-Text/Geometry Undo
  need their own acceptance; downloading a copy does not silently save/clean a draft or replace
  Original.

- **02.11** Coordinate gestures update the existing model with ACK and retained source frame; bond
  candidates follow element-distance thresholds as geometry changes, without unnecessary iframe
  replacement. Full topology plus visible owned scalar-field combination remains a separate open
  workflow.

- **02.12** Native loaded-model export, 2D depiction/lasso and 3D selection retain exact source atom
  rows/coordinates/charges and exclude unrelated isolated atoms; malformed charge-looking labels
  remain text, and menus/source replacement cannot redirect selection.

## 3. Constraints, minimizers, energies and forces

- **03.01** Carry frozen atoms and distance/angle/torsion/internal-variable constraints from editor
  into compute; frozen coordinates are exact and constraint residuals are shown in physical units.

- **03.02** Keep BFGS/L-BFGS and provide FIRE/ABC-FIRE plus a documented hybrid/adaptive-step
  policy; independent energy/gradient checks precede performance claims and compare the same
  physical model.

- **03.03** Map Z-matrix real atoms past dummy rows; dummy references cannot receive atom freeze or
  unsupported physical restraints. Reject linear-angle/collinear-torsion constraints before starting
  a worker.

- **03.04** Support coupled shared variables during optimization; report incompatible bindings
  rather than silently claiming preserved symmetry. Reference directions and row reconstruction must
  reproduce optimized geometry to the declared tolerance without re-anchoring frozen atoms.

- **03.05** Optimization produces one undoable source revision and a step trajectory, with
  convergence state, energies and residuals belonging to that revision. Failed, cancelled, stale or
  closed work publishes nothing and preserves history/Redo.

- **03.06** Respect MMFF94/MMFF94s/UFF availability and operation-specific atom limits including
  newly added H; no silent fallback from an unsupported/default model. Distinguish numerical central
  derivatives from analytic gradients and label energy/force units and atom mapping.

- **03.07** Validate near-linear and genuinely undefined objectives without perturbing geometry or
  inventing a causal diagnostic; truthful refusal is not accepted optimization. Complete real
  interactive controls and large/edge fixtures separately from helper tests.

- **03.08** Automatic 3D preparation is a distinct remaining workflow, separate from truthful
  refusal of undefined collinear objectives and from optimizing already suitable 3D inputs; retain
  complete interactive method/constraint UX as an open requirement.

## 4. Scientific output readers and ownership

- **04.01** Retain bounded scientific geometry histories, energies/convergence, basis/MO,
  frequencies/modes/intensities and per-frame Hessians separately from coordinate-only previews;
  incomplete runs, units and source atom order are mandatory.

- **04.02** ORCA frequency/Hessian metadata belongs to its preceding source geometry; later frames
  without modes inherit none. Preserve irrep labels and mode-index associations including zero-
  frequency modes; reject duplicates/inconsistent counts/frequencies/non-finite values.

- **04.03** Distinguish Raman activity Å⁴/amu and dimensionless depolarization from experimental
  intensity; reviewed ORCA three-column Raman and five-column IR T² atomic units must not be
  relabelled km/mol; unverified layouts require explicit refusal.

- **04.04** Proprietary binaries require a supported converter. Gaussian logs without MO/correlated
  energies and QCSchema Hessian/wavefunction/shortened-trajectory limitations remain explicit, not
  unrestricted format-parity claims.

- **04.05** Ordinary picker, Files, drop and explicit scientific import share bounded admission;
  named failure opens no geometry-only fallback, readable siblings survive partial failure, cancel
  retains no orphan originals and same-name sources remain independent.

- **04.06** Preserve exact uploaded Original including BOM/CRLF/compression and names per document
  through durable storage/reload/cold reopen; failed/quota-aborted allocation cannot publish a path
  or evict earlier originals.

- **04.07** Scientific data/definition revisions follow actual geometry identity; geometry changes
  invalidate derived metadata, reference-only changes retain it, Undo recovers matching metadata,
  replacement releases old state and metadata-only document clones retain it.

- **04.08** MOLX must preserve validated logical source, stable IDs, complete scientific JSON, exact
  Original and active frame; validate science coordinates against source, metadata schema and
  limits, and detect source replacement during export/restore.

- **04.09** CJSON explicit bonds/source atom order/coordinate sets and remaining
  energy/vibration/orbital/periodic/display metadata need real consumers and frame switching; opaque
  Original retention alone is insufficient. MCD companions require actual
  producer/picker/Recent/Palette/scene reopen coverage.

- **04.10** Preserve the current scientific limits: 16 MiB text admission, 10,000 atoms, 2,000
  frames, one million grid values, two million mode values and FCHK basis dimension 2,000. Reader-
  specific bounds remain explicit; changing them requires paired validation, not a claim of
  arbitrary large-file coverage.

## 5. Orbitals, density, spin and surfaces

- **05.01** Molden/FCHK basis/MO ingestion needs independent CPU references for phase, normalization
  and Cartesian/spherical ordering, including Molden through g and FCHK through i with their
  distinct high-angular ordering and mixed shell flags. Higher or otherwise unsupported shells
  require an explicit external Cube route, not guessed coefficients.

- **05.02** Cover restricted/unrestricted spin, occupations, sparse/inconsistent coefficients,
  signed orbital surfaces, electron/spin density and rotated/oblique grids; compare numerical
  samples before visual claims.

- **05.03** Orbitals list shows energies/occupancies and HOMO/LUMO, with isovalue/signed
  colors/density/spin controls; Show/Hide/replacement must retain the molecular scene and not let
  stale workers republish hidden or foreign fields.

- **05.04** Atom/bond edits invalidate derived fields; exact source/science revision, request
  cancellation, close and export ownership must survive held workers and real UI timing cases.

- **05.05** Benchmark numerical error, elapsed time and peak memory on identical inputs before speed
  claims; upstream20–25× is not Burette performance. Keep grid/expanded-primitive budgets explicit.

- **05.06** Cube signed-axis units, oblique transforms, multi-dataset selection/Undo, actual
  fields/atoms and exact Original require native and full-shell scientific route evidence
  separately; native Cube dataset controls do not close full-shell multi-field import or visible-
  scalar topology preservation.

## 6. Vibrations, spectra and trajectory analysis

- **06.01** Normal-mode picker/player/amplitude, spectrum peak-to-mode linkage, Stop, displaced-
  coordinate/trajectory export and per-frame Hessians need correct source/frame ownership, seeks,
  missing metadata, edits and cancellation.

- **06.02** Retain IR, Raman, VibrationalCD, MagneticCD, NMR, Electronic, CircularDichroism and
  DensityOfStates; MS/MS, EPR or XAS is not a substitute for the requested spectra.

- **06.03** VibrationalCD uses signed rotational strength versus cm^-1 with source mode/frequency
  association and Gaussian/display behavior; never IR-positive clipping.

- **06.04** MagneticCD retains signed values, declared frequency units and producer
  field/temperature provenance; authored companions do not replace acceptance of a real producer
  pair.

- **06.05** NMR uses ppm, source atom-order rows, element/isotope semantics, reference/scale/offset
  per element and intensity 1; distinguish shielding from referenced shifts, reversed/signed ranges,
  and ensure row/keyboard/plot selection targets the exact source atom without damaging unrelated
  selection.

- **06.06** Electronic spectra use eV/oscillator strengths and transition order; distinguish direct
  eV from legacy cm^-1 divided by 8065.544.

- **06.07** CircularDichroism uses signed paired transitions: Electronic column 0/column 2 when
  available, otherwise CircularDichroism column 1; preserve display/export and remount state.

- **06.08** DensityOfStates uses eV including negative ranges, density weights and energy/reference
  metadata; a mode plot is not DOS.

- **06.09** TRR optional velocities/forces need float32/64 decoding, source-to-model atom mapping,
  units, bounded pages/cache accounting and opt-in full summaries; missing blocks must remain
  missing, not zero-filled or inherited.

- **06.10** Energy/temperature/geometry plots and player/properties share one active frame;
  chart/keyboard seeks, exports, delayed reads, source edits/close and stale expected-frame requests
  cannot mix frames or documents. Pinned/moved docks retain their owning source across
  Settings/remount.

- **06.11** Temperature requires known masses, units and degrees of freedom; do not derive it from
  XTC positions. Large/indexed/seek/reopen and frame CSV/numerical exports remain separate from a
  small two-frame proof.

- **06.12** Raw Hessian, spectral tables, displaced geometry and mode trajectories need correctly
  labelled numerical exports and ordinary reopening; downloaded Original remains byte-identical, and
  frame-specific filenames/data must identify the actual selected source frame.

## 7. Polymers, peptides, complexes and insertion

- **07.01** Polymer construction needs real 3D attachment/leaving-H picking, repeat count, end
  groups, stereochemistry/tacticity and relaxation; verify formula, valence, counts and terminal
  connectivity. Translating repeat geometry or peptide D/L controls does not supply polymer stereo.

- **07.02** Peptides retain all 20 residue templates, L/D and side-chain stereochemistry, backbone
  angles/termini/chain identity and complete exported graphs; standalone Preview/Create does not
  close insertion/Undo.

- **07.03** Metal complexes, DNA and RNA each require independent geometry/chemistry references and
  actual build/download/reopen; placement alone establishes neither energetic stability nor metal
  oxidation/spin state.

- **07.04** Geometry-preserving fragment insertion needs attachment/dummy conventions, graph merge,
  source/copy identity/remapping, Undo/export and PDB-CCD atom-name/row-order rules. Opening CJSON
  resources is not insertion.

- **07.05** Hydrogen addition/removal changes actual atoms/valence and remains undoable; hiding H is
  not hydrogen chemistry/protonation. Name/SMILES import and named failures retain source history
  and typed automation counterparts.

## 8. Crystals, assemblies and symmetry

- **08.01** Assemblies use explicit deposited definitions and label-chain generator semantics;
  require explicit assembly/model choice when ambiguous, correct operator order,
  model/chain/residue/atom/bond identities, bounded output, independent coordinates and actual
  export/reopen. Never infer biological assembly from crystal symmetry.

- **08.02** Assembly build preserves source text/draft and opens an explicit new document with
  counts/warnings; cancel/edit/source close/dialog close during computation or final preparation
  cannot insert a stale result.

- **08.03** Periodic cell editing/supercells preserve physical coordinates and exact source mapping
  for nonorthogonal cells and fractional/negative half-open ranges; explicit CIF operations, special
  positions, duplicate sites, occupancy/disorder and ambiguity require reviewed policies.

- **08.04** Molecular point-group identification/symmetrization needs independent operations,
  element/isotope/order/coordinate writeback validation; assembly axes/cages are not point-group
  detection.

- **08.05** Niggli is passive integer unimodular basis reduction with inverse, signed/absolute
  volume, Cartesian/site-order and wrap-translation invariants; no primitive-cell/site reduction or
  space-group claim. Export/owner/UI acceptance is separate from the WASM wrapper.

- **08.06** Space-group analysis and primitive/conventional refinement need independent
  species/charge, operation, transform, handedness, cell-volume/site-count and output-readback
  checks; keep the Moyo dependency/runtime distinct from Niggli spglib.

- **08.07** XRD needs independent reflection/profile/intensity/units checks, narrow-peak widths,
  upper boundaries, monotonic finite profiles, basis-invariant overlap and numerical export; a
  plotted curve is insufficient.

- **08.08** Partial/periodic g(r) needs independent lattice-image enumeration, species filters/all-
  partial cases, exact-shell normalization, directed counts/coordination, half-open bins/cutoffs and
  translation invariance; finite fractional overflow must not stall loops, and no ad-hoc epsilon may
  move bins.

- **08.09** Binary BCIF classification and label-only CIF composition remain explicit work. Polymer
  evidence takes priority over cell metadata; content classification must not infer elements or
  expand symmetry merely to label a file.

## 9. Scientific IO and mesh export

- **09.01** Common inner-format detection and bounded streaming gzip/XZ/Zstandard read/write cover
  declared picker/filesystem/drop/download routes, multi-member streams, corruption/truncation,
  expansion/cancellation and exact compressed Original ownership.

- **09.02** Keep format registry/native metadata/runtime routing paired only as support is admitted;
  actual independently decoded compressed exports and ordinary reopen are required, distinct from
  large-file/native acceptance.

- **09.03** Visible-scene PLY is a bounded binary file artifact in world angstrom coordinates
  without recentering/scaling, with instance transforms, inverse-transpose normals, reflected
  winding, drawn palette/overpaint color and alpha; omit hidden/fully transparent geometry.

- **09.04** PLY tessellates supported mesh/texture/sphere/cylinder/line/point geometry; unsupported
  text/images/direct volumes/clipping refuse honestly. Enforce64 MiB
  preflight/readback/instance/output limits and finite ±1e6Å coordinates before allocations; empty
  export is an error.

- **09.05** PLY progress/Abort remains live through loops/final serialization/publication; snapshot
  scene property identities and reject changes between request/run/yields/completion/download
  without auto-pausing animation. Hover/selection markers neither export nor invalidate; reopen
  actual files and preserve source on failure.

- **09.06** Preserve physical V2000/V3000 atom IDs/order/gaps/charges/bonds/stereo and source text;
  reject malformed/duplicate/dangling/continued records at complete-file boundaries. Bare MOL is not
  a scene archive; LABEL text is not chemistry, and known unsupported COLLECTION/CFG cases stay
  explicit.

## 10. Typed automation, batches and notebooks

- **10.01** Every interactive
  chemistry/coordinate/constraint/builder/insertion/crystal/assembly/symmetry/spectra/name/property
  operation needs a typed counterpart using existing job owners, shared semantics and command
  introspection; current job count is not operation completeness.

- **10.02** Preserve revision-pinned immutable inputs, units/atom mapping, bounded summaries/path
  artifacts/queues, replay/deduplication, invalid-request errors and stale/cancel/close semantics.
  Artifacts do not silently apply to live documents.

- **10.03** Python/Jupyter uses the stable CLI/session protocol and same revisions/bounds;
  demonstrate operation-specific actual end-to-end workflows and supported conformer/frame energy-
  force batches suitable for ML potentials, not merely helper imports.

- **10.04** The full automation contract retains nine job kinds: `properties`, `energy`,
  `energy_forces`, `optimize`, `conformers`, `metadata_edit`, `pair_distribution`, `point_group`
  and `orbital_cube`. Preserve their reviewed working-tree scope, forcefield/charge choices and
  compatibility while adopting them. Advertise only actually adopted available kinds; a target or
  unadopted implementation is not a current capability.

- **10.05** Hosted/native widgets retain their separate compute-free contract; host-only
  Geometry/scalar lease routes stay private, and arbitrary Python/JS execution is not a parity
  shortcut.

- **10.06** Artifact/session publication uses bounded errors and complete atomic files, sync/closed
  temporary writers, no implicit overwrite and late-destination rejection; partial-write recovery is
  not evidence against concurrent lost-update races.

## 11. Extensions and shared interactions

Requirements **11.01–11.11** are specified in the extension inventory; they remain part of this stage.

- **11.12** Shared camera/projection controls, genuine keyboard rotations, active-frame selection
  and property editing must agree across editing tools; persist state through supported documents,
  not a second unrelated store. Pose arrows and resizing do not prove camera parity.

## 12. Hardening and affected-surface acceptance

- **12.01** Retain relevant malformed-reader/fuzz/regression and finite-geometry cases, stale
  result/cancel/source close/reopen/recovery and error-boundary scenarios across the complete
  matrix; no stage closes by deleting an unmet requirement.

- **12.02** Check labels/contrast/density-aware text, keyboard/focus/Escape, reduced motion,
  light/dark themes and narrow/full-width layouts against Atlas; actual gestures and
  downloaded/reopened artifacts are distinct from DOM/component/build checks.

- **12.03** Separate immutable Browser, compiled shell, packaged macOS, Finder Quick Look, source
  iPhone and hosted/plugin deployment proofs for affected surfaces. Do not infer native acceptance
  from headless MolStar or local builds.

- **12.04** Keep coherent reviewable stages, current generated mirrors/locks, exact source/build
  evidence and remote publication discipline; only explicit user-approved scope changes may narrow
  requirements.

## Interface placement

| Capability | Existing surface and required interaction |
| --- | --- |
| Internal coordinates | Geometry in the right dock, reachable from dock `+` and Info tools; labelled reference atoms, temporary hover/focus measurement, Enter or arrow-key commit, shared Text draft and Save/Undo. |
| Distance/angle/torsion | Measurement rows and the 3D context menu; focus a matching Z-matrix row or move the supported smaller connected fragment. |
| Constraints/optimization | Geometry pins and existing Compute/settings controls; progress/cancel in Jobs, one undoable result with optional step frames. |
| Quantum data/orbitals | Ordinary Open and Info; Orbitals only when data exists, with energy/occupancy/HOMO/LUMO and signed/density/spin controls. |
| Vibrations/spectra/trajectories | Right-dock mode controls and bottom-dock Spectrum/Plots; peak/frame selection shares the source-owned active mode or frame. |
| Builders | Existing Compute builder dialogs; 3D attachment choices, explicit new-document creation and separately validated insertion. Sequence diagrams stay in Ketcher. |
| Crystals/assemblies | Info and existing scene/context/Compute routes; explicit cell/assembly choice, bounded new documents and ordinary export/reopen. |
| Hydrogens/symmetry/names | Compute, scene context and command search; actual atom edits/symmetrization are undoable, names reuse the existing search route. |
| Compression/PLY | Ordinary Open/download; viewport Screenshot menu exports a visible-scene PLY file. |
| Automation/extensions | Existing CLI/MCP/client and Settings Extensions/Jobs, sharing names, revisions and ownership with interactive operations. |

Use the [interaction principles](interaction-principles.md) and
[design system](design-system.md), including existing light/dark tokens and shared
icons. A symmetry decoration is not a biological assembly or point-group finder;
hidden hydrogens are not chemical edits; a Ketcher diagram is not a 3D polymer;
coordinates alone are not orbitals or vibrations; MS/MS is not IR/Raman.
