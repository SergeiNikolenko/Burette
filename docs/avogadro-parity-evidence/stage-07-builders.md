# Stage 7 evidence: builders and chemical editing

## Polymer relaxation worker correction (2026-11-03)

The full JS gate stopped at `test:polymer-ends`: relaxation exceeded the
default five-second test deadline. Isolated runs also exceeded 30 and 120
seconds. The polymer worker called the synchronous optimizer before preparing
the RDKit module that supplies MMFF terms, so it fell back to central-difference
gradients. It now awaits the same module preparation as the compute worker.
The compiled-worker fixture includes the real WASM asset at its relative path.

With analytic gradients, dense BFGS exhausted the 1,000-step limit on the
six-repeat isotactic propylene reference (maximum gradient 0.5200643
kcal/(mol·Å)). Polymer relaxation now explicitly uses L-BFGS within that same
budget. Diagnostic execution converged in 624 steps, reducing energy from
4225.5002223 to 37.2677835 kcal/mol with maximum gradient 0.000759019
kcal/(mol·Å). The existing independent RDKit stereo/graph checks and reference
C–C/C–H bond-length bounds pass without relaxing their assertions or deadline.
`vp run test:polymer-ends` passes 4 tests / 86 assertions; polymer worker/source
and builder UI suites also pass. Logs are `/tmp/burette-polymer-ends-final.log`,
`/tmp/burette-polymer-worker-final.log`, and
`/tmp/burette-polymer-builder-final.log`. The full JS gate remains failed at
the earlier revision; live-browser results follow below.

### Live compiled-browser relaxation and picking asset (2026-11-03)

On frontend `8c1ddefad`, the compiled Browser shell's Build polymer dialog
failed before picking with `Could not load polymer picking from
./polymer-pick.js.` The asset existed in the runtime but was missing from the
static server's explicit asset allowlist. Adding that filename fixes delivery.
`test-agent-shell-security.mjs` now requests both its runtime and filesystem
alias routes and checks the JavaScript MIME type and exact source bytes. The
suite passes, including its existing authentication and containment checks.

A fresh server with that correction opened `propylene-repeat.sdf` through
the ordinary picker. Command Palette → Build polymer loaded enabled controls,
and a real atom click assigned C2 to Head. The remaining four-role UI workflow
was not completed: subsequent clicks did not select the intended terminal
carbon while the camera framing changed. The dialog was cancelled. Full B3
UI acceptance, end caps, error recovery and accessibility remain pending.

The CLI then submitted `polymer-relaxation-live-20261103` against that open
source, with zero-based roles head 0, tail 1, head H 5, tail H 4, six isotactic
repeats, hydrogen ends and relaxation enabled. Browser job
`wbj-777d2c4af40e46b1` succeeded in 9.077 seconds with 56 atoms / 55 bonds and
MMFF94 energy 4225.500222311152 → 37.26778298414793 kcal/mol, converged.
Its exported SDF has SHA-256
`e180b6bd506f60235474ab558caf2affb2288c9d1f481592e37a8e63d55dacbe`.

Independent Python RDKit 2026.09.1 confirmed C18H38, the explicit graph counts,
a 3D conformer and canonical stereochemistry matching the frozen isotactic
reference. Removing all stereo annotations and deriving them again from the
exported coordinates also matched. C–C lengths were 1.520657–1.554397 Å and
C–H lengths 1.091992–1.099882 Å, within the existing reference tolerances.
Independent MMFF94 energy was 37.267834292747985 kcal/mol, differing by
0.000051309 from the reported value after coordinate serialization.
Evidence is `/tmp/burette-polymer-live-status.json`,
`/tmp/burette-polymer-live-oracle.json` and
`/tmp/burette-live-polypropylene-relaxed.sdf`.
The exported SDF reopened through the ordinary picker as a separate tab and
rendered the chain in the light 1280×720 view. Screenshot:
`/tmp/burette-live-polypropylene-reopened.png`.

The post-`test:ui` JS-gate commands also pass on `8c1ddefad`: workspace
split/dock/native-page/source-binding, agent-workspace-panel, responsiveness,
Tauri structure, compute-metal, compute-reliability and the four plist checks.
This is a successful partial rerun; a complete JS gate on the latest revision
is still required.

