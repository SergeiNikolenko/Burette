# Stages 1, 2 and 9 evidence: coordinates, editing and I/O

## Stage 2: atom order, stereochemistry and measurement identity

- Edit → Atoms moves a row with Option+↑/↓, the Move up/down buttons or
  a drag from the atom label. The insertion line marks the destination.
  Each move writes one undoable draft. V3000 bond endpoints, atom parity and
  enhanced stereo collections follow the new row IDs.
- In a fresh `vite-dev` shell in the Codex in-app browser on 2026-11-03,
  Option+↓ on the lactic acid stereocentre moved C2 to C3 while keeping its
  coordinates. Undo restored C2 and Redo restored C3. Dragging its atom label
  below H12 moved it to C12, which remained selected.
- Save copy from the keyboard reorder downloaded a MOL with SHA-256
  `1e505cd3af1c2d5782a20a4423a82cacf4981d318cf500d8537c50340b440228`.
  RDKit 2026.09.1 found the same isomeric SMILES and configuration R at
  atom 3 (atom 2 in the original). The ordinary file picker opened the saved
  MOL in a second workspace tab. After browser reload that imported tab
  restored to 3D, and its Edit table still showed O2 followed by C3.
- The independent RDKit oracle validated 24 saved and reopened copies of
  six fixtures and checked 20 written atom parities. It compares bonds, atom
  identity and coordinates, CIP of atom and double-bond stereo, and isomeric
  SMILES. See `tests/fixtures/reorder-stereo/oracle-cases.ts` for the commands.
- Draft transaction tests cover retaining measurements by atom identity
  across multiple reorders and their inverses, and publication only after a
  successful source write. In the packaged browser shell, Edit → Atoms →
  Move down swapped the first two atoms of the edited butanol. Both scene
  measurements survived the reload. The dihedral dialog followed its atoms
  from C1–C2–C4–C5 to C2–C1–C4–C5, then back on Undo and forward on Redo.
  Each readback was −75.0000000005°.

## Stage 1: editing a distance from a 3D measurement

- Codex in-app browser, fresh `vite-dev` shell, 1280 × 720, light theme,
  2026-11-03. Opened the 15-atom RDKit butan-2-ol SDF. Ball & Stick →
  atom context menu → Picking level: Atom → Analyze → Measure distance.
  Picked C4 then C2 and opened Scene → Distance settings → Set distance.
- The dialog reported 1.49427533273 Å and identified the C4 fragment as
  the smaller side. Applied 1.7 Å. The measurement survived the scene
  rebuild and reopened at 1.69999999999 Å. Edit → Undo restored C4 to
  (0.592, 0.630, −0.608) Å as displayed. Redo returned it to
  (0.777, 0.665, −0.691) Å. The stationary C2 stayed in place.
- Save copy downloaded an SDF with SHA-256
  `034ad75f8e2e0451f43bc73a2d7d5f105769d42690d6fe5e7017ff78197c9017`.
  RDKit 2026.09.1 read 1.699999999990 Å. All coordinate components were
  within 2.62e−11 Å of its independently transformed conformer. The
  isomeric SMILES and `SOURCE_NOTE` matched the original. The ordinary
  file picker reopened the downloaded SDF in a second 3D workspace tab.
- The React Compiler and Mol* harness exercises distance, angle and
  dihedral edits on MOL V2000, MOL V3000 and SDF. It checks byte-level
  Undo, source properties, wrong frame and source rejection, ring and
  XYZ refusal, and cancellation while a capture is pending. Angle and
  dihedral still need browser gestures. This run did not test package
  surfaces or a live reorder of measured atoms.

## Stage 1: angle and dihedral in the packaged browser shell

