# Stage 8 evidence: crystals and assemblies

Branch `parity/crystals`, from `a5f7303cd`. Browser surface (browser-dev and
browser-agent-shell) only; the native app, Quick Look and the iPhone app were not
changed or verified for these tools.

## Commits

| Commit | Subject |
| --- | --- |
| `c8a68dbf1` | Add moyo space-group analysis and conventional/primitive standardization |
| `ec2a1c11e` | Add libmsym molecular point groups with a cancellable symmetry worker |
| `a24d53f00` | Add Gemmi powder diffraction engine and record symmetry engine licenses |
| `c7a911f15` | Read POSCAR and periodic crystals as whole molecules with minimum-image bonds |
| `011306cfa` | Add undoable-ready crystal cell and space-group edits checked against spglib and pymatgen |
| `99e2edc1a` | Open CIF and POSCAR crystals as full cells with the unit cell shown by default |
| `bb8e657fc` | Check periodic g(r), powder patterns and point groups against ASE and pymatgen |
| `56b86aead` | Keep crystal edits as an undoable draft of the CIF, XYZ or POSCAR source |
| `28a07741c` | Add powder diffraction and pair distribution sections for crystal cells |
| `ef3915598` | Add a Crystal dock panel with cell, transform and space-group edits |
| `1fbd40295` | Share the undoable source-text draft between crystal and molecular symmetry tools |
| `dd37108a8` | Add a Symmetry dock panel with point groups and undoable Symmetrize for molecules |
| `6e46620a1` | Add point group, space group, powder XRD, g(r) and crystal transform agent jobs |
| `742c727ab` | Let the browser agent shell read POSCAR and CONTCAR files |
| `3a62c357b` | Test that cell changes keep every periodic bond exactly once |
| `afe8bd952` | Document point groups and the reproduced crystal references |
| `c9aa289e1` | Read only small CIF, POSCAR and XYZ sources to offer the crystal and symmetry tools |
| `49cb7488c` | Merge the typed job registry and register crystal and point-group jobs through it |
| `8dbf86d5b` | Instantiate the diffraction engine from a compiled module so the compiled-host type check passes |

`49cb7488c` merges `parity/optimization-automation` (stage 3/10). Its job registry
(`JOB_DEFINITIONS` in `scripts/workbench-agent-contract.mjs`, `AGENT_JOBS` in
`apps/desktop/src/lib/workbench/agent-jobs.ts`) now carries `point_group`,
`space_group`, `powder_xrd` and `crystal_transform` from
`agent-crystal-jobs.ts`. That branch already had `pair_distribution`; its
parameters (`rMax`, `binWidth`, `centre`, `neighbour`) and artifacts
(`distribution`, `csv`) are kept, and the runner now reads the full crystal cell
(CIF symmetry expanded, POSCAR) before the declared XYZ lattice. Tests that used
`point_group` as the unsupported example now use `molecular_dynamics`.

## Requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Import CIF with symmetry operations and duplicate boundary sites | Done | `test:crystal-io` (every fixture reads as pymatgen's full cell; `nacl-duplicates.cif` reads as 8 atoms) |
| Import POSCAR/CONTCAR (VASP 4/5, negative volume scale, three scale factors, Direct/Cartesian, selective dynamics) | Done | `test:crystal-io`; `test:crystal-open` opens `CONTCAR`, `si.poscar` and an extensionless `POSCAR` |
| Import extended XYZ with a Lattice | Done (existing Mol* route) | `test:crystal-io`, `test:crystal-edit` |
| Bonds across cell faces lost or duplicated on cell change (reported bug) | Fixed | Minimum-image bond perception (Avogadro/Open Babel rule d < rᵢ + rⱼ + 0.45 Å, Cordero radii) matches ASE for urea, rutile, quartz and the triclinic cell; finite molecules are moved whole by lattice vectors; boundary duplicates merge on reading. `test:crystal-io` (ASE bonds), `test:crystal-open` (no bond of the converted urea cell crosses a face), `test:crystal-edit` ("changing the cell keeps every periodic bond exactly once" in both coordinate policies) |
| Unit cell shown by default for crystal formats, hidden for PDB/mmCIF; toggle kept; explicit choice remembered | Done | `PreviewExtension/Web/viewer.js` `applyDefaultUnitCellVisibility`; browser script B1 (not run, see below) |
| Edit cell parameters and matrix, keeping fractional or Cartesian coordinates | Done | `test:crystal-edit` (pymatgen `Structure` with fractional and Cartesian coordinates); Crystal panel Cell section |
| Wrap atoms, standard orientation, scale volume, supercell, Niggli | Done | `test:crystal-edit` (pymatgen `Lattice.from_parameters(vesta=True)`, `Lattice.scale`, `make_supercell`, spglib `niggli_reduce`); `test:symmetry-panels` (supercell, standard orientation through the UI) |
| Space group perception with tolerance; primitive, conventional, symmetrize; fill unit cell; asymmetric unit | Done | `test:crystal-symmetry`, `test:crystal-edit` (spglib datasets and `standardize_cell` at four tolerances, orbit counts, urea fill from its Hall setting); `test:symmetry-panels` (asymmetric unit of an XYZ opens as a new CIF) |
| Molecular point group and symmetrize | Done | `test:point-group`; `test:crystal-analysis` (ten molecules equal pymatgen `PointGroupAnalyzer`); `test:symmetry-panels` (XYZ and MOL Symmetrize as one Undo step) |
| Powder XRD | Done | `test:powder-xrd`, `test:crystal-analysis` (urea, rutile, quartz against pymatgen `XRDCalculator`) |
| g(r), partial and periodic | Done | `test:crystal-analysis` (total and every partial count bin for bin equal to ASE neighbour lists; g to 1e-4) |
| Biological assemblies | Present before this stage | `docs/biological-assemblies.md`, `test:assembly-dialog`; unchanged |
| Every operation one undoable revision | Done | `use-text-draft.ts` history (limit 100) shared by Crystal and Symmetry; SDF/MOL Symmetrize uses the Edit panel's graph history; `test:symmetry-panels` |
| Save and reopen as CIF, POSCAR, XYZ | Done | Drafts save in the source's own format; `test:crystal-io` round-trips every format with exact fractional coordinates |
| Save and reopen as MOLX | Partial | See known limits |
| Typed CLI counterpart | Done | Registered in the shared job registry: `point_group`, `space_group`, `powder_xrd`, `crystal_transform`, plus `pair_distribution` on the full cell; `test:crystal-agent`, `test:workbench-automation-jobs`, `test:orbital-agent`, `test:workbench-python-client`; `docs/agent-platform.md` |
| Browser agent shell opens every fixture | Done (server side) | `BURETTE_AGENT_SHELL_FORCE_VP=1 bun scripts/burette-agent.mjs open --mode browser-agent-shell --no-launch tests/fixtures/crystals/CONTCAR` returned `runtime: vite-dev`; `/__burette/read-file` answered 200 for `CONTCAR`, `si.poscar`, `urea.cif`, `triclinic-molecule.xyz` |

## Independent references

`tests/fixtures/crystals/generate-reference.py` builds every fixture from published
parameters and computes all references with pymatgen, spglib and ASE, never with
Burette code. Run on Gauss:

```sh
uv run --isolated --no-project --python 3.12 \
  --with pymatgen==2026.10.24 --with spglib==2.8.0 --with ase==3.26.0 \
  python tests/fixtures/crystals/generate-reference.py
```

Python 3.12.13, numpy 2.5.4; the pymatgen 2026.10.24 wheel reports `__version__`
2026.10.31. A rerun on 2026-11-02 reproduced `reference.json` (all but the date)
and every fixture byte for byte (fixture md5 `ffc6fceba0e1b6e7ee599129154c13b9`).
The XRD reference of the earlier stage is `tests/fixtures/xrd/generate-reference.py`.

Tolerances and their reasons, all in the tests:

- Positions, cells, volumes: 1e-6–1e-10 relative.
- Powder peaks: 2θ < 1e-6°, d < 1e-7 Å, multiplicities exact; relative intensity
  within 0.6 on the 100 scale and 3% for peaks ≥ 10 at sin θ/λ ≤ 0.45, because
  pymatgen's form-factor fits differ from IT92 (hydrogen by about 5% at sin θ/λ
  = 0.2). pymatgen also counts systematically absent families that coincide with
  a peak (urea (500) under (430)); Burette counts contributing reflections only.
- g(r): integer pair counts exact, g to 1e-4.