### Capped polymer UI and scene round trip (2026-11-03)

With server `e998669c5` and the same compiled frontend, enabling Selection
mode before opening Build polymer kept the camera stable during picking.
Real viewport clicks assigned Head C1, Head H H6, Tail C2 and Tail H H5.
The UI then accepted six repeats, Isotactic, Methyl head, Phenyl tail and
Relax geometry. Preview completed with 69 atoms and **Not converged**.
Create published a separate `Polymer.sdf` tab. This advances the B3 workflow
but does not pass its converged-relaxation expectation.

The new tab's Save scene action downloaded `/Users/nikolenko/Desktop/Polymer.molx`.
Opening it through the ordinary file chooser restored the visible chain.
Saving the reopened scene as `Polymer (1).molx` preserved all three science
assets byte-for-byte, including the manifest and both source attachments.
The source attachment SHA-256 is
`ee7e3dc7f181210aa407639e51a6b3eaed27f40328d97b2d27d97af07fd1ad09`.
Both light and dark 1280×720 views were inspected. Compact layout and full
keyboard acceptance are still pending.

Independent RDKit parsing of the source extracted from the saved scene gave
C25H44, 69 atoms, 69 bonds, zero radical electrons and MMFF94 energy
68.07516313919785 kcal/mol. Its canonical isomeric SMILES was
`CC[C@@H](C)C[C@@H](C)C[C@@H](C)C[C@@H](C)C[C@@H](C)C[C@@H](C)c1ccccc1`.
Removing stereochemical annotations and assigning them from the 3D
coordinates produced the same SMILES. Independently adding methyl and phenyl
caps to the frozen isotactic reference SMILES also gave that canonical graph
and stereochemistry.
Evidence is `/tmp/burette-ui-capped-polymer-oracle.json`,
`/tmp/burette-ui-capped-polymer.sdf`,
`/tmp/burette-polymer-capped-preview.png` and
`/tmp/burette-ui-capped-polymer-reopened.png`.

The complete JS gate on `e998669c5` stopped at the packaged-plugin mirror
check because the packaged `agent-shell-server.mjs` lacked the new picking
asset allowlist entry. `vp run build:agent-shell` completed successfully and
propagated that correction together with the current compiled frontend.
The mirror, plugin and shell-security suites passed. The subsequent complete
`vp run ci:fast js` finished with exit 0, including polymer ends (4 tests,
86 assertions), all remaining UI suites and the post-UI checks.
Logs are `/tmp/burette-parity-polymer-package-build.log` and
`/tmp/burette-parity-ci-js-packaged-polymer.log`. This validates the rebuilt
package's contracts; the UI evidence above used the separately compiled shell.

### Polymer refusal and recovery in the browser (2026-11-03)

Continued the same localhost browser session on `4b220e685` (the served
frontend remains the earlier `8c1ddefad` build, not the refreshed packaged
bundle). Selected the original propylene tab and assigned C1/H6/C2/H5 through
the four role buttons and visible atom clicks. With Selection mode already
enabled and Picking level set to Residue, clicking C1 left Head armed. Changing
Picking level to Atom made the same click assign C1. The follow-up below
addresses this dependency on the previous picking level.

With hydrogen ends, the default picked-H tacticity, 30 repeats and Relax
geometry on, Preview displayed `Relaxation supports polymers of up to 256
atoms.` Turning Relax geometry off and pressing Preview cleared the error and
rendered a preview with `272 atoms`. With six isotactic repeats, hydrogen tail,
relaxation off and tert-Butyl head, Preview displayed `The fragment overlaps
the structure at this atom. Choose another attachment atom.` Changing the head
to Methyl and pressing Preview cleared the error and rendered `59 atoms`.
These were preview recovery checks; neither output was created or exported.