In the prebuilt static shell (Codex in-app browser, light theme, 1280 × 720),
open the 15-atom butanol fixture, choose Ball & Stick and set Picking level
to Atom. Right-click the molecule and use Analyze → Measure angle. Pick
C4–C2–C1 and open Scene tree → Edit Angle settings → Set angle. The initial
value was 114.172078759°. Enter 112 and Apply. The scene displayed 112.00°
and the restored measurement opened at 112.000000002°.

Use Analyze → Measure dihedral and pick C1–C2–C4–C5. In Set dihedral, type
35° and Cancel. Reopening showed the original −60.0011198951°. Applying −60°
read back −59.9999999993°, and applying −75° read back −75.0000000005°.
Edit → Undo restored −59.9999999993°, and Redo restored −75.0000000005°.

Edit → Save copy downloaded the revised SDF (SHA-256
`82725f7ed4445f4514c636265e5a90474b6028b4494d3ed419faaa4839f7b8b9`).
The ordinary file picker reopened it in a separate 3D tab. RDKit 2026.09.1
replayed `SetAngleDeg(3, 1, 0, 112)` and
`SetDihedralDeg(0, 1, 3, 4, -75)` from the input. The largest coordinate
component difference was 1.29 × 10⁻¹⁰ Å. The isomeric SMILES and
`SOURCE_NOTE` survived. The original SDF remained byte-identical (SHA-256
`9096c1c116aafe190d4f7bfd07ef94d6e81df4b378a7437963738ff92d749548`).

The packaged viewer's native compute restriction is separate from graph
editing. Menu regressions keep the coordinate command hidden on hosted,
visualization-only, Quick Look, XYZ, docking and multi-pose inputs.
At 760 × 720 in both themes, Enter opened the dihedral settings and command,
the dialog focused its numeric input and showed Cancel and Apply, and Escape
closed it. Live negative cases and dirty draft recovery remain open. The
in-app browser dismissed the before-unload prompt during the dirty reload
attempt, so the visible draft was not evidence of recovery.

## Stage 9: browser routes for compressed files

- In a fresh `vite-dev` shell in the Codex in-app browser on 2026-11-03,
  `mini.pdb.bgz`, `mini.cif.zst` and `mini.pdb.gz` each reached the 3D viewer.
  The corrupt `truncated.pdb.gz` did not create a workspace tab.
- Vite serves `.gz` files under `/@fs/` with HTTP gzip encoding. The browser
  consequently receives already decompressed bytes. The bounded raw file route
  returned the valid 274-byte fixture and the truncated 100-byte fixture
  unchanged, without a content encoding header.
- Download → Original for `mini.pdb.gz` produced a file identical to the
  fixture by byte comparison and SHA-256
  `2f34392ab1abfcd469b61d18dafc07f557cd16902e1803f2e4d1ffc2ca8ec5ed`.
  The Zstandard menu showed Text, Compressed and Original for the CIF.
- `test:compressed-routes` covers picker, window and dock drop, stored imports,
  disk reads, decoder and storage failures, stale reads, and the download
  adapter. Independent gzip, XZ and Zstandard tools decode its written copies
  to the edited text, and a copy reopens in the harness.
- In the prebuilt-static browser shell on 2026-11-03, ordinary picker import
  of a 249-byte gzip ethanol SDF showed three atoms/two bonds. Edit → More
  actions → Add hydrogens produced nine atoms/eight bonds. Download → Compressed
  wrote a 778-byte gzip, decompressing to 1,404 bytes with SHA-256
  `d6dac03af4e57ee6d74c098460ccf75663bcdf19ec1628a8926acf91e89af472`.
  Opening that exact downloaded file through New tab → Open file produced a
  separate document with a 3D view, nine atoms/eight bonds, `SOURCE_NOTE` and
  `BURETTE_METADATA_V1_extra`. Independent Python gzip/RDKit checks confirmed
  those atom/bond counts and zero displacement of all three heavy atoms.
  Download → Original after editing retained the exact original gzip bytes,
  SHA-256 `47794e604a5cfda4e3548f52fa30729a963129fdbc017cb8a49eba462f79290d`.
