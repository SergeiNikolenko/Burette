# Stage 7 evidence: builders and chemical editing

## Live preparation automation with mixed stereochemistry (2026-11-03)

The packaged Python Workbench client exercised `prepare_3d` through the live
prebuilt browser shell, using RDKit-generated planar MOL inputs. Both jobs
completed with MMFF94/BFGS and exported 19-atom / 18-bond SDF structures.

| Input | Independent RDKit export check | Optimization | Export SHA-256 |
| --- | --- | --- | --- |
| `C[C@H](O)CC(C)O` | Canonical isomeric SMILES `CC(O)C[C@H](C)O`; center 1 remains S and center 4 remains unspecified | Converged, 121 steps, 5.42497470306387 kcal/mol | `29a63ac91f482336a381b8b2ac8dce3a24615cddeebe5c4a8fa64180fc391dbc` |
| `C/C=C/CC=CC` | Canonical isomeric SMILES `CC=CC/C=C/C`, preserving specified and unspecified double-bond stereochemistry | Converged, 183 steps, 11.330970080711502 kcal/mol | `e575391d98834957d6404110b8ad171dab64244235dbed03799083d251c56408` |

Both exported conformers are marked 3D. Source revisions stayed unchanged and
repeating each submission with its original operation ID returned the same
job ID. One status request timed out while browser control was unavailable;
querying the existing operation after reconnecting found it succeeded, and
acceptance continued with that job instead of replacing it.

The first SDF was subsequently opened through the browser file picker. The
rendered molecular view and Info confirmed 19 atoms / 18 bonds in the light
1280×720 surface. Evidence is in `/tmp/burette-live-prepare-stereo-report.json`
and `/tmp/burette-mixed-stereo-reopened-light-view.png`. These results cover
live Python/CLI automation and the exported final structures. In-place UI
preparation of these two inputs and compact/keyboard acceptance remain
unverified. The tetrahedral SDF's MOLX persistence is checked below.

The live jobs' XYZ step trajectories were also exported and independently
checked with Python RDKit. Each frame was assigned the final SDF's bond graph,
all stereo annotations were removed, and `AssignStereochemistryFrom3D` derived
stereochemistry anew from that frame's coordinates. All 122 tetrahedral-case
frames retained atom 1 as S; all 184 double-bond-case frames retained bond 1
as E. Every frame retained the element order and finite coordinates/energy.
Frame counts equalled the reported iterations plus one, and initial/final
energies matched the job summaries. Last-frame coordinates matched the SDFs
within 4.956e-11 and 4.849e-11 Å respectively.

Trajectory SHA-256 values are
`9e181296ab43f2d31b747c29836192043f9a78a3b95f61b8e7a8604646e104d2`
and `024d004954b778ab01c69567957563ea8fbecdc65e320102cd018eb7b3d9f9e9`.
The oracle script and output are `/tmp/burette-prepare-trajectory-oracle.py`
and `/tmp/burette-prepare-trajectory-oracle.json`. This verifies specified
stereochemistry in the trajectory geometry using the accompanying SDF graph.
The plain XYZ artifacts themselves carry elements, coordinates and step
energies, without bond or unspecified-stereo annotations. Standalone XYZ
round-trip preservation of those annotations is therefore unproven.

### Mixed tetrahedral scene save and reopen

In the same prebuilt browser, the prepared tetrahedral SDF's workspace-tab
menu → Save scene… (activated with Enter) downloaded
`/Users/nikolenko/Desktop/mixed-tetrahedral-prepared.molx`. The ordinary file
picker opened that archive as a separate document and rendered its molecular
scene in the light 1280×720 view. Save scene… on the reopened document then
downloaded `mixed-tetrahedral-prepared (1).molx`.

Independent Python ZIP/hash checks and RDKit parsing confirmed both archives
contain the exact 1,619-byte prepared SDF as source and Original, with SHA-256
`29a63ac91f482336a381b8b2ac8dce3a24615cddeebe5c4a8fa64180fc391dbc`.
Every attachment length/hash passed. The complete scientific manifest,
including document UUID and structure/model/trajectory binding, was identical
after reopen and save. Both sources parsed as 19 atoms / 18 bonds with a 3D
conformer and canonical isomeric SMILES `CC(O)C[C@H](C)O`; RDKit returned
`[(1, 'S'), (4, '?')]`. Atom IDs in this source are null, so this case leaves
per-atom UUID persistence unverified.