The successful Methyl/Hydrogen preview was inspected in dark mode at 1280×720
and 760×720. The dialog has vertical scrolling; focusing Create scrolls the
footer into view. Shift+Tab from Close dialog focused Create with a visible
focus ring at 760×720 (`/tmp/burette-polymer-recovery-760-dark.png`). After
closing the dialog, switching to light mode and reopening it, the initial
760×720 form was visible (`/tmp/burette-polymer-dialog-760-light.png`). The
right-side dialog overlaps part of the source molecule at that width, so
compact atom picking, the full light-mode build/recovery sequence, and the
remaining keyboard/accessibility checks are still pending. The viewport
override was reset after inspection.

### Temporary atom picking and level restoration (2026-11-03)

Polymer role picking now temporarily requests Mol*'s `element` granularity,
displayed as Atom, and restores the previous level on completion or cancellation.
If the current level was changed away from Atom while the role was armed,
cleanup preserves that change. Source ownership, single-atom admission and
source-row mapping retain their existing guards.

The final `build:agent-shell` output was opened through a fresh prebuilt-static
server on port 51943. With Selection mode enabled and Residue selected, the
four role buttons switched the visible level to Atom. Real clicks assigned
C1/H6/C2/H5, restored Residue, and Preview produced `38 atoms` for four repeats
with hydrogen ends and relaxation off. Cancelling a newly armed Head also
restored Residue. In light mode, starting from Chain, Head accepted C1 and
restored Chain. Screenshots are `/tmp/burette-polymer-residue-pick-dark.png`
and `/tmp/burette-polymer-chain-pick-light.png`.

The first C1 click in the dark run left the role armed and a second click at
the same position succeeded. Its timing/click-admission cause remains open.
The light run accepted the first click after observing the armed state.
This check covers level switching and restoration at 1280×720, not compact
picking, full keyboard operation or the capped-polymer relaxation scenario.

`vp run test:polymer-pick` passed seven tests with 71 assertions, including
temporary element-level picking, restoration after accepted source rows,
cancellation and preservation of a changed user level. The browser package
was regenerated with `vp run build:agent-shell`.

The broad `ci:fast js` attempt exited 1 at the Geometry kinetic test's decimal
comma input assertion (`tests/test-geometry-kinetic.test.tsx:136`). The same
test had passed earlier in that run. Re-running from
`test:geometry-source-lifecycle` through the remaining UI checks and the JS
scope's final workspace, responsiveness, compute and plist checks exited 0
without Geometry changes. Logs are `/tmp/burette-polymer-mode-ci.log` and
`/tmp/burette-polymer-mode-ci-resume.log`. This split run does not establish
a clean uninterrupted JS gate.

Follow-up isolated a focus race in the Geometry test. Its synthetic input and
Enter could run before the numeric field's two animation-frame focus callbacks.
Enter commits by blurring that input, so an unfocused input did not commit.
Twenty ordinary isolated runs passed, while temporarily delaying the entry
focus frame by 50 ms reproduced the same decimal-comma assertion failure.
Waiting for `document.activeElement` to become that input made the delayed
case pass. The test now waits with a bounded focus assertion before typing
`1,25`; the diagnostic frame delay was removed. This establishes the test
ordering defect, without adding browser acceptance evidence or proving an
uninterrupted full JS gate.
`vp run test:geometry-source-lifecycle` then exited 0 with 41 passing tests
across four files (`/tmp/burette-geometry-focus-lifecycle.log`).

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

### Compact polymer picking (2026-11-03)

At 760 × 720 the expanded builder covered the right side of the repeat unit,
including the head leaving hydrogen. While a role is armed, the builder now
shows its title, role buttons and a live picking instruction. Source details,
parameters, preview and build actions return after picking or toggling the
active role off. The preview iframe stays mounted while hidden, preserving its
view when picking is cancelled. Existing role ownership and cancellation are
unchanged.