- Remaining browser scenarios include drop and reload of an IndexedDB import.
  The dirty-document reload attempt retained
  the same top-level loader ID, so it provides no recovery evidence. Native
  acceptance remains separate.

### XZ and Zstandard edited-copy reopening, 2026-11-03

The `prebuilt-static` shell at `767cb673c` opened
`tests/fixtures/compressed/caffeine.sdf.xz` with 24 atoms and 25 bonds.
In Edit, select O1, double-click its X field, enter `0.5` and press Enter.
After the row reports 0.500 Å, Download → Compressed writes `caffeine.sdf.xz`.
Cmd+O opens that downloaded file as a separate document. Opening its Edit
panel reports O1 at (0.500, 2.569, 0.001) Å and 24 atoms/25 bonds.

For Zstandard, decompress the same original fixture with `xz -dc` and compress
it with the independent `zstd` CLI. Import the resulting
`burette-parity-caffeine.sdf.zst` through Cmd+O, change O1 X to `0.6` and choose
Download → Compressed with Enter. Reopen the downloaded file through Cmd+O.
The imported copy receives the collision-safe name
`burette-parity-caffeine (2).sdf.zst`; its Edit panel reports O1 X = 0.600 Å,
24 atoms and 25 bonds. Browser error logs were empty.

Python LZMA and the independent `zstd -dc` CLI decoded the downloads. RDKit
confirmed unchanged isomeric SMILES and all original SDF properties. Each
copy changed only atom 0, axis X, from 0.47 Å to its requested value, with no
other displacement above 1e-8 Å. Both copies added `BURETTE_METADATA_V1` with
24 atom identities. The decoded SHA-256 hashes are
`e85be636640d828184d825ba21ab0b6520b039218c7d46bfc6352f22f1518f7f`
(XZ) and `ea6d6885c5f8e475808a7c15da75cbef0b9bb6ac04807914b2d81c7b27301f24`
(Zstandard).

Dark 1280 × 720 screenshots show the complete reopened molecules and coordinate
tables. Light-theme checks exposed remaining layout problems: at 760 × 720,
the XZ molecule is clipped on the right with Edit open after resizing; at
320 × 720, the reopened Zstandard coordinate table is readable, but its
Atoms/Bonds/Cartesian selector is partially covered. These remain acceptance
gaps. Local artifacts are `burette-compressed-roundtrip-oracle.json`,
`burette-xz-reopened-dark.png`, `burette-xz-reopened-light-760.png`,
`burette-zstd-reopened-dark.png` and `burette-zstd-reopened-light-320.png`.
This covers compressed SDF coordinate edits and picker reopening. Drop,
crash/reload recovery, broader format coverage and native counterparts remain
open.

The complete `vp run test:ui` command at the same source baseline exited 0,
including `test-logical-xyz-topology.test.tsx` and
`test-logical-xyz-topology-metadata.test.tsx`, and continued through the final
metal-complex dialog suite. Vite+ reported 0/500 cache hits. `vp run check:js`
also exited 0. The local UI log is `burette-parity-test-ui-767cb673c.log`.
The harness still emits React `act` and animation warnings. This regression
result does not close the browser layout or unexecuted acceptance cases above.

### Edit list selector height, 2026-11-03

The original prebuilt browser reproduces a 4 px List track at 320 × 720,
although its Atoms/Bonds/Cartesian buttons are 24 px tall. The Edit grid's
automatic tracks shrink the horizontally scrollable control when the atom
table exceeds the panel height. Edit now uses `grid-auto-rows: max-content`
so its rows keep their intrinsic height and the panel scrolls vertically.