Archive hashes are
`8f521f527989ef876cfdc71d0eaa2851919bc05355f1871847b000ac197904ef`
and `5c283d762e839410a5bff22b2d5b6f3dde253dd7710dc4e22623a4c2a0a7e4da`.
Local evidence is `/tmp/burette-mixed-stereo-molx-oracle.json` and
`/tmp/burette-mixed-stereo-molx-reopened.png`. This covers an unedited imported
prepared SDF and one scene; in-place edited scenes, mixed E/Z scenes, ESR
groups, per-atom identities, compact layouts and the full theme/accessibility
matrix remain open.

## Live unspecified-stereo 3D preparation (2026-11-03)

The current integration frontend was rebuilt with `vp build` for the
`prebuilt-static` browser-agent shell. In the in-app browser, a flat OCL MOL
generated from `CC(N)C(=O)O` was imported through the file picker. Command Palette
→ Edit atoms and bonds → More actions → Generate 3D coordinates completed in
the same document, changing 6 atoms / 5 bonds to 13 atoms / 12 bonds. The panel
reported MMFF94/BFGS, 39.08 → 22.46 kcal/mol, 136 steps, Converged.

One Undo restored all six displayed planar coordinates and disabled Undo.
Redo restored the displayed 3D coordinates, atom/bond counts and optimization
summary, and disabled Redo. Save copy exported a MOL with SHA-256
`0afe706f2c15ecbf0693f7af5925b7cd4f209155645033f8f43da29050e20f1d`.
Independent Python RDKit parsed 13 atoms / 12 bonds, a 3D conformer, and the
same isomeric SMILES `CC(N)C(=O)O` as the input. Its chiral-center query returned
atom index 1 with `?`, preserving the unspecified center.

Picker reopening the exported copy created a separate document and rendered
the molecule with 13 atoms / 12 bonds in Info. Local evidence is
`/tmp/burette-alanine-3d-oracle.json` and
`/tmp/burette-alanine-3d-reopened.png`. This covers one unspecified tetrahedral
center in the dark 1280×720 browser surface. Specified/mixed stereochemistry,
E/Z, atom UUID checks, MOLX round trips, light/compact/accessibility acceptance
and live automation preparation remain separate checks.

### Edited alanine scene and atom identities (2026-11-03)

The original alanine document still displayed the completed preparation edit
(13 atoms / 12 bonds, Undo enabled, Redo disabled, MMFF94/BFGS summary).
Its workspace-tab Save scene… action exported
`/Users/nikolenko/Desktop/burette-parity-unspecified-alanine.molx`. Opening
that archive through the ordinary picker rendered a separate scene. Saving
the reopened scene produced `burette-parity-unspecified-alanine (1).molx`.

Both archives carry the same version-2 scientific manifest, including the
document UUID, all 13 unique ordered atom UUIDs and structure/model/trajectory
bindings. Independent ZIP and SHA-256 checks verified all attachment lengths
and hashes. The current 1,106-byte MOL is identical to the earlier Save copy
output (`0afe706f2c15ecbf0693f7af5925b7cd4f209155645033f8f43da29050e20f1d`),
while the 602-byte Original remains identical to the imported planar MOL
(`65fe0c7808020d711bbb8596779a7d6259e5d06ad8c9ad48746a6217a8d6b9d8`).
RDKit parsed the current source as 13 atoms / 12 bonds in 3D and the Original
as 6 atoms / 5 bonds in 2D. Both retain `CC(N)C(=O)O`, and the prepared source
still reports center 1 as unspecified.

Archive hashes are
`5ce21e2ab15bf7d0e3b00801cd5eb304e3dcc2919e0ccbf3774cbfeac7396baf`
and `50c3e0b9d51dd2038fe9b3c91176b83df92595def1f1df5316f2597b731a0017`.
Local oracle results are `/tmp/burette-edited-alanine-molx-oracle.json`.
The reopened scene rendered in light theme and after switching to dark;
`/tmp/burette-edited-alanine-molx-reopened.png` records the dark 1280×720 view.
This establishes persistence through save/reopen/save for this preparation
edit. Identity tracking across subsequent edits or atom reordering, editing
history restoration, measurements/layers and compact accessibility remain
separate acceptance cases.

Branch `parity/builders`, based on `a5f7303cd`. This file records what each
stage 7 requirement now has, the commands that checked it, the independent
references used, the browser acceptance scripts still to run, and the limits
that remain. It does not change the acceptance ledger; browser acceptance is
pending until the scripts below are executed on a named build.

Commands run from the repository root. Each `bun run test:<name>` script is also
appended to `test:ui`.

## Fragment insertion (07.04, Avogadro Build → Insert → Fragment)