Browser-agent-shell on port 56065 (PID 83210, session metadata
`/tmp/burette-polymer-compact-session.json`) exercised the rebuilt frontend at
760 × 720. In dark mode, actual canvas clicks assigned C1/H6/C2/H5 and Preview
produced 38 atoms with four repeats, picked tacticity, hydrogen ends and Relax
off. Re-arming Head and cancelling with Space restored the roles, parameters
and 38-atom preview. Light mode confirmed the compact picking layout and
Space cancellation. Screenshots are `/tmp/burette-polymer-compact-picking-dark.png`,
`/tmp/burette-polymer-compact-preview-dark.png` and
`/tmp/burette-polymer-compact-picking-light.png`. The viewport override was reset.
Typed CLI observe confirmed the source and Mol* viewer ready, recorded in
`/tmp/burette-polymer-compact-observe.json`.

The browser pass preceded the final iframe-retention adjustment. The extended
existing component test verifies that arming hides parameters and the same
preview iframe, cancellation restores both, and subsequent Create still uses
exactly the cached SDF. `vp run test:polymer-builder` and
`vp run build:agent-shell` are the focused validation commands, with logs at
`/tmp/burette-polymer-compact-test.log` and
`/tmp/burette-polymer-compact-build.log`.

This remains partial acceptance. The first dark C1 click required another click;
in light mode C1 was not accepted in the attempted sequence. Selection mode was
off and canvas clicks also moved the camera. The cause of the missed clicks is
still undiagnosed. Full light picking/build, preview-footer scrolling, 320 px,
final-build live iframe retention, and the capped relaxed B3 export/reopen
scenario remain open. No new scientific-convergence or SDF-export claim follows
from this layout change.

### Polymer picking camera and light creation (2026-11-03)

Polymer role picking now temporarily enables Mol* selection mode, restoring the
previous value on completion or cancellation unless the user has already left
that mode. The pinned Mol* `FocusLoci` behavior uses selection mode to exclude
ordinary primary clicks from camera focus. Existing source identity and singleton
loci checks remain in force. The packaged preview mirror was regenerated by
`vp run build:agent-shell`.

A fresh packaged browser-agent-shell on port 57483, session metadata
`/tmp/burette-polymer-selection-mode-session.json`, exercised the current code at
1280 × 720 in dark and light themes. Actual clicks assigned C1/H6/C2/H5 and Preview
produced 38 atoms in both themes, using four repeats, picked tacticity, hydrogen
ends and Relax off. Light Create opened a separate `Polymer.sdf` workspace tab
alongside `propylene-repeat.sdf`. In dark mode, a hydrogen pick had byte-identical
JSON camera snapshots before and after the click. Selection mode returned to off.
Re-arming Head and cancelling with Space retained the very same connected preview
iframe, verified against a saved DOM reference. Temporary diagnostic subscriptions
and DOM references were removed. Screenshots are
`/tmp/burette-polymer-selection-camera-dark.png`,
`/tmp/burette-polymer-selection-camera-light.png` and
`/tmp/burette-polymer-selection-created-light.png`.

The initial light Head click still required a second click at the same screen
coordinates. Runtime inspection after the first click found `empty-loci` with
primary button 1 even though the later hover label showed C1. The second click
assigned C1. This narrows investigation to canvas hit identification/event timing,
without proving its root cause. An earlier dark attempt reached the existing
pick timeout. Neither missed-first-click behavior nor all camera interactions
are claimed fixed. 320 px acceptance, capped relaxation and standalone SDF
export/reopen remain open.

A follow-up on the same packaged runtime recorded both `canvas3d.input.click`
and `plugin.behaviors.interaction.click`. Two actual screen clicks at (650, 342)
both emitted canvas input coordinates (649, 302). The first emitted `empty-loci`
and left Head armed; the second emitted `element-loci` and assigned Head C1.
The initial subscription replay was excluded from this comparison. The trace is
`/tmp/burette-polymer-first-click-trace.json`. This reproduces the failure with
identical canvas input coordinates, narrowing the next investigation to hit
identification rather than different click locations. The form was cancelled
and diagnostic subscriptions removed afterward. No hit-testing fix is claimed.

At 320 × 720 in light mode, the expanded dialog measured x=9.60 to 304 px,
width=294.40 px, and document scroll width equalled the 320 px viewport. Arming
Head produced the compact panel above the molecule; the screenshot is
`/tmp/burette-polymer-selection-320-light.png`. The viewport override was reset
and Space cancelled picking. Full narrow-screen atom picking/Create and dark
320 px acceptance are still outstanding.