After rebuilding `build:agent-shell`, the fresh prebuilt browser shows a
28 px track and 24 px buttons at 320 × 720. Selecting O1 expands coordinate
and metadata fields without collapsing the track. ArrowRight and Space select
Bonds and Cartesian; the latter's distance-unit selector also remains 28 px.
Dark Atoms and light Cartesian screenshots confirm readable controls. The
ordinary file picker reopens the previously exported XZ in a separate tab,
with 24 atoms, 25 bonds and O1 X = 0.500 Å. Its list track remains 28 px at
light 760 × 720, dark 1280 × 720 and dark 320 × 720 with O1 selected.
Browser errors are empty. `test:structure-edit-panel` passes both 13-test
suites, and the shell build exits 0. `test-burette-agent-plugin.mjs` also passes.
Generated JavaScript and HTML changes only replace the rebuilt CSS filename.

Local evidence includes `/tmp/burette-edit-layout-before.png`,
`/tmp/burette-edit-layout-fixed-dark-320.png`,
`/tmp/burette-edit-layout-fixed-light-320.png`,
`/tmp/burette-edit-layout-fixed-light-760.png`,
`/tmp/burette-edit-layout-fixed-dark-1280.png`,
`/tmp/burette-edit-layout-reopened-dark-320.png` and
`/tmp/burette-edit-layout-observe.json`. This closes the list-selector clipping
case above. The previously observed molecular camera crop after resizing,
native acceptance and the other stage requirements remain open.

### Camera framing after resize, 2026-11-03

On `8e2eb7f38`, a fresh prebuilt browser opened caffeine SDF/XZ at
1280 × 720 with Edit visible. Resizing to 760 × 720 leaves a 399 × 680
viewer iframe. The molecule remains clipped on the right after the resize has
settled. The screenshot therefore represents a persistent framing issue,
rather than only an intermediate compositor frame.

The current resize contract in `docs/performance.md` explicitly retains camera
and projection scale. `scheduleViewerResize` and `deferViewerResize` resize and
redraw the canvas without requesting a camera reset. Automatic refitting would
change that contract and must account for deliberate user zoom and pan.

At the narrow size, Camera → Reset zoom activated with Enter restores the full
molecule. In light mode, Enter opens the Camera menu with Reset zoom focused,
and a second Enter executes it. The selected projection remains Perspective,
and Edit still shows 24 atoms, 25 bonds and O1 (0.470, 2.569, 0.001) Å.
Browser errors are empty. This proves the explicit framing route in both
themes. Adaptive automatic framing and the wider camera/scene matrix remain
open; no camera policy was changed by this investigation.

Local screenshots are `/tmp/burette-resize-before-wide.png`,
`/tmp/burette-resize-settled-760.png`,
`/tmp/burette-resize-reset-zoom-760.png` and
`/tmp/burette-resize-reset-zoom-light-760.png`. The typed observe response is
`/tmp/burette-resize-narrow-observe.json`.

### Hydrogen source-pose preservation, 2026-11-03

- OCL parsing and `toMolfileV3()` can invent a diagram when bonded atoms
  coincide. The reader now restores physical coordinates from source atom
  records through OCL's atom mapping. The writer uses a private compact copy,
  retains valid source parity/CIP status, and writes captured physical positions.
- The real-worker draft suite covers coincident V2000/V3000 inputs, unchanged
  draft/history on refused AddH and protonation, and valid V2000, V3000 CRLF,
  and continued V3000 records adding six hydrogens with original coordinates
  retained and one Undo entry.
- Source-stereo, normalization/reorder, and draft suites pass with 18 tests
  and 1,077 assertions. RDKit checks include unknown tetrahedral, axial and
  E/Z constraints. The hydrogen geometry suites also pass nine tests with
  536 assertions, including near-linear geometry and rigid-motion covariance.
- Live Vite runtime on port 61441, opened through the in-app browser's ordinary
  picker with `burette-parity-coincident-ethanol.sdf`, displays C1 and C2 both
  at (-0.467, -0.308, -0.409) in the rounded Edit atom table.
  Edit → More actions → Add hydrogens displays
  `Cannot place hydrogens on coincident bonded atoms.` Three atoms and two
  bonds remain, with Undo disabled and displayed coordinates unchanged.
