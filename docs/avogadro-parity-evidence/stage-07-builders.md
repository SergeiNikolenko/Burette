# Stage 7 evidence: builders and chemical editing

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
reused here: it refuses every structure with an unspecified stereocentre or
double bond (see Known limits). Polymer relaxation also calls the shared
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

## Browser acceptance scripts

Start the shell for each script (`runtime` must be `vite-dev`), open `result.url`
in the in-app Browser, and stop `processId` afterwards:

```bash
BURETTE_AGENT_SHELL_FORCE_VP=1 bun scripts/burette-agent.mjs open --mode browser-agent-shell --no-launch <fixture>
```

Run each script in light and dark themes and once at a 760 px window width.

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

## Known limits (fragment insertion, polymer, automation)

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
  all eight seeds (both OpenChemLib- and RDKit-written 2D MOL input). Reported to
  the stage 3 owner; the `smiles` build therefore uses `generate` + `optimize`.
- pH adjustment treats each site independently with one pKa (no coupled
  centres, microstates, tautomers or substituent corrections); piperazine at
  pH 7.4 becomes a dication. Sulfonamides, imides, pyridones, aminopyridines
  and purines are not modelled.