Focused validation: `vp run test:polymer-pick` passed 7 tests / 89 assertions,
including restoration from initially off and initially on selection mode;
`vp run build:agent-shell` passed. Logs are
`/tmp/burette-polymer-selection-mode-test.log` and
`/tmp/burette-polymer-selection-mode-build.log`.

The full `vp run ci:fast js` invocation for this implementation subsequently
completed with exit code 0 (session 81499). Its log is
`/tmp/burette-polymer-selection-mode-ci.log`. The live first-click defect above
remains open despite the passing automated gate.

### Pending hover readback and the first atom click (2026-11-03)

The pinned Mol* `PickHelper.identify` checked buffer readiness only for backends
without synchronous reads. A preceding hover can nevertheless start an async
read on WebGL: it clears the dirty flag while `PickBuffers.ready` is false. A
click then read an unavailable picking ID as empty. The source adapter
`scripts/molstar-pick-readback.mjs` checks readiness for both backend types and
uses the existing pending-click path until the read completes. Failed reads
still invalidate the buffer, and resolved background hits remain empty.

The regression executes the pinned helper and real `PickBuffers` with controlled
GPU read completion. The unpatched helper returns undefined while the fixed
helper returns pending, then the expected object/instance/group IDs. It also
checks failed reads, disposal and source-adapter drift. `vp run test:polymer-pick`
passes 10 tests, including the existing source identity and cancellation tests.
`vp run vendor:molstar` and `vp run build:agent-shell` completed with exit code 0.

The rebuilt packaged browser-agent-shell on port 63158 used the same propylene
fixture, with startup metadata `/tmp/burette-pick-readback-session.json`.
At 1280 × 720, all four roles C1/H6/C2/H5 were assigned with exactly one actual
click each in dark and light themes. Both previews produced 38 atoms (four
repeats, picked tacticity, Hydrogen/Hydrogen, Relax off), and light Create opened
a separate `Polymer.sdf` tab. The camera snapshot recorded after the first dark
C1 pick remained byte-identical through the remaining dark and light picks.
After H6, selection statistics still reported zero selected elements. Diagnostic
subscriptions were removed. Screenshots are `/tmp/burette-pick-readback-dark.png`
and `/tmp/burette-pick-readback-created-light.png`.

This resolves the reproduced first-click sequence in these browser runs. Narrow
screen picking, existing nonempty selection preservation, capped relaxation and
standalone SDF export/reopen still need their own acceptance evidence.

### Standalone SDF export and restored scene source (2026-11-03)

The workspace file menu now offers Export → Structure → SDF for a single
SDF/SD source, including the logical source restored from MOLX. Export reuses
the scientific scene snapshot checks and writes its validated source text.
These checks require the displayed graph digest, current source revision and
single-structure binding to agree. The implementation currently serializes the
full scene while obtaining that validated source, so scene capture limits and
failures also apply to this export.

The packaged browser-agent-shell on port 65427 opened the existing capped
polymer SDF. Export through the workspace tab menu downloaded a standalone
SDF, which Cmd+O opened through the ordinary file chooser. Mol* reported one
model and 69 atoms. Export from the restored `Polymer.molx` similarly produced
`Polymer.sdf`; ordinary reopening reported one model and 69 atoms. Runtime
metadata is `/tmp/burette-sdf-source-export-session.json`.

All four downloaded files, including the download after the compact-menu
rebuild, match the 6,432-byte source exactly. Their SHA-256 is
`ee7e3dc7f181210aa407639e51a6b3eaed27f40328d97b2d27d97af07fd1ad09`.
Independent RDKit parsing of the initial exports and restored-source export
reported 69 atoms, 69 bonds, formula C25H44, 3D coordinates and the same
stereochemical SMILES. Oracle reports are
`/tmp/burette-sdf-source-export-oracle.json` and
`/tmp/burette-sdf-restored-export-oracle.json`.