## Engines and licenses

| Component | License | Use |
| --- | --- | --- |
| moyo 0.21.0 (`@spglib/moyo-wasm`) | MIT OR Apache-2.0 | Space groups, standardization, Hall settings |
| spglib 2.8.0 Niggli (`burette-niggli.wasm`) | BSD-3-Clause | Niggli reduction |
| libmsym (`burette-msym.wasm`) | MIT | Point groups, symmetrization |
| Gemmi 0.7.5 (`burette-xrd.wasm`) | MPL-2.0, separate WebAssembly module with source availability note | Structure factors |
| Avogadro 2 | BSD-3-Clause | Behaviour reference only (Crystal menu, `avospglib.cpp` standardize flags); no code copied |
| pymatgen (MIT), ASE (LGPL-2.1+), spglib Python | Test references on a remote host only; not bundled | |

Recorded in `THIRD_PARTY_NOTICES.md` and `apps/desktop/public/third-party-licenses/`.
No GPL code is bundled.

WebAssembly reproducibility (Gauss, emsdk 6.0.13, `compute/*/build-wasm.sh`):
`burette-xrd.wasm` (sha256 `5bde5273…`) and `burette-niggli.wasm` (`244a074d…`)
rebuild byte for byte; `burette-msym.wasm` rebuilds to `f08fc848…`, not the
checked-in `869ed021…` (see known limits).

## Commands and results

At `3a62c357b`, each script run separately on the Mac. After the merge, at
`8dbf86d5b`: `test:crystal-agent` 5, `test:workbench-automation-jobs` 8,
`test:orbital-agent` 6 + 7 plus its compiled-host `tsc`, `test:workbench-python-client` 3,
`test:symmetry-panels` 5, `test:properties-agent`, `test:energy-agent`,
`test:workbench-prepare-conformers-ui`, `test:powder-xrd`, `test:crystal-open`,
`test:crystal-edit`, `test:crystal-analysis`, `test-scene-compute`, `typecheck`,
`check:js` and the plugin mirror check all pass.

| Command | Result |
| --- | --- |
| `bun run test:crystal-symmetry` | 10 pass |
| `bun run test:point-group` | 24 pass |
| `bun run test:powder-xrd` | 16 pass |
| `bun run test:crystal-io` | 22 pass |
| `bun run test:crystal-edit` | 26 pass |
| `bun run test:crystal-open` | 6 pass |
| `bun run test:crystal-analysis` | 17 pass |
| `bun run test:symmetry-panels` | 5 pass |
| `bun run test:crystal-agent` | 5 pass |
| `bun run typecheck`, `bun run check:js` | pass |
| `bun tests/test-ui-shell-contract.mjs`, `test-packaged-plugin-mirror.mjs`, `test-browser-dev-text-files.mjs`, `test-dock-file-entries.mjs` | pass |
| `bun test` of `test-open-crystal`, `test-crystals-browser`, `test-cif-crystal`, `test-reader-worker`, `test-scene-compute`, `test-orbital-cli-compiled`, `test-orbital-agent`, `test-energy-agent`, `test-pair-distribution-worker`, `test-niggli-cell`, `test-browser-generated-edit`, `test-browser-source-close-dialog`, `test-logical-sdf-source`, `test-geometry-source-session`, `test-assembly-source-owner` | 0 fail |

`tests/test-browser-source-recovery.test.tsx` (8 fail) and
`tests/test-logical-xyz-source.test.tsx` (19 fail) fail identically at the base
`a5f7303cd` on this Mac; they are not caused by this stage.

## Browser acceptance scripts

Run each in the Codex in-app browser against a `vite-dev` agent shell, in
light and dark theme, and once with the window at 900 px wide and the right dock
at its minimum width.

On the integration branch, the in-app Browser opened the rutile fixture and
Show crystal tools from the command palette. Applying a = 5 Å with Keep
Fractional gave 67.97 Å³, 6 atoms and Pnnm (58). Undo restored 62.45 Å³ and
Redo reapplied the cell change. With Vectors and Cartesian selected, Wrap atoms
created its own Undo step and retained both settings. The saved copy was not
reopened in this run.