- Positive live acceptance on the patched runtime, packaged browser acceptance,
  and full JS CI on the final patch remain pending. Browser control returned
  `browser.user is unavailable` during the positive-scenario continuation.
- After restoring browser control, the rebuilt prebuilt-static runtime at
  `127.0.0.1:51272` passed the positive picker → Edit → Add hydrogens scenario
  for `burette-parity-ethanol-hydrogens.sdf`: 3 → 9 atoms, Undo → 3, Redo → 9.
  The displayed C1/C2/O3 coordinates retained their original rounded values.
  Exact exported coordinates, packaged coincident-input rejection, and full CI
  on the final patch still require verification.
- Save copy from that patched packaged session produced
  `burette-parity-ethanol-hydrogens (3).sdf`, SHA-256
  `10704ce84c25b7772331e46a2c881da4da47f822e3e6b14cc174bc04d071080f`.
  Independent RDKit parsing confirms nine atoms, eight bonds, and exactly
  zero coordinate difference for the original three atoms. Both `SOURCE_NOTE`
  and `BURETTE_METADATA_V1_extra` retain their source values. The exact reserved
  `BURETTE_METADATA_V1` field adds atom/conformer identity metadata.
- The same rebuilt packaged runtime rejects the coincident fixture through
  Edit → Add hydrogens with the expected alert, Undo disabled, and the original
  rounded C1/C2 coordinates retained. Reopening the exported positive SDF
  through the picker creates a separate document with nine atoms and both
  user properties visible; the exact reserved identity field stays hidden.

### Explicit preview and delayed topology publication (2026-11-03)

The full JS run failed while waiting for a restored MOLX topology candidate to
be promoted. A separate replay also lost the candidate's `contentWindow` during
native scene attachment. The controller's explicit Apply left the 450 ms live
preview timer pending, allowing a second preparation to replace the first
candidate while its native scene was loading.

`preparePreview` now consumes that pending timer before preparing a candidate.
The compiled controller/ViewerFrame/native MolStar integration test deliberately
waits 600 ms after explicit Apply and checks that the same candidate remains.
The assertion fails on the previous implementation and passes with the fix.
The existing assertions still verify native layers, measurements, provenance,
atom UUIDs, topology Undo/Redo, MOLX export/reopen, cancellation, and refusal of
unsupported metadata. Failure messages now include the rendered diagnostic.

`test:logical-xyz-topology`, `check:logical-xyz-topology`, and
`test:geometry-topology-binding` pass. These are compiled integration checks.
Live browser acceptance of this timer interaction and a completed full JS run
on the fix remain pending.

### Coordinate editing after MOLX restoration (2026-11-03)

The packaged browser shell reopened the previously exported unspecified-alanine
MOLX with 13 atoms and 12 bonds. Edit → Atoms → C1 → X changed
−2.6904938582 Å to −2.5 Å. Undo restored the original displayed coordinate and
Redo restored −2.5 Å. Save scene downloaded a MOLX, and the ordinary picker
reopened that file in a separate document whose Edit table showed −2.500 Å.

The first run exposed a scientific regression: coordinate-only `update-atom`
reparsed the wavy stereo bond as AND stereo and exported C2 with CFG=1 and a
STERAC group. `editGraph` now retains the source's unknown atom/bond stereo
constraints for coordinate-only updates, using the same mechanism as atom
reordering. The captured pre-edit logical source is the regression fixture
`tests/fixtures/graph-normalization/unknown-alanine-3d.mol`.