At 320 × 720, the original context submenu extended to x=334. Its minimum
width now respects Radix's available width and the viewport. After rebuilding,
the light SDF item occupied x=162–311 and the dark item x=9–164. Enter activated
the export and focus returned to the workspace tab. Escape dismissed the
menus, and the viewport was reset before the final ordinary reopen.
Screenshots are `/tmp/burette-sdf-export-320-light.png`,
`/tmp/burette-sdf-export-320-dark.png` and
`/tmp/burette-sdf-export-reopened.png`.

The scene-save regression checks exact source text and refusal on absent,
changed or failed source capture. The scientific SDF/MOLX flow additionally
checks the source returned before and after logical restoration.
`vp run build:agent-shell` passed after the submenu fix.

This run starts from the previously generated capped polymer and its MOLX.
A fresh builder Create → SDF export → reopen sequence, complete keyboard-only
menu navigation, native save-dialog acceptance and the exact B3 Relaxed result
remain open. The existing capped structure still has Not converged status.

A follow-up keyboard check on the reopened `Polymer.sdf` found that Shift+F10
focuses the workspace tab but does not open its context menu. The tab currently
opens this menu through `onContextMenu`; keyboard invocation needs a follow-up.
Export also appends `.sdf` when the source document title has no extension.
The workspace tab's display-name override is separate from that source title.

Final focused validation passed `bun tests/test-scene-save-sidebar.mjs` and
`vp run test:science-sdf-molx-flow` (the logical flow has 85 assertions).
The final packaged build passed after the filename correction. Logs are
`/tmp/burette-sdf-source-export-tests-final.log` and
`/tmp/burette-sdf-source-export-build-final.log`. The broader JS gate is tracked
separately in `/tmp/burette-sdf-source-export-ci.log`; it was started before the
final submenu and filename corrections, and is not evidence for those changes.

### Keyboard access to the export menu (2026-11-03)

Workspace tabs now invoke their existing context menu on Shift+F10 and the
ContextMenu key. Keyboard invocation anchors the menu below the focused tab.
The anchor is captured before asynchronous menu preparation. Read-only tabs
retain their existing navigation-only keyboard behavior.

After rebuilding and reloading the packaged browser shell on port 65427,
Shift+F10 opened the capped SDF's menu. Typing `ex` selected Export; two
ArrowRight presses reached Structure → SDF. Enter downloaded
`burette-ui-capped-polymer (3).sdf` and returned focus to the originating tab.
At 320 × 720 in dark mode, the same keyboard path reached SDF within the
viewport (x=118–290); Escape closed all menus and returned focus to the tab.
In light mode at 320 × 720, the ContextMenu key opened the menu and the same
typeahead/arrow/Enter sequence downloaded `(4).sdf`, again restoring tab focus.
Both files exactly match the source hash recorded above.

At 760 × 720 in light mode, keyboard invocation and typeahead opened Rename
tab. Enter accepted the display name `Keyboard polymer`. Its export submenu
remained keyboard-accessible. ArrowLeft from SDF returned focus to Structure,
and Escape returned focus to the renamed tab with no menus remaining.
The temporary viewport override was reset. Screenshots are
`/tmp/burette-tab-keyboard-320-dark.png`,
`/tmp/burette-tab-keyboard-320-light.png` and
`/tmp/burette-tab-keyboard-760-light.png`.

`bun test tests/test-editor-tabs-window.test.tsx` passed both existing tests
(1,020 assertions covering document indexing, 1,000-tab keyboard navigation,
focus, range dragging and pinned close behavior). `vp run typecheck` and
`vp run build:agent-shell` passed. Logs are `/tmp/burette-tab-keyboard-test.log`,
`/tmp/burette-tab-keyboard-typecheck.log` and
`/tmp/burette-tab-keyboard-build.log`. The new shortcut's acceptance evidence
is the actual browser sequence above. Native popup acceptance remains open.

The earlier `vp run ci:fast js` invocation completed with exit code 0 (session
36611, `/tmp/burette-sdf-source-export-ci.log`). It began before the later UI
corrections, so final keyboard behavior is supported by the focused checks and
browser runs here. Full stage-7 acceptance, including capped B3 relaxation and
a fresh Create → export → reopen sequence, remains open.