Implementation: `lib/molecular-workbench/fragment-insertion.ts` (rigid
placement, `placeFragment`, `applyFragmentEdit`), `fragment-source.ts`
(library/SMILES/built-graph templates, attachment sites, `insertFragment`),
the `add-fragment` edit in `graph-edit.ts`, `lib/workbench/fragment-task.ts` and
`fragment-worker.ts`, the `insert-fragment` graph-draft operation and
`components/workbench/structure-edit/insert-fragment-dialog.tsx`. Contract in
[graph editing](../graph-editing-and-properties.md#fragment-insertion).

Library: 166 functional groups extracted mechanically from OpenChemistry/fragments
`7d842f435aec4729a308b23ad7f9501bdd44aa02` (BSD-3-Clause) by
`bun scripts/generate-fragment-library.mjs [--check] [--source-dir <clone>]`,
per-file SHA-256 in `config/fragment-library-sources.json`.
`--check --source-dir /tmp/oc-fragments` passes.

`bun run test:fragment-insertion` (13 tests: 6 core, 2 graph draft, 2 dialog,
plus the shared structure-edit suites run separately) checks, against
independent references:

- All 166 library groups versus the upstream `groups.smi` SMILES of the same
  revision, read by RDKit 2026.03.6, constitution including the attachment
  atom (a francium marker replaces the dummy in both graphs). One group
  (phosphine oxide) has no upstream SMILES; `reviewed-names.smi` records it.
- Products versus RDKit canonical SMILES of independently written molecules:
  ethyl on a benzene H (ethylbenzene), `*C` on the ethanol CH2 (2-propanol),
  phenyl on hydrogen-free benzene through the Add Hydrogens free-valence
  position (biphenyl), `C(=O)[O-]` by the first-atom convention (benzoate),
  `[NH3+]*` (anilinium), the lysine side chain (charge +1), a separate water,
  a built glycine zwitterion graph, `*Cl` on isobutane C2 (tert-butyl chloride).
- New bond lengths versus Allen et al., J. Chem. Soc. Perkin Trans. 2 1987,
  S1–S19: C(ar)–C(sp3) 1.513 Å and biphenyl C(ar)–C(ar) 1.487 Å, within 0.03 Å.
- Every surviving source atom keeps its exact coordinates; ring C–C–C(new)
  angles equal the source C–C–H angles to 1e-6°; fragment internal distances
  are preserved to 1e-6 Å; no new nonbonded contact below 2.0 Å.
- Refusals: two attachment points, unreadable SMILES, unknown library id, a
  first atom without hydrogen, an attachment on a built graph. The structure is
  unchanged after each.
- Real worker through `useGraphDraft`: ethyl replaces the ethanol hydroxyl H
  (diethyl ether, 15 atoms), one Undo step, exact Undo/Redo source text, PubChem
  SDF data items retained, metadata atom identities remapped, the draft reopens
  with identical atoms and bonds. A refused insertion opens no editing session
  and adds no history.

Fixtures: `tests/fixtures/fragments/` (PubChem CID 241, 702, 6360 3D records,
public domain; upstream `groups.smi`, BSD-3-Clause), see its README.

## Polymer end groups, relaxation and existing tacticity/picking (07.01)

Implementation: `buildPolymer` reports `terminals`; `lib/workbench/polymer-worker.ts`
caps ends through `placeFragment`/`applyFragmentEdit` and optionally relaxes
with the shared optimize engine (`optimize` in `chemistry.ts`, MMFF94 `bfgs`,
1,000 iterations) within 256 atoms;
`POLYMER_END_GROUPS` (hydrogen, methyl, hydroxyl, phenyl, tert-butyl) in
`polymer-task.ts`; Head end / Tail end selects and Relax geometry in the dialog.
Existing stereo/tacticity (`isotactic`, `syndiotactic`, `atactic` with one
sampled pattern per request), host-lease 3D role picking (`polymer-pick.js`,
`polymer_pick_atom`) and publication are unchanged.

`bun run test:polymer-ends` (4 tests, compiled browser worker):

- Methyl/methyl, hydroxyl/phenyl and hydrogen/tert-butyl caps on isotactic and
  syndiotactic hexamers equal, as RDKit canonical isomeric SMILES, the frozen
  independent hydrogen-capped references (`tests/fixtures/polymer/tacticity-references.json`)
  extended by the cap SMILES; cap atoms have provenance −1.
- Relaxation converges, lowers MMFF94 energy, keeps bonds and stereo, and every
  C–C/C–H bond is within 0.025/0.02 Å of Allen 1987 C(sp3)–C(sp3) 1.530 Å and
  C–H 1.092 Å. 30 repeats (>256 atoms) are refused. tert-Butyl on the unrelaxed
  head would sit 1.2 Å from a branch H and is refused with a named error.

Regression: `bun run test:polymer-attachment`, `test:polymer-tacticity`,
`test:polymer-worker`, `test:polymer-pick`, `test:polymer-publication`,
`test:polymer-builder` pass. The compiled-worker tests now share
`tests/support/browser-worker-build.ts`, which resolves Vite `?url` imports the
way the app bundler does (the worker now reaches the chemistry module).

## Typed CLI/MCP counterparts (stage 10 row)

`parity/optimization-automation` was merged (`d04572aca`, `3c206c5fb`); the
builder kinds are registered through its typed-job registry. Each kind is one
`JOB_DEFINITIONS` entry in `scripts/workbench-agent-contract.mjs` (+ `.d.mts`,
plugin mirror). Submit runners live in `lib/workbench/agent-builder-jobs.ts`
(`builderJobs`, spread into `AGENT_JOBS`); documentless kinds set `build: true`,
are requested with operation `build` and run through `AGENT_BUILDS`
(`AgentBuildRunner`). `capabilities` reports each kind's `operation`.

| Kind | Operation | Source | Artifact |
| --- | --- | --- | --- |
| `insert_fragment` | submit | explicit MOL/SDF | `structure` |
| `hydrogens` (`add`, `remove`, `ph` + `pH`) | submit | explicit MOL/SDF | `structure` |
| `polymer` | submit | repeat-unit MOL/SDF | `structure` |
| `smiles` | build | none | `structure`, `xyz`, `trajectory` |
| `peptide` | build | none | `structure` (mmCIF) |

The `smiles` build reuses the shared engines: the OpenChemLib conformer of
`generate` (as when a SMILES is opened) relaxed by the `optimize` action with
the requested `forceField`/`method`/`maxIterations`, reported through the
registry's `optimizationSummary`/`optimizationArtifacts`. `prepare_3d` was not
reused here because it originally refused unspecified stereochemistry. That
refusal is corrected at the engine boundary (see the 2026-11-03 update below).
Polymer relaxation also calls the shared
`optimize`. Results never edit the open document. Documented in
[agent platform](../agent-platform.md#structure-editing-and-builder-jobs).

`bun run test:builder-agent` (5 tests, real controller and workers): contract
accept/refuse matrix (including misrouted build/submit kinds and pH bounds);
RDKit reads the exported artifacts as diethyl ether, ethanol + water, ethanol
without/with hydrogens (provenance `[0,1,2,-1…]`), the glycine zwitterion at
pH 7.4 and the frozen isotactic polypropylene hexamer; Ala-Gly-Ser mmCIF has
C8H15N3O5; `smiles` builds of acetic acid, cis-2-butene and both alanine
enantiomers keep constitution and stereo (RDKit perceives them from the
exported 3D coordinates) and converge; XYZ sources, out-of-range atoms and
failed placements are refused; build jobs deduplicate, conflict on reused ids
and survive document closure. `test:workbench-python-client` drives
`Workbench.build("peptide", …)` through the packaged CLI (binding `none`,
exported mmCIF, misrouted `energy` refused). `test:workbench-automation-jobs`,
`test:properties-agent`, `test:energy-agent`, `test:orbital-agent` and
`test:agent-graph-source` pass; the compiled CLI test lists all 15 kinds.

## Adjust hydrogens for pH (07.06)

Core (`protonation.ts`, `adjustHydrogensForPh`, worker action `protonate`) and
its references are in [hydrogens and pH protonation](../hydrogen-protonation.md):
a cited per-group pKa table (no Open Babel `phmodel.txt`, which is GPL-2),
checked against Dimorphite-DL 2.1.0 (126/132 agreements) and Open Babel 3.1.1
`-p` (105/132), every disagreement frozen with its reason in
`tests/fixtures/protonation/disagreements.json`. Add/Remove Hydrogens is checked
against RDKit `AddHs`/`RemoveHs` and Allen 1987 X–H lengths
(`test-hydrogen-references`), which also caught and fixed the XH2 pair geometry
in small rings.

Edit tab: More actions → Adjust hydrogens for pH… (`adjust-ph-dialog.tsx`,
graph-draft operation `{ kind: "protonate", pH }`, provenance from the worker
because hydrogens are both added and removed). `bun run test:protonation`
(13 tests) adds: the real worker through `useGraphDraft` turns RDKit-written
glycine into a draft RDKit reads as `[NH3+]CC(=O)[O-]` at pH 7.4 and
`[NH3+]CC(=O)O` at pH 1, with heavy atoms unmoved, two exact Undo steps, and
pH 15 refused without history; the dialog refuses values outside 0–14 and
applies 7.45.

## Peptide builder (07.02)

Avogadro reference: `insertpeptide.cpp`/`insertpeptidedialog.ui`
(avogadrolibs `d250eb3`; master of 2026-11-01 differs only in `const`
references). Burette offers the same global L/D choice and φ/ψ presets (α,
β, 3₁₀, π, custom; D chains take the mirrored angles) plus one/three-letter
codes, N/C termini (amine/ammonium, acid/carboxylate) and chain id; per-residue
chirality is API-only. Fixes made while checking against references: D residues
are written with their CCD component ids (DAL, DPR, MED …) and `chem_comp`
types; atom rows follow CCD order; Pro closes a planar-N Cγ-endo/exo ring at
CCD N–CD 1.4866 Å (φ fixed by the ring at −70.7° or −51.7°; 3NIR: −77°/−49°);
the amide H is in the peptide plane; the neutral NH2 terminus is tetrahedral;
staggered χ1/χ2 rotamers replace clashing template rotamers.

`bun run test:peptide-reference` (7 tests, plus `test:peptide-geometry`,
`-graph`, `-worker`, `-builder`, `-preview`) compares 33 built cases (6
backbones × Ala16 L/D and two 10-residue sequences, D side chains, mixed
L,D,L,D chain Z, four terminus states, two Mol* `to_mmCIF` re-exports) whose
SHA-256 must equal the current output, against values measured by
`tests/fixtures/peptide/measure-reference.py`: Biopython 1.88 φ/ψ (≤ 0.002°),
gemmi 0.7.5 ω (180° ± 0.002°), MDAnalysis 2.11.0 HELANAL rise/residues per turn
(α 3.48/1.58 Å, 3₁₀ 2.99/2.01, π 4.20/0.96, PPII 2.98/3.10), DSSP 4.6.1 (H, G,
I, P), RDKit 2026.09.1 CIP from 3D versus CCD `pdbx_stereo_config`, formula and
charge versus CCD sums, intra-residue geometry versus CCD ideal coordinates
(bonds ≤ 0.001 Å, angles ≤ 0.06° except at N), Engh & Huber 1991 peptide bond
(1.329 Å, 116.2°, 121.7°), RDKit `DetermineConnectivity` from coordinates only,
and the Mol* re-export through gemmi (≤ 0.0005 Å). Reference data: wwPDB CCD
(CC0, hashes recorded, not committed). Details in
[peptide-geometry.md](../peptide-geometry.md) and the fixture README.

Insert: with an editable MOL/SDF active, the dialog's Insert adds the built
peptide graph (`PeptideBuildResult.graph`) to it as a separate molecule in one
Undo step (`InsertBuiltStructureButton`). `bun run test:insert-built-structure`
inserts real Ala-Gly worker output into ethanol: RDKit reads the draft as
`CCO.C[C@H]([NH3+])C(=O)NCC(=O)[O-]`, ethanol atoms are unchanged, provenance
is exact and Undo restores the source. This found that reordering a graph with
a V3000 stereo collection (`MDLV30/STEABS`) was refused; `graph-edit.ts` now
remaps collection atom ids (`test:graph-normalization-stereo` checks the
remapped STEABS row and the unchanged configuration).

## Metal complex builder (07.03)

Core `metal-complex.ts` (rigid OpenChemistry/fragments `7d842f4` ligand
templates, 17 ligands with per-file SHA-256, `scripts/generate-metal-ligands.ts`),
worker, dialog (`metal-complex-builder.tsx`, palette *Build metal complex…*) and
[metal-complex-builder.md](../metal-complex-builder.md). Geometries: linear,
trigonal planar, tetrahedral, square planar, trigonal bipyramidal, square
pyramidal, octahedral; monodentate and bidentate ligands; Cordero 2008 default
M–donor distances. Coordination bonds are written as V2000 type 9 with
`M  CHG` (RDKit DATIVE, Open Babel order 9, OpenChemLib metal–ligand bond, Mol*
order 9; Mol* ignores V3000 `CHG=`).

`bun run test:metal-complex` (13 tests): the 14 sample SDFs are byte-identical
to the builder's output and were read by RDKit 2025.09.1 and Open Babel
3.1.1 (`tests/fixtures/metal-complex/reference.py`): Hill formula, net charge,
atom/bond counts, coordination number, metal charge = oxidation state and
ligand SMILES. Donor–metal–donor angles versus COD crystal structures (CC0):
cisplatin 2235566 2.6°, transplatin 1538403 1.7°, [Co(NH3)6]3+ 2106540 ≤ 2.1°,
[Ni(CN)4]2− 2002899 2.0°, Fe(CO)5 2310564 3.9°, [Cu(NH3)4(H2O)]2+ 2310816 6.7°,
[ZnBr4]2− 2310916 5.4°, [Au(CN)2]− 2310938 0°, Fe(acac)3 2241338 5.9°,
[Fe(ox)3]3− 1528614 10.8°, [Ru(bpy)3]2+ 2105090 1.8°, [Co(en)3]3+ 2243918 5.4°
(tolerance 7° monodentate, 12° tris-chelate, 5° per chelate bite). Polyhedra
match Avogadro's templates (`064eeb4`) within 0.2° except square pyramidal
(Burette: octahedron minus a vertex). The dialog test drives the real worker to
the exact [Ru(bpy)3]2+ file, the overlap refusal and recovery, duplicate
Create, Cancel and the palette command. The typed `metal_complex` build
reproduces all 14 samples byte for byte (`test:builder-agent`).

## Browser acceptance scripts

Start the shell for each script (`runtime` must be `vite-dev`), open `result.url`
in the in-app Browser, and stop `processId` afterwards:

```bash
BURETTE_AGENT_SHELL_FORCE_VP=1 bun scripts/burette-agent.mjs open --mode browser-agent-shell --no-launch <fixture>
```

Run each script in light and dark themes and once at a 760 px window width.

On `d7fb5ce40`, the in-app Browser opened Build DNA or RNA from the command
palette in a `vite-dev` shell. Preview for the default B-DNA duplex of
`GATTACA` showed 444 atoms and a 3D view. Create opened
`GATTACA-B-DNA-duplex-ideal.cif` in a new active tab with a 3D view.

### B1. Insert a library fragment at a picked hydrogen, Undo/Redo, save and reopen

Fixture `tests/fixtures/fragments/ethanol-cid702.sdf` (PubChem CID 702, public domain).

1. Open the right dock Edit tab for ethanol. Expected: Atoms 9, Bonds 8.
2. In the 3D view click the hydroxyl hydrogen (bonded to O). Expected: the Edit
   selection shows that H.
3. More actions (…) → Insert fragment…. Expected: a dialog at the right with
   Library selected, a searchable list grouped by category, Attach to = `H9`.
4. Type `ethyl` in Search fragments, choose `ethyl`, press Insert. Expected:
   the view shows diethyl ether; Atoms 15, Bonds 14; the seven new atoms are
   selected; the dialog stays open.
5. Close the dialog. Press ⌘Z: ethanol returns (9 atoms). ⇧⌘Z: ether returns.
6. Save (the toolbar Save button), then reopen the saved SDF via Open. Expected:
   15 atoms, the C–O–C ether, PubChem data items still present in the Text tab.
7. Error case: select the O atom… then Insert with SMILES `*C*`. Expected: the
   alert “Mark at most one attachment point with *.”; atoms unchanged; Undo
   history unchanged. Correct the SMILES to `*C` and Insert: succeeds.
8. Separate molecule: clear the selection, SMILES `O`, Insert. Expected: Attach to
   reads New molecule; a water appears beside ethanol.

### B2. Attach at a heavy atom without explicit hydrogens

Fixture `tests/fixtures/fragments/benzene-cid241.sdf`. In Edit, More actions →
Remove hydrogens; select one ring carbon in 3D; Insert fragment → Library →
`phenyl` → Insert. Expected: biphenyl with a single inter-ring bond (1.49 Å in
the Geometry measurement) and both rings intact; one Undo step restores
hydrogen-free benzene.

### B3. Polymer end groups and relaxation

Fixture `tests/fixtures/polymer/propylene-repeat.sdf` (derived from the frozen
`propylene-reference.json`; rows 1 head C, 2 tail C, 6 head H, 5 tail H).

1. Compute → Build polymer…. Pick Head = C1, Tail = C2, Head H = H6, Tail H = H5
   by clicking atoms in the 3D view after pressing each role button.
2. Repeats 6, Tacticity Isotactic, Head end Methyl, Tail end Phenyl, Relax
   geometry on. Preview. Expected: a 3D preview, status “… atoms” and Relaxed.
3. Create. Expected: a new “Polymer.sdf” tab; export it (Download/Save) and
   reopen: same atom count, phenyl and ethyl-terminated chain.
4. Error case: Head end tert-Butyl → Preview. Expected: the overlap alert; change
   back to Methyl and Preview succeeds. Repeats 30 with Relax on: the 256-atom
   alert; turn Relax off: Preview succeeds.

### B4. Typed CLI jobs against the open source

With the B1 session (`SESSION=<sessionDir>`):

```bash
node scripts/burette-agent.mjs workbench --session-dir "$SESSION" '{"operation":"observe"}'
node scripts/burette-agent.mjs workbench --session-dir "$SESSION" '{"operation":"submit","operationId":"ether-1","expectedSourceRevision":"<sourceRevision>","job":{"kind":"insert_fragment","params":{"library":"alkanes/ethyl","atomIndex":8}}}'
node scripts/burette-agent.mjs workbench --session-dir "$SESSION" '{"operation":"status","operationId":"ether-1"}'
node scripts/burette-agent.mjs workbench --session-dir "$SESSION" '{"operation":"export","jobId":"<jobId>","artifact":"structure"}' --output /tmp/ether.sdf
node scripts/burette-agent.mjs workbench --session-dir "$SESSION" '{"operation":"build","operationId":"pep-1","job":{"kind":"peptide","params":{"sequence":"AGS","phiDegrees":-57,"psiDegrees":-47}}}'
```

Expected: the summary formula C4H10O; `/tmp/ether.sdf` opens in Burette as a new
tab with diethyl ether while the open ethanol tab is unchanged; the peptide
build reports `documentId: null` and exports `Peptide AGS.cif`. Error case:
resubmit `ether-1` with `"atomIndex":3` → `OPERATION_ID_CONFLICT`.

### B5. Adjust hydrogens for pH

Fixture `tests/fixtures/protonation/glycine.sdf` (RDKit-generated, see README).

1. Edit tab → More actions → Adjust hydrogens for pH…. Expected: a small dialog
   with pH 7.4, Cancel and Apply; focus is in the pH field.
2. Apply. Expected: 10 atoms; N carries +1 and one carboxyl O −1 (atom table
   charges); heavy atoms do not move.
3. ⌘Z restores neutral glycine; ⇧⌘Z the zwitterion. Save, reopen the SDF: the
   charges and explicit H are kept.
4. Error case: enter 15. Expected: “Choose a pH from 0 to 14.” and Apply
   disabled; Escape closes without changes. Enter 1 → Apply: the cation
   (NH3+, neutral COOH).
5. Typed counterpart with the same session:
   `{"operation":"submit","operationId":"ph-1","expectedSourceRevision":"<rev>","job":{"kind":"hydrogens","params":{"mode":"ph","pH":7.4}}}`
   → summary `changes` lists carboxylic-acid deprotonated and primary-amine
   protonated; the exported `fixture-ph-7.4.sdf`-style artifact opens as the zwitterion.

### B6. Peptide builder, D presets and Insert

Fixture `tests/fixtures/fragments/ethanol-cid702.sdf` (for Insert); the builder
itself needs no input.

1. Palette → Build peptide…. Sequence `ACIPGT`, Backbone α helix. Expected:
   φ −60, ψ −40. Press D: φ 60, ψ 40 and the preset still reads α helix; L
   restores −60/−40.
2. N-terminus Ammonium, C-terminus Carboxylate, Chain `B`; Preview, Create.
   Expected: a new “Peptide ACIPGT.cif” tab, a right-handed helix; Info lists
   chain B and ALA…THR (with D: DAL, DIL, DPR …).
3. Export → Structure → mmCIF…, reopen the file: identical structure. Save
   scene… (.molx) and reopen: same geometry.
4. With ethanol active, open Build peptide… again, Sequence `AG`, Insert.
   Expected: “Inserted”; the ethanol tab now also holds Ala-Gly (Edit tab
   Atoms 9 + peptide); one ⌘Z removes it. Sequence `BAD!` → Insert shows the
   sequence error and ethanol is unchanged.
5. Error case: Sequence `BAD!` → Create keeps the dialog with the error;
   `G` → Create succeeds. Known defect: Export → PDB… on the peptide `.cif`
   reports that PDB export is unavailable (the PDB route only filters PDB
   sources).

### B7. Metal complex builder

Fixture `tests/fixtures/metal-complex/samples/cisplatin.sdf` (builder output,
MIT) for the shell; the builder needs no input.

1. Palette → Build metal complex…. Expected: Pt, oxidation state 2, Square
   planar, Site 1–4 Cl⁻, Cl⁻, NH₃, NH₃, Charge 0. Preview, Create: a new
   “[PtCl2(NH3)2].sdf” tab equal to `samples/cisplatin.sdf`.
2. Ru, 2, Octahedral; Equatorial 1 → bpy (partner With 2), Equatorial 3 → bpy
   with partner 5, Equatorial 4 → bpy (With 6); distance 2.07 on Equatorial 1,
   3 and 4. Expected: Charge +2; Create → “[Ru(bpy)3]2+.sdf” byte-equal to
   `samples/tris-bpy-ruthenium.sdf`; reopened: 6 coordination bonds, +2.
3. Error case: Fe, Octahedral, six PMe₃ → Create shows the overlap message and
   keeps the form; Tetrahedral → Create gives “[Fe(PMe3)4]2+”.
4. Linear: the Bidentate group is disabled. Create then Cancel at once: nothing
   opens; Create again works.

## Known limits (fragment insertion, polymer, automation)

### Browser DNA phosphate-end export and reopen (2026-11-03)

On the existing prebuilt-static browser shell at `http://127.0.0.1:51272/`,
the command palette opened **Build DNA or RNA…**. Entering `GCG`, selecting
**Single strand**, retaining **B-form**, and choosing **Phosphate (2−)**
created `GCG-B-DNA-ideal.cif`. The workspace context menu's
**Export → Structure → mmCIF…** downloaded
`GCG-B-DNA-ideal.modified.cif`, SHA-256
`eb6e4e9d232667501a84914dcfb52dc906f590191d1bd0efad37c55fd03fca88`.
**New tab → Open file** reopened that download as a separate 3D workspace.
Browser screenshot: `/tmp/burette-gcg-reopened.png`.

An independent Gemmi/RDKit check of the downloaded file passed. Gemmi read
the atom-site charges and component bonds. Standard consecutive-residue
O3′–P polymer links were added explicitly for the RDKit comparison, since
the writer documents these implicit polymer linkages rather than emitting
`struct_conn` records. Their measured lengths were 1.600533 and 1.600394 Å.
The resulting constitution matched RDKit `MolFromSequence("GCG", flavor=7)`
after ionising its phosphate hydroxyls: 98 explicit atoms, 105 bonds,
formula `C29H34N13O19P3`, total charge −4. OP3 occurred only in residue A1
and HO3′ only in residue A3. Component-template bonds were filtered to atoms
actually present in each residue, including the different terminal groups
of the repeated DG component. Local numerical result:
`/tmp/burette-gcg-export-oracle.json`.

This comparison excluded stereochemistry and did not independently inspect
the reopened viewer's inferred bond graph. RNA, duplexes, other helix forms,
insertion, cancellation, both themes and compact layouts remain separate
browser acceptance cases.

- Insertion edits only explicit single-record MOL/SDF graphs within 256 atoms
  (the shared graph-editing budget). PDB/mmCIF/XYZ sources are refused.
- Fragments are rigid; the torsion about the new bond is chosen by repulsion
  in 5° steps. No relaxation follows insertion; use Optimize (one more Undo step).
- Polymer tacticity covers vinyl repeats whose CH2 tail carries the two
  alternative hydrogens; α,α-disubstituted (quaternary) stereocenters such as
  PMMA are not offered. End caps are a fixed neutral set. Relaxation is limited
  to 256 atoms and does not search conformers; bulky caps on crowded unrelaxed
  chain ends are refused instead of being forced.
- `prepare_3d` (stage 3 code) refuses any structure with an unspecified
  stereocentre or double bond: its stereo identity check compares the source
  ID code against an embedding normalized by `retainUnknownStereo`, which adds
  explicit "unknown" flags, so `CC(N)C(=O)O`, `CC=CC` and `CC(O)CC(C)O` fail on
  all eight seeds (both OpenChemLib- and RDKit-written 2D MOL input). Raised for
  stage 3 in the stage 7 report; the `smiles` build therefore uses `generate` + `optimize`.
  **2026-11-03 update:** the engine now compares constitution independently
  from specified CIP/ESR constraints, retaining unknown source constraints.
  Relative stereo groups use the drawn representative during embedding and
  regain their source ESR semantics before publication. The regression suite
  reads outputs with RDKit for all three examples plus mixed specified/unknown
  tetrahedral and double-bond cases, each from RDKit and OCL MOL depictions.
  It also checks source immutability and atom CIP/ESR after serialization.
  This resolves the reproduced engine refusal. The live acceptance sections
  above cover UI preparation of alanine, automation of the two mixed-stereo
  cases and a tetrahedral MOLX round trip; the remaining input/UI matrix is
  pending.
- pH adjustment treats each site independently with one pKa (no coupled
  centres, microstates, tautomers or substituent corrections); piperazine at
  pH 7.4 becomes a dication. Sulfonamides, imides, pyridones, aminopyridines
  and purines are not modelled.
- Peptides: the 256-atom browser chemistry budget applies (about 25 residues);
  π helices and Pro inside helices clash by construction at their φ/ψ; no
  residue palette, cis-ω or ω choice (Avogadro sets no ω either). Built
  peptides save as mmCIF and MOLX; SDF/MOL/PDB export routes for mmCIF
  documents do not exist (Mol* exports mmCIF/BinaryCIF only).
- Metal complexes: one metal, coordination numbers 2–6, no tri- or higher
  dentate or haptic ligands, no relaxation, no Insert into an open document
  (coordination bonds are not part of the graph-edit model), and placement
  says nothing about stability, oxidation or spin state.