On the same integration branch, the browser built the 2 × 2 × 1 urea
supercell (64 atoms, 580.24 Å³). Undo restored 16 atoms and Redo restored 64.
With Keep Cartesian, adding 0.5 Å to c z gave 642.18 Å³ and space group 113.
The independent cell-edit check compares positions and periodic bonds before
and after this vector change.

For B8, Cancel during the 20 × 20 × 15 edit preserved 16 atoms, 145.06 Å³ and
the empty Undo history. A second run completed the calculation and reported
that the result exceeds the 3 MB source editing limit. The crystal worker's
readback held 96,000 atoms in 5,469,044 bytes. The smaller supercell above
succeeded after the refusal.

For B5, the extensionless `CONTCAR` opened as a Mol* 3D view in the browser
and exposed Show crystal tools in the command palette. Niggli reduction gave
a = 2.959 Å at the same 62.45 Å³ and six atoms, with a working Undo and a Redo
entry. The component test also checks that the POSCAR selective-dynamics flags
survive standard orientation. Saved-copy reopen remains unverified.

Start: `BURETTE_AGENT_SHELL_FORCE_VP=1 bun scripts/burette-agent.mjs open --mode browser-agent-shell --no-launch <fixture>`
and open the returned `url`. Fixtures are in `tests/fixtures/crystals/` (CC0, see its
README); `tests/fixtures/crystal-symmetry/` and `tests/fixtures/assemblies/` are
constructed for the tests. The tools open from Compute → Show crystal tools and
Compute → Show molecular symmetry, or the command palette; each opens a right-dock
panel.

**B1. Unit cell default and memory.** Open `urea.cif`. Expected: two whole urea
molecules, every N–H and C=O bond drawn, the unit cell box visible. Open
`tests/fixtures/assemblies/two-model.cif` (macromolecular): no unit cell shown.
In `urea.cif`, hide Unit Cell in the scene tree, reload: it stays hidden; show
it again, reload: shown. Open `triclinic-molecule.xyz`: methanol is drawn whole
across the face, the cell box is shown.

**B2. Cell edit, undo, save, reopen.** Open `rutile.cif`, Compute → Show crystal
tools. Cell: Parameters, set a, Å = 5.0000, Keep Fractional, Apply. Expected: the
cell grows along a, the Cell header reads 67.97 Å³ (5 × 4.594 × 2.959), 6 atoms,
the Undo button is
named "Undo cell change", the source text tab shows the edited CIF. Undo: the
original text and P4_2/mnm (136) return. Redo, Save, reopen the saved CIF:
a = 5.0000 Å, 6 atoms, Space group Pnnm (58). Error: type 0 into a and leave the
field: the value clamps to 0.1000 and Apply stays available; an angle set that
cannot form a cell (α = 10°, β = 10°, γ = 170°) shows the cell error and Apply is
disabled.

**B3. Supercell and boundary bonds.** Open `urea.cif` (16 atoms, P-42_1m (113)).
Transform: a × 2, b × 2, c × 1, Build supercell. Expected: 64 atoms, eight whole
molecules, no bond stretched across a face, one Undo step ("Undo supercell").
Cell → Vectors: add 0.5 to c z, Keep Cartesian, Apply: atoms do not move and
every bond is drawn once. Error: a × 20, b × 20, c × 20 shows "A supercell is
limited to 100,000 atoms." and Build supercell is disabled.

**B4. Space group tools.** Open `quartz.cif`. Space group reads P3_221 (154),
6 operations, two symmetry-distinct sites. Primitive, Conventional and Symmetrize
each add one Undo step and keep 9 atoms. Asymmetric unit opens a new
`quartz-asymmetric-unit.cif` tab with 2 atoms; in it, Fill with space group
already shows the analysed setting; choose 154 again, Fill unit cell: 9 atoms,
P3_221 (154). Save that CIF and reopen: same 9 atoms. On `triclinic-molecule.xyz`
any tolerance reports P1 (1). Error: open
`tests/fixtures/crystal-symmetry/nacl-partial-occupancy.cif`; the panel shows the
partial-occupancy refusal as an alert and offers no edits.

**B5. POSCAR.** Open `CONTCAR`: rutile with the unit cell shown. Standard
orientation: the source keeps its `Selective dynamics` block and `T T F` flags;
Niggli reduce gives a = 2.959 Å, b = c = 4.594 Å with the same volume. Save and
reopen: same cell. Drop a copy of `si.poscar` renamed `POSCAR` (no extension):
it opens as 8-atom silicon with the Crystal tools offered.