The complete gesture, Undo/Redo, scene download and picker reopen were repeated
on the rebuilt packaged shell. Independent RDKit 2026.09.1 inspection of the
downloaded ZIP confirmed exactly one changed coordinate component, C1 X, and
the same isomeric SMILES with C2 unspecified (`?`). Document UUID
`7f33ed51-62a6-48e9-a61f-7b2cd67067ae` and all 13 atom UUIDs matched the original.
The embedded Mol* raw source matched the science attachment, whose SHA-256 was
`259bad2e92561ccf5ad49647c54be13ff8effe261059ba5d9985ff28473ed159`.
No browser console errors were recorded on the corrected replay. Local evidence
is `/tmp/burette-restored-molx-coordinate-oracle.json` and
`/tmp/burette-restored-molx-coordinate-fixed.png`.

The graph-normalization and graph-worker suites pass (9 tests, 160 assertions).
This run covers a coordinate-only edit in one restored molecule. Chemical
identity/topology edits, the theme/viewport accessibility matrix, and native
editing acceptance remain open. The Edit panel's Save copy stayed disabled for
the restored source; scene saving used the workspace tab's Save scene action.

### Save scene from the restored Edit panel (2026-11-03)

The disabled Save copy described above protected the MOLX archive from the
plain-text source writer. For a restored logical source, the Edit panel now
offers Save scene through the existing workspace scene workflow. The source
writer remains guarded; the scene path captures and confirms the acknowledged
source revision and reports failures through the existing workspace toast.

In the rebuilt packaged browser shell, opened the original unspecified-alanine
MOLX, changed C1 X to −2.4 Å, then clicked Save scene in the light theme at
1280 × 720. In dark mode at 320 × 720, Tab from More actions focused Save scene
with a visible focus ring; Enter downloaded a second MOLX. The control wrapped
within the panel without horizontal clipping. Both archives carried identical
logical source bytes (SHA-256
`0877a3244b736b8a2fd579dcce751c4d65f3dda1c6da85fcf3ccfe69cc14de8a`).
RDKit 2026.09.1 confirmed exactly one changed coordinate, 13 atoms/12 bonds,
unchanged isomeric SMILES and unspecified C2. Document and atom UUIDs survived.
Embedded Mol* raw data equalled the science source attachment in each archive.
The ordinary picker reopened the keyboard-saved file; Edit at 760 × 720
displayed C1 X = −2.400 Å. Browser error logs were empty.

Evidence: `/tmp/burette-edit-save-scene-oracle.json`,
`/tmp/burette-edit-save-scene-light.png`,
`/tmp/burette-edit-save-scene-dark-320.png`, and
`/tmp/burette-edit-save-scene-reopened-760.png`. The wide screenshot also shows
the restored camera placing part of the molecule outside the viewport; camera
framing after restoration remains to be investigated. Theme and viewport
emulation were reset after the check.

Validation passed: typecheck, agent-shell build, plugin checks, structure-edit
panel suites (13 tests both uncompiled and React-compiled), and
`test:science-sdf-molx-flow` (6 codec/export tests and one compiled scene flow).
This establishes the Edit-panel save route for this restored molecule. Full
accessibility, topology-edit acceptance and native scene saving remain open.

### Generate 3D camera framing and scene round trip (2026-11-03)

The preceding offscreen-molecule observation originated before scene restoration.
The old MOLX already stored a camera target of
`[1.483960696, -0.310107396, -0.089953089]` for the original 2D depiction,
while its generated 3D molecule occupied a different coordinate frame.
Graph edits always requested camera retention, including Generate 3D.

Generate 3D now requests a fitted preview. Its history snapshot records that
transition policy, so Undo and Redo fit the destination geometry too. Subsequent
coordinate edits and their Undo/Redo retain the current camera. The existing
source lifetime, revision, topology and publication guards still govern writes.

In a freshly launched `prebuilt-static` browser shell, the same unspecified
alanine MOL generated 13 atoms and 12 bonds, with MMFF94/BFGS converging from
39.08 to 22.46 kcal/mol in 136 steps. The molecule remained fully visible after
generation, Undo to six atoms, and keyboard Redo. Scene save through the tab
menu, picker reopening, and keyboard scene resave passed. Visual checks covered
dark 1280×720, light 760×720 and the restored scene at dark 320×720. Browser
error logs were empty. Theme and viewport emulation were reset.