**B6. Powder diffraction and g(r).** On `rutile.cif` expand Powder diffraction,
Simulate: the strongest peak is (110) at 27.434° 2θ for Cu Kα1, then (101) at
36.076°; selecting a peak in the chart or table highlights the other. Export →
Peaks as CSV and Pattern as JSON; open the CSV in the app's text view: one row per
peak. Expand Pair distribution, Calculate: the first peak is the Ti–O shell in the
1.9–2.0 Å bin; Centre Ti, Neighbour O keeps that shell and drops the 2.959 Å Ti–Ti
shell. Export → Pair distribution as JSON. Error: Bin width larger than r max shows
the settings error and Calculate is disabled; restoring the value recovers.
Running Simulate on a 20 × 20 × 2 urea supercell and pressing Cancel leaves the
previous state.

**B7. Molecular symmetry.** Open `tests/fixtures/crystals/molecules/ammonia.xyz`,
Compute → Show molecular symmetry: Point group C3v, Order 6. Equivalent atoms:
selecting the H row highlights the three hydrogens in 3D. Move one H by about
0.05 Å (Geometry panel), Tolerance Loose, Symmetrize: "Symmetrized to C3v, largest
shift …" and one Undo step; Save, reopen: still C3v at Tight. Benzene reads D6h,
carbon dioxide D∞h with order ∞. For an SDF or MOL the Symmetrize step appears in
the Edit panel's Undo history. Error: Symmetrize on an already symmetric molecule
shows "Already symmetric" and adds no Undo step.

**B8. Cancellation and recovery.** On `urea.cif` build a 20 × 20 × 15 supercell
(96,000 atoms) and press Cancel while "Supercell" is shown: the source is
unchanged and the Undo history is intact. Edit the CIF text by hand: the Crystal
panel reads the edited text and starts a new history.

## Known limits

- MOLX: an extended XYZ crystal is carried as its XYZ source; after reopening, the
  Crystal panel analyses it but its edits are disabled (restored sources are
  read-only to these tools, as to Geometry for non-XYZ tabs). CIF and POSCAR scenes
  are saved as the Mol* scene only, without a source the tools can edit.
- Fill unit cell does not add the boundary copies of atoms on cell faces that
  Avogadro master draws; Burette keeps one atom per site (0.25 Å merge distance).
- A CIF opens with a along x and b in the xy plane (from its parameters), not in
  any orientation another program stored.
- An XYZ source whose molecules are split across faces is shown as written; only
  edits that relocate atoms make molecules whole.
- Point groups and Symmetrize are offered for SDF, MOL and XYZ molecules of at most
  256 atoms, not for crystals.
- Crystal and Symmetry are right-dock panels, not Avogadro's modal dialogs.
- `burette-msym.wasm` does not rebuild byte for byte with emsdk 6.0.13; its checked-in
  asset predates this stage.
- The crystal jobs reach agents through the shared `workbench` contract (CLI,
  the stdio MCP workbench tool and the Python client); no crystal-specific MCP tool
  was added, and the crystal kinds were not driven through the MCP transport in a
  test of their own.
- Native app, Quick Look and iPhone surfaces are not covered. The native app does
  not open `.vasp`/POSCAR files (no preview-format registration).
- The design checks of the panels were not made in a live browser.

## Edits to shared files

- `package.json`: new `test:*` scripts, appended to `test:ui`.
- `apps/desktop/vite.config.ts`: `vasp`/`poscar` allowed dev-file extensions and
  POSCAR/CONTCAR names mapped to `vasp`.
- `PreviewExtension/Web/viewer.js` and its copy `plugins/burette-agent/preview-web/viewer.js`:
  default unit-cell visibility and remembered choice.
- `scripts/agent-shell-server.mjs`, `scripts/workbench-agent-contract.mjs` and their
  `plugins/burette-agent/scripts/` copies.
- `apps/desktop/src/hooks/use-source-editing.ts`: `vasp` drafts; generated
  crystals accept Crystal and Symmetry edits.
- Dock registration (`lib/dock.ts`, `dock-panel.tsx`, `dock-header.tsx`), Compute
  menu, command palette, browser file picker. `App.tsx` is unchanged.