Independent RDKit parsing and SHA-256 comparison found the exact same MOL bytes
in the old archive, new archive and reopened/resaved archive:
`0afe706f2c15ecbf0693f7af5925b7cd4f209155645033f8f43da29050e20f1d`.
The unspecified tetrahedral center remained `[(1, '?')]`. The new camera target
was `[-2.951804623, -2.480567615, -0.876522918]`; reopening and resaving retained
its target and up vector. Local evidence is in
`/tmp/burette-3d-camera-oracle.json`, `/tmp/burette-3d-camera-generated.png`,
`/tmp/burette-3d-camera-undo.png`, `/tmp/burette-3d-camera-reopened-light.png`,
and `/tmp/burette-3d-camera-dark-320.png`.

Typecheck, agent-shell build, plugin checks, structure-edit panel tests
(13 ordinary and 13 React-compiled), and the compiled graph adapter tests
(3 passed, 59 assertions), and `test:science-sdf-molx-flow` (6 codec/export
tests and one compiled scene flow with 85 assertions) passed. The new adapter regression covers the
generation transition and subsequent coordinate-edit Undo/Redo camera policies.
Existing archives retain their saved camera, including old offscreen views.
Full accessibility, native runtime and the broader editing matrix remain open.

### Manual Apply retains the draft camera policy (2026-11-03)

The live-preview timer passed the graph edit's `keep`/`fit` policy directly to
preview preparation. Explicit Apply and retries omitted it. The policy now
belongs to the internal draft revision and is replaced on each accepted edit.
Both entry points read that policy. Topology ownership and camera-transfer
precedence remain in the existing preview preparation path.

The compiled-controller regression exercises immediate Apply before the live
timer, manual-sized drafts, retry after runtime creation fails, and a subsequent
ordinary edit that clears `fit`. All 10 prerequisite tests passed (49 assertions).
The test stops at the preview-runtime boundary and does not prove rendering.

Typecheck, the agent-shell rebuild, plugin checks, and the full `test:ui` sweep
also passed (492 top-level commands, 0/500 cache hits, exit 0). The rebuilt
browser bundle contains the policy change. Browser acceptance below used the
source-backed Vite runtime, not a new packaged/native installation.

A fresh `vite-dev` browser checked the manual path with an SDF containing one
`unspecified-center.mol` record and a 1,100,000-character `PADDING` property
(1,101,212 input bytes). Generate 3D changed four atoms/three bonds to nine/eight,
with MMFF94/BFGS reporting 21.92 to -14.81 kcal/mol, 81 steps, Converged.
Text displayed `Preview Not Applied`. Apply Preview via Enter promoted the
candidate and displayed `Edited`; the generated molecule was fully visible.
Redo followed by pointer Apply was also checked in light mode. These checks used
1280×720; responsive acceptance of this manual workflow remains open.

RDKit independently parsed the Save copy download. The heavy-atom mapped SMILES
remained `[CH3:101][CH:102]([OH:103])[F:104]`, the unspecified center remained
`[(1, '?')]`, and `PADDING` and `FOREIGN_MULTILINE` were retained exactly.
The output SHA-256 was
`ce6d78946520273c8b097c450e92a3d68b47272b0153bacc8f74c73ddc958d4f`.
Local evidence includes `/tmp/burette-apply-manual-oracle.json`,
`/tmp/burette-apply-manual-observe.json`, and screenshots
`/tmp/burette-apply-manual-after.png` and `/tmp/burette-apply-manual-light.png`.
The typed browser observation reported the viewer ready. Test tabs and owned
servers were closed, and theme emulation was reset.

This run exposed another gap: Undo to the original text of a manual-sized draft
displayed `Saved` and removed Apply Preview. The follow-up below fixes the
dirty-only gate. Recovery of camera policy after a new top-level loader and
native acceptance remain open. Initial external `/tmp`
fixture attempts returned HTTP 403 even with an explicit filesystem allow root;
the successful run used the worktree's ignored test directory. A fixture setup
mistake initially appended a second SDF record and was corrected before the
single-record editing scenario above.

### Manual Undo keeps Apply available (2026-11-03)

The Text dock now keeps Apply Preview available for a manual-sized source whose
preview is pending, including when Undo restored the exact saved bytes. Source
status reports `Saved — Preview Not Applied`, then `Updating Preview…` while the
candidate is prepared, and `Saved` after promotion. Save copy stays disabled for
the clean source. A failed preparation reports `Saved — Preview Paused` and can
be retried. Dirty manual sources retain the existing Apply behavior.

A fresh source-backed `vite-dev` session used the same single-record 1,101,212-byte
SDF above. Generate 3D and Enter on Apply produced nine atoms/eight bonds.
Pointer Undo restored the original draft, with Apply still enabled and Save copy
disabled. Enter on Apply restored the visible flat molecule and all four source
coordinates: C1 (0,0,0), C2 (1.299038,0.75,0), O3 (2.598076,0,0), and
F4 (1.299038,2.25,0) Å (the Edit table rounds to three decimals).
Keyboard Redo followed by pointer Apply restored the generated scene. A second
Undo/Apply cycle succeeded in light mode at 760×720. Dark mode used 1280×720.
The Mol* agent's completed `summary` responses independently reported nine atoms
after Redo and four after the second Undo/Apply. This checks the renderer model
as well as the draft-backed Edit table. The previous RDKit export check remains
separate evidence; this follow-up did not repeat export/reopen or measure the
renderer coordinates numerically.

Local evidence: `/tmp/burette-redo-actions.json`, `/tmp/burette-undo-summary.json`,
`/tmp/burette-undo-before-apply.png`, `/tmp/burette-undo-applied-dark.png`,
`/tmp/burette-undo-manual-light-760.png`, and `/tmp/burette-undo-applied-light.png`.
The controller regression passed all 11 tests / 53 assertions, including clean
pending state, failure and retry with the retained camera policy. Typecheck,
agent-shell rebuild and plugin checks passed. The controller harness stops at
runtime creation; the Browser run above supplies the rendering evidence.
The full `vp run test:ui` completed with exit 0 (492 top-level commands,
0/500 cache hits). Its log is `/tmp/burette-undo-ui.log`. The Browser tab and
owned server were closed, and temporary viewport/theme overrides were reset.

Accessibility remains partial: Enter works on Apply and Redo, but after a clean
Apply succeeds the disappearing button returns focus to the page. Full focus
continuity, 320px acceptance, loader recovery, packaged/native acceptance and
the complete scene/history matrix remain open.


### Apply focus handoff (2026-11-04)

The disappearing Apply Preview action now hands focus to the text editor only
when the action still owns focus. Moving focus to Find during preview keeps it
there. The component regression covers both cases and retains button focus
through intermediate updates: 8 tests, 29 assertions passed. Typecheck, the
agent-shell rebuild and plugin checks also passed before the connection loss.

The recorded browser-dev run before interruption applied the clean Undo source
with Enter at 1280px in dark mode; after Saved, focus was on `.cm-content` and
the editor was contenteditable (`/tmp/burette-focus-dark.png`). The 320px light
view was opened but Apply was not exercised there. This is not full keyboard,
native, document-switch or dock-unmount acceptance. The callback runs when the
button detaches, not exclusively on successful preview completion.

Recovery inspection found no running UI test process and no terminal summary in
`/tmp/burette-focus-ui.log`; that interrupted broad run is not counted as passed.
The prior successful Undo suite remains separate evidence. The original browser
tab was no longer available after reconnect. No new build was needed to recover
the already generated shell assets.
