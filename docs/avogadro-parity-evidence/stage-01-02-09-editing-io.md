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


### SDF export confirms after destination selection (2026-11-04)

Validated SDF export now passes the captured source confirmation to the shared
text writer. The writer confirms after the native destination dialog and before
`save_text_as`; browser downloads confirm before creating their copy. Changing
or closing the source while choosing a destination therefore rejects the export
instead of writing the earlier coordinates. Cancelling skips both the check and
write. Other exports may omit the optional callback.

`tests/test-scene-save-sidebar.mjs` executes the transpiled production export and
writer bodies, with the native picker and filesystem invocation replaced at the
platform boundary. It verifies exact saved bytes, a changed source while the
picker is pending (no write), and cancellation (no check or write). The focused
check and TypeScript check passed. This is handler-level evidence; a packaged
macOS dialog run is still pending and is not inferred from it.

Next scene-save acceptance: open a scientific MOLX, add another molecule, remove
that molecule from the scene tree, then save and inspect Original, UUID and the
scientific attachments. The recorded source-path list can retain deleted items;
the early multi-file omission condition currently uses that list. This remains a
code-review finding requiring a real browser reproduction before changing the
binding rules. Do not substitute basename-matched live paths for source identity.


### 2026-11-04: scientific export after removing an added structure

Reproduced on integration source 7cef8491b in a fresh vite-dev browser: open
`tests/fixtures/topology-real-browser-water.molx`, open
`tests/fixtures/mesoscale/basic/mini.pdb`, use Add to scene, remove mini.pdb in
the scene tree, then Save scene. Only water remained, but the downloaded MOLX
contained only state.json. The recorded file history incorrectly triggered the
multiple-structure scientific export exclusion.

Export now checks the live structure count when the recorded history contains
multiple files, then still requires the normal source/coordinate binding and
snapshot confirmation. A final-source browser run verified both cases: two live
structures save with the explicit omission warning and no redundant action-error
toast; removing the added PDB saves the scientific MOLX successfully. Opening
that download through New tab → Open file restores water and the compute menu.
The observed viewport was 1280 × 720 in the dark theme.

Independent ZIP inspection confirmed identical source and Original bytes,
document UUID and atom IDs. Scientific JSON differed only by the normalized
referenceFrameIndex field. Evidence: `/tmp/burette-membership-final-oracle.json`,
`/tmp/burette-membership-reopened.png`; final single-source download:
`/Users/nikolenko/Desktop/topology-real-browser-water (4).molx`.

Validation: science-host suites pass (14 tests, 74 assertions), including
multiple live roots, removal with retained history, and a remaining structure
whose coordinates do not match the source. Typecheck and agent-shell build pass.
This fixes the reproduced data-loss path; it does not close the complete scene
matrix. Both-theme/responsive, other source-replacement paths, native
picker and packaged runtime interaction acceptance remain separate open gates.


### Identical appended structure ownership (2026-11-04)

A production-adapter regression test reproduced the remaining identity gap on
c80d79b57: append an identical XYZ object, remove the original root, and export.
The host returned science despite the surviving object belonging to the append.
The pre-fix result is recorded in `/tmp/burette-identical-before.log`.

The local runtime now records appended structure refs per plugin and rejects
scientific binding to those objects. It blocks binding while append is active,
preserves provenance through tree removal/Undo, and resets it on a new scene
import. Restoring the original root permits export again. No coordinate or
basename heuristic substitutes for the append provenance.

Focused checks pass: science-host 15 tests/78 assertions, science-runtime 20/155,
import-receipt 2/10, scene-file-actions import/rollback checks and typecheck.
A fresh vite-dev Browser run also verified the ordinary picker and tab-menu
path using the water MOLX and an extracted byte-identical XYZ. Add to scene,
remove water-owned.xyz, then Save scene produced only state.json with an explicit
omission warning. Back restored the original; removing duplicate.xyz and saving
then preserved the source, document UUID, atom IDs and Original bytes. Independent
ZIP results are in `/tmp/burette-identical-oracle.json`; screenshot:
`/tmp/burette-identical-recovered.png`. The initial direct temporary-path open
failed, so both fixtures were loaded through the ordinary browser chooser.

The omission path also shows a redundant Structure action failed toast; this
notification behavior remains open. The tested viewport was dark, 1280 × 720.
Reopen of these particular exports, light/compact interactions, and packaged or
native UI remain unverified. No whole-scene or whole-stage completion is claimed.

## Expected absent science owner notification (2026-11-04)

The identical appended-copy scenario above previously showed both the expected
omission warning and an unrelated `Structure action failed` toast. Inspection now
returns `{ unavailable: "SCIENCE_SOURCE_REMOVED", reason }` as a successful
`scene_science_binding` result for precisely the tracked appended-root case.
The export owner converts it to `unsupported`; strict binding and serialization
still reject that root. Loading, graph identity and other runtime errors still
throw. Existing SDF binding response fields are unchanged. Restore still rejects
an unavailable report via its required binding validator.

Browser-dev verification on parent `732ad763d` plus this patch, IAB 1280 × 720:
open `topology-real-browser-water.molx`, open the identical `duplicate.xyz` using
the ordinary picker, Add to scene, remove `water-owned.xyz`, Save scene. The only
save notification was `Scene saved without scientific data` with the precise
reason `The original scientific structure was removed from this scene.` No
`Structure action failed` appeared. Repeated save with the viewer's light theme
had the same notification (the outer shell remained dark). Screenshots:
`/tmp/burette-binding-report-browser.png` and `/tmp/burette-binding-report-light.png`.

The download-event path was `/Users/nikolenko/Desktop/topology-real-browser-water (5).molx`.
Independent Python ZIP inspection found exactly `state.json`, no science assets;
`/tmp/burette-binding-report-oracle.json`. An initial search selected an older
`(4).molx` and was not evidence for this run. Reopen of the newly downloaded file,
compact/keyboard flows, the fully light host shell and native acceptance remain open.

Focused checks: science-host 16 tests / 81 assertions; science-runtime 20 / 155;
typecheck and rebuilt agent shell passed. Host tests exercise both the explicit
absence report and continued strict rejection, including import-loading failures.
Runtime tests exercise the real viewer action route and unchanged SDF response.

## Unexpected science binding failures stop saving (2026-11-04)

Parent `3b5a44864` still caught arbitrary binding request/validation errors and
converted them into an `unsupported` result for scientific XYZ, including scenes
whose recorded source history contained multiple files. That could let the
allow-omission save path proceed without scientific attachments despite a broken
bridge or malformed report. The regression test failed before the fix: a request
throwing `Viewer connection lost` resolved instead of rejecting
(`/tmp/burette-binding-failure-before.log`). A second pre-fix regression showed
that a missing live structure count was also accepted as an omission
(`/tmp/burette-binding-count-before.log`).

Export now propagates unexpected binding failures for scientific sources. Only
an explicit absent-owner report or a valid non-singleton live inventory can
establish those expected omission cases. The live count must be a nonnegative
integer; missing, negative, fractional and string counts fail before capture.
Plain XYZ's existing non-scientific fallback remains separate. A concurrent
hierarchy change that throws during binding conservatively stops this save;
it is not reclassified from an arbitrary error message.

`test:science-host`: 18 tests, 89 assertions pass, including failed requests and
malformed binding reports for both one-file and multi-file source histories,
four malformed count cases, and the existing explicit absent-owner omission and
original-owner recovery tests. The actual snapshot caller awaits preparation
before sending `workspace_scene_snapshot`, so these errors cannot advance to
archive capture. This is code/host regression evidence, not a live browser
transport-failure reproduction. Browser failure/retry UI acceptance remains open.
The unchanged ordinary omission browser scenario is recorded in the preceding
section and is not relabelled as fault-injection evidence.

Final validation also passed typecheck, scene-save/sidebar contract checks, the
agent-shell rebuild and the plugin check against that completed build. Logs:
`/tmp/burette-binding-failure-{types-final,save,build-final,plugin}.log`.


### Reopen identical-copy ownership exports (2026-11-04)

At `dd74625cc`, a fresh IAB **vite-dev** host reopened the two actual artifacts
from the identical appended-copy scenario above. This closes the earlier missing
reopen check for those files; it does not repeat the append/remove/save sequence.

* `/Users/nikolenko/Desktop/original (1).molx` (original owner retained) restored
  `water-owned.xyz`, Ball & Stick, three atoms. Typed Python `observe` reported
  attached `zmat` science, three atoms/two perceived bonds and the exact source
  SHA-256 recorded in the manifest. All three attachment sizes and SHA-256 values
  independently matched their ZIP bytes. The header offered Original →
  `water-owned.zmat`; the downloaded 65-byte file matched the embedded original
  exactly. Screenshot: `/tmp/burette-science-restored.png`.
* `/Users/nikolenko/Desktop/original.molx` (original owner removed) contained only
  `state.json`. New tab → Open file restored `duplicate.xyz`, Ball & Stick, three
  atoms while the scientific scene stayed open in the adjacent tab. The header
  had no Original download and no imported science was exposed from the neighbour.
  Typed `observe` returned `SOURCE_UNREADABLE`: ordinary state-only MOLX has no
  source-owned text for this automation path. This remains an automation coverage
  limitation, not evidence of restored scientific ownership. Screenshot:
  `/tmp/burette-science-omitted-reopened.png`.

[Compact oracle](science-ownership-reopen-oracle.json) retains scene hashes,
attachment/source checks and the observed typed state. Both views were dark,
1280 × 720. Light/compact/keyboard coverage, repeat saving, unexpected binding
failure/retry and prebuilt/native lanes remain open. No production code changed.


## State-only scene geometry export and computation gaps (2026-11-04)

Fresh `vite-dev` at `6582b8584`, IAB tab 12, opened the same state-only
`original.molx` above (SHA-256 recorded in the oracle). This is an explicit
geometry export from the visible scene, not restoration of source-owned science.

* CLI `act` with `{"type":"export_scene_structure","format":"pdb"}` reached
  terminal `failed`: `ACTION_ERROR`, `PDB fallback export is unavailable for this
  structure.` The fallback in `viewer.js:molstarPdbExportPayloadForAtomSerials`
  requires a source entry. PDB conversion of this restored XYZ scene remains open.
* The same action with `format:mmcif` completed. The 1,131-byte result is preserved
  as [recovered geometry](state-only-recovered-geometry.cif.json) (JSON `text` preserves
  the exact exported bytes, including trailing spaces). Independent Python
  compared its atom-site rows with the inline XYZ in the MOLX `state.json`:
  three atoms, identical O/H/H order, maximum Cartesian coordinate difference
  0.00014170859860740403 Å. Export rounds to three decimal places; it is not an
  exact coordinate round trip. No scientific attachment was reconstructed.
* New tab → Open file loaded those exact mmCIF bytes as
  `/OpenedFiles/recovered-geometry.cif` while the source scene remained open.
  Screenshot: `/tmp/burette-state-geometry-recovered.png`.
* Shipped Python `Workbench.observe()` recognized the new file and its exact
  source hash, with `scientific:null`, but `structure:null`. Its `sourceError`
  describes supported scientific inputs rather than mmCIF. `Workbench.run`
  for `properties` failed with `JOB_UNAVAILABLE`: `The CIF unit-cell parameters
  are incomplete.` A second request reproduced the same failure. This is not a
  successful compute round trip: `workbench/structure.ts` routes all CIF/mmCIF
  sources through the crystal reader even when atom sites are Cartesian and no
  unit cell is present.

[Compact runtime oracle](state-only-geometry-export-oracle.json) records both
failures and the geometry comparison. Next implementation must distinguish
molecular Cartesian mmCIF from periodic fractional CIF, preserve crystal
expansion, define multi-model/alternate-location handling and test both reader
and typed job routes before repeating this browser scenario. PDB export needs
its own geometry writer/fallback investigation. No runtime code changed; both
issues remain open. Other themes, compact/keyboard, prebuilt and native were not
validated in this pass.


## Molecular Cartesian CIF computation after scene export (2026-11-04)

Fixed the computation failure above in `workbench/structure.ts`: Cartesian
CIF/mmCIF without fractional sites now uses a dedicated bounded molecular reader
in the existing reader worker. Fractional CIF and VASP retain crystal expansion.
Cartesian cell metadata does not cause periodic expansion on the molecular path.
The reader retains atom order and coordinates and perceives the chemical graph;
it does not claim to import declared bond topology or quantum data. Both dotted
and flat atom-site tags use the crystal reader's shared case-insensitive field
lookup, including its conflicting-alias rejection.

The molecular path admits one coordinate block and one model, with explicit
element symbols, finite coordinates, and fully occupied sites. Explicit nonzero
formal charges require a charge-preserving graph (which this coordinate-only
path does not yet provide). Alternate
conformations and multiple models require selection before computation; they
are rejected instead of combined. Limits: 20 MB UTF-8 input, 100,000 coordinate
sites, numeric magnitude at most 1e6; downstream chemistry retains its 256-atom
limit. Model/alternate selection UX and trajectory support remain separate gaps.

A fresh `vite-dev` session opened the original state-only scene. Typed
`export_scene_structure` mmCIF completed and matched the previous 1,131 exported
bytes exactly. New tab → Open file reopened that fresh export; shipped Python
`Workbench.observe()` reported 3 atoms, 2 perceived bonds, no source error,
`scientific:null`. `Workbench.run('properties')` succeeded with H2O, 3 atoms and
2 bonds. The ordinary Info → Calculate properties dialog independently showed
H2O, 18.015 g/mol, 18.0106 Da, 3 atoms and 2 bonds. These counts/formula agree
with the source O/H/H rows. Screenshot: `/tmp/burette-cif-properties.png`;
[compact live record](molecular-cif-reopen-live.json).

Validation: compiled-reader tests cover the exact exported bytes, dotted/flat
fields, malformed/ambiguous inputs, size rejection and retained fractional CIF
cell/coordinates (5 tests, 34 assertions). Source-reader and crystal regressions
passed (16 tests, 93 assertions); typed Properties checks passed (4 tests, 31
assertions), as did compiled CLI/MCP compatibility checks (7 tests, 990
assertions). The latter are not an actual MCP execution of this CIF fixture.
Typecheck and agent-shell build passed. The
fresh live runtime was `vite-dev`, not a prebuilt/native execution. PDB export,
other themes, compact/keyboard and broader molecular CIF selection/topology
coverage remain open. No interface layout changed.


## Reject lossy PDB export of multiple scene structures (2026-11-04)

A fresh `vite-dev` session at `c474fe2f2` opened `samples/mini.pdb` (9 atoms).
Typed `append_scene_files` added a second copy with every x coordinate translated
by +20 Å, keeping the original PDB serials 1–9. Both inputs have their own scene
structure. Before the fix, `export_scene_structure` with `format:pdb` returned
`completed` but emitted only the original 9 atoms. Its single-source line filter
unions serial numbers across structures and cannot represent both namespaces.
This is silent data loss, separate from the state-only-scene PDB error above.

The whole-scene PDB fallback now rejects more than one exportable structure
before collecting serials, with `Export mmCIF to keep all structures.` This is
an interim correctness guard, not implementation of multi-structure PDB export.
Single-source subset filtering and preservation of original PDB records remain
unchanged. Source-less PDB conversion, transformed single-source coordinates,
extracted selection paths and a full current-scene PDB writer remain open.

After reloading the viewer, the same real scenario showed:

* Single PDB export completed; its nine element/coordinate tuples exactly matched
  the fixture.
* Append completed, then PDB export terminated `failed` with `ACTION_ERROR` and
  the explicit limitation; no success payload with truncated geometry was returned.
* mmCIF export completed with 18 atoms. Independent Python parsed the atom-site
  fields by tag name and compared every element and coordinate with both PDB
  inputs: exact equality, including the +20 Å translation.
* New tab → Open file reopened the mmCIF export. Shipped Python `Workbench.observe`
  reported 18 atoms. Its perceived graph was incomplete (16 bonds), so this
  check proves geometry preservation, not complete topology or successful chemistry.

[Runtime oracle](pdb-multisource-loss-oracle.json) records before/after results.
`test-structure-operations-contract.mjs` passed, including a behavioral execution
of the actual fallback function showing that multi-structure rejection precedes
serial collection. Agent-shell build passed; packaged `preview-web/viewer.js`
matched the source byte for byte. Runtime acceptance was `vite-dev`; prebuilt,
native, both themes, compact and keyboard coverage were not claimed. No layout
changed. Full PDB export parity remains incomplete.


## Selected PDB model export and reopen (2026-11-04)

A fresh `vite-dev` at `568ad581f` checked whether the source-line PDB fallback
confuses repeated atom serials across trajectory models. It does not in this
scenario: `molstarContextSourceEntryForActiveConfig` already obtains the current
model through `activePdbModelText` before filtering atom serials. No code change
was needed.

The reproducible input wraps the nine ATOM records from `samples/mini.pdb` in
MODEL 1 and a copy translated by +20 Å on x in MODEL 2, preserving serials 1–9
and closing each model with ENDMDL. The initial devFiles open of the temporary
path displayed a failure toast; the file was then successfully opened through
the ordinary file chooser. This evidence covers that picker path; the initial
open failure was not diagnosed.

* Typed `set_structure_pose` with zero-based `index:1` completed. PDB export
  completed with exactly the nine MODEL 2 atoms, not both models or stale MODEL 1.
* Returning to `index:0` and exporting again yielded exactly the nine MODEL 1
  atoms and coordinates.
* The first export (MODEL 2) was written without modification and reopened through
  New tab → Open file. A fresh mmCIF export of the reopened live structure
  contained nine atoms at MODEL 2 coordinates. Independent Python read the PDB
  fixed-width fields and the mmCIF atom-site columns by tag name; all elements
  and coordinates matched within 1e-12 Å.

[Oracle and exact selected-model PDB](pdb-selected-model-roundtrip.json) retain
the fixture hash, construction recipe and action outcomes. Screenshot:
`/tmp/burette-pdb-selected-model-reopened.png`. This proves model selection,
export and geometry reopen for this two-model fixture. It does not prove
arbitrary spatial transform export, atom edits, ANISOU transformation, all-model
export, molecular topology, manual frame-control accessibility, other themes,
compact layout or prebuilt/native behavior. The multiple-structure limitation
and source-less PDB conversion gap above remain open. No runtime code changed.

### Reject SDF bytes mislabeled as PDB (2026-11-04)

Fresh vite-dev on `445a167b3`: open `samples/mini.sdf`, select the Water
card, and use **Open in new tab**. Actual CLI `export_scene_structure` with
`format: pdb` reported `completed`, `chemical/x-pdb`, and `water.modified.pdb`,
but the payload contained SDF text and zero PDB atom records. The common
source-backed subset filter accepted an SDF context source and copied its
nonempty lines as PDB headers. This is a reproduced format-integrity defect.

The filter now requires a PDB context source before reading lines. Reloading
the browser and repeating the scenario returned terminal `failed` /
`ACTION_ERROR`: “PDB export cannot convert this source format yet. Export mmCIF
to keep the scene geometry.” Initial not-ready attempts were excluded; the
recorded result comes from the ready viewer. Existing PDB subset behavior is
covered by executing the real helper in the focused contract suite.

The same scene still exports mmCIF successfully. Independent Python parsing
of `_atom_site` columns against fixed-width SDF coordinates recovered O/H/H
in order, three atoms, and maximum coordinate error 0.0002 Å, within the
writer's three-decimal rounding. Exact before/after payloads and coordinate
evidence: [sdf-pdb-format-oracle.json](sdf-pdb-format-oracle.json). This does
not establish bond/charge/stereo retention or a CIF reopen.

Validation: `vp exec bun tests/test-structure-operations-contract.mjs` and
`vp run build:agent-shell` passed; generated preview viewer matches source.
The live check used vite-dev, not the compiled shell or a native app.
Non-PDB PDB writing remains open; this fix prevents false success and is
not PDB-export parity. Theme, compact, keyboard, transformed geometry and
ordinary UI export acceptance remain open.


### Source editor caret and paused SDF diagnostics (2026-11-04)

The plain CodeMirror source editor now uses the application foreground token for
its drawn caret/drop cursor and a text pointer over content. Renderer load errors
show a brief correction hint and explicitly identify the retained last valid
preview; the controller still retains the full diagnostic and the draft bytes.
No parser policy, request ownership, or preview promotion guard changed.

All installation, compilation and browser execution for this change ran on Gauss,
in `/tmp/burette-parity-caret-20261104`; no local build or test browser was started.
The remote `build:agent-shell` completed. Acceptance used the generated
`prebuilt-static` shell, with remote headless Chromium, not the local IAB tab.

[Measured results](source-editor-caret-oracle.json): opened `samples/mini.sdf`,
selected Water, opened its 3D tab, then Text and Edit source. Both dark and light
themes produced a caret equal to the computed foreground and a `text` pointer.
Keyboard selection and screenshots were checked. The V2000 zero-atom draft
produced the concise diagnostic without replacing the editor text. A V3000 water
fixture then reached terminal Edited; truncating BEGIN ATOM to BEG paused the
preview, preserved the draft, and visibly retained the water scene. Restoring
BEGIN ATOM reached terminal Edited again, with no diagnostic. A 900 x 800 capture
confirmed the recovered editor and scene; this does not close the wider compact
layout matrix or 3D hover acceptance. Local captures are retained under
`.tmp/remote-caret/`; the remote driver is `/tmp/burette-caret-remote.cjs`.

The full desktop typecheck is not green: after preparing the pinned Mol* source,
it reports four typing errors in `crystal-io.ts` (lines 41, 46, 48) and one in
`molecular-cif.ts` (line 11), outside this component. Native acceptance, general
SDF format coverage, and the remaining parity stages remain open.

## CIF reader typecheck recovery (2026-11-04)

The five errors above reproduced on Gauss before this change. Both readers now
type the parser's block collection as Mol* `CifBlock[]`, restoring inferred
category and field types without changing coordinate parsing or admission rules.
No casts to `any`, compiler relaxations, or runtime format conversions were added.

Validation used a fresh `git archive` of `9002eb594b57e0503bfbd8ebe068fac91b4c28ca`
plus the two changed readers, with the already installed root and desktop
dependencies on Gauss. `vp exec tsc --noEmit -p apps/desktop/tsconfig.json` exited
0. `vp run test:coordinate-interchange-reader` passed 5 tests, including compiled
worker Cartesian CIF recovery and invalid-input refusals; `vp run test:crystal-io`
passed 22 tests, including periodic reference fixtures and coordinate roundtrips.
These checks ran remotely; no local build, test server, or browser was started.

The tested reader SHA-256 values matched the local files:

- `crystal-io.ts`: `e8dff40ad9aeb3a583b9bb1d82f77f86849a23d7780fefc3d20088c2bee198b9`
- `molecular-cif.ts`: `cec9badaf39ed192fb1a585aca1af919872f86de40dee04d08a621de8808a1ba`

This closes the recorded desktop typecheck failure only. It adds no browser,
native, UI-matrix, or full-parity acceptance evidence.

## Aligned two-structure mmCIF export (2026-11-04)

The prebuilt browser shell generated at `9002eb594` was exercised on Gauss with
remote Chromium. Open `samples/mini.pdb` and a second copy with each atom's x
coordinate increased by 20 Å using `open_docking_view`, `sceneMode:structureAll`.
Wait for `workspace_scene_state` to report two structures before exporting;
completion of `open_docking_view` alone does not establish renderer readiness.
Export mmCIF, run `align_scene_files`, then export mmCIF again. All three actions
completed. The onboarding dialog was dismissed for the final browser capture.

An independent Python token reader extracted element symbols and Cartesian
coordinates from the exported atom-site loops. Both exports contain 18 atoms
in the same element order. Before alignment all nine corresponding atom pairs
are 20 Å apart; afterward every pair has identical exported coordinates. The
reference structure's maximum displacement is 0 Å. Thus this translation-only
fixture proves mmCIF writes the aligned geometry rather than the original second
file's coordinates. See [numeric oracle](aligned-mmcif-export-oracle.json).

Ordinary `append_scene_files` into a single-file scene is a different route:
its alignment command returned `ACTION_ERROR` (no alignment controller), and
the unchanged 18-atom export retained the 20 Å separation. This does not prove
a failure of the combined-scene UI, which explicitly opens `structureAll`.

This check does not cover rotation, ANISOU transformation, transformed PDB
export, manual download, saved MOLX reopening, or the theme/accessibility matrix.
The remote drivers are `/tmp/burette-transform-combined.cjs` and
`/tmp/burette-transform-oracle.py`; the successful screenshot and exported CIF
are `/tmp/burette-transform-aligned.png` and `/tmp/burette-transform-export.cif`.
No application code changed and the broader parity stages remain partial.

## Preserve independent CIF namespaces after rotation and reopen (2026-11-04)

The next live scenario exposed a scientific identity defect beyond the earlier
coordinate-only checks. Two independent PDB structures each contained four
noncoplanar Cα sites in ALA residues 1–4, chain A, model 1. Reference coordinates
were `(0,0,0)`, `(3.8,0,0)`, `(5,3.6,0)`, `(3,5,2.8)` Å. The moving structure
used `x'=-y+20`, `y'=x-12`, `z'=z+7`: a 90° Z rotation plus translation.
This synthetic fixture tests geometry and identity, not a complete peptide graph.

After opening `structureAll`, waiting for two ready structures and aligning,
the original mmCIF export had correct coordinates but placed both independent
namespaces into one block. Eight rows had only four unique atom identities
(model, chain, residue, component, atom name, alternate ID and insertion code).
Reopening and reexporting retained the duplicates and merged them into one chain.
See [before-fix oracle](rotated-mmcif-before-fix.json). Atom count and coordinate
agreement alone therefore do not establish multi-source scientific roundtrip.

`molstarModifiedMmCifExportPayload` now exports each scene structure into its own
uniquely named CIF block. Each call receives one structure and copies that
structure's categories, avoiding the exporter context's first-model metadata
assumption. The existing shared loader already opens one trajectory per CIF
coordinate block in the same coordinate frame. Single-structure naming and the
typed payload shape/count remain unchanged; multi-structure output now contains
multiple `data_` blocks, which external consumers must support.

All build and runtime acceptance ran on Gauss. The focused structure-operations
contract passed, including independent structure/category calls, unique block
names for matching source names, unchanged single-source output, and failure
when any individual block is empty. `vp run build:agent-shell` completed. A fresh
`prebuilt-static` session then repeated alignment, typed mmCIF export, opening the
written CIF as a new tab, and typed reexport. Both post-fix outputs contain two
blocks, eight atoms, eight distinct block-scoped atom identities and no duplicate
identities. An independent Python token reader compared the element/coordinate
multisets against the known reference twice: maximum coordinate error was 0 Å
at the exported precision. The reopened viewer reported two structures and was
visually nonblank. See [after-fix oracle](rotated-mmcif-after-fix.json).

Drivers remain on Gauss at `/tmp/burette-rotation-check.cjs` and
`/tmp/burette-rotation-audit.py`; output is `samples/rotation-export.cif` in the
isolated validation tree. This does not prove ANISOU rotation, heterogeneous
metadata, full bond/stereo preservation, PDB conversion, saved MOLX reopening,
external-consumer compatibility, or the theme/accessibility matrix. These remain
open acceptance work rather than implied by the eight-site fixture.

### Heterogeneous metadata across independent CIF blocks (2026-11-04)

Follow-up to `63ba84b64`, verified on Gauss using the same rebuilt prebuilt browser
shell. Two synthetic four-CA PDB sources reuse chain A, entity 1, model 1, atom
serials and residue numbers, but have different residue sequences (`AGSV` versus
`KDYT`), component identities, coordinates and isotropic B factors (20 versus
35 Å²). These are CA-only identity/metadata fixtures, not complete peptide graphs.

The Chromium scenario used `open_docking_view` with `sceneMode: structureAll`,
waited for two structures, exported mmCIF, read `copy_scene_sequence`, opened the
export through `manage_tabs/open_file`, waited for two structures again, read the
sequence and re-exported mmCIF. Every action completed. Unlike the rotation check,
this scenario does not align the different sequences. Both exports contain two
blocks with four atoms each, the correct per-source residues and `chem_comp`
identities, and the original per-source B factors. A separate Python `shlex`
fixture-specific loop reader checked these fields against independent constants:
maximum coordinate error is 0 Å at exported precision. Both sequence actions
return `AGSV` and `KDYT` in source order. The displayed structure labels become
export block names after reopen; original filenames are not preserved here.

Committed summary: [`multiblock-metadata-oracle.json`](multiblock-metadata-oracle.json).
Raw action results and scripts remain at `/tmp/burette-metadata-*` on Gauss.
A screenshot of the reopened file was captured; identity and metadata conclusions
come from action output and exported bytes, not the image.

`vp run test:mmcif-scene-roundtrip` passes on Gauss and is included in `test:ui`.
It executes the production export boundary with real Mol* PDB/mmCIF parsing and
writing, then verifies two export/reopen cycles for coordinates, residues,
`chem_comp`, B factors and derived polymer sequences. The same regression run
against `0e2110e8f`'s viewer fails with `1 !== 2` at the independent-block assertion
(exit 1), confirming it detects the prior behavior. No runtime code changed in
this follow-up. This is not an independent general-purpose CIF-consumer audit,
a guarantee about arbitrary categories, or an ANISOU/tensor transform test.
Manual download/open, full bond/stereo roundtrip, transformed PDB and aligned
MOLX repeated save/reopen remain open. Stage 4 remains partial.

### Repair repeated aligned MOLX saves in the prebuilt browser shell (2026-11-04)

A real context-menu `Save scene…` download followed by reopening the archive
exposed a second-save failure. The first MOLX correctly contained two embedded
PDB sources and their alignment transform, and `workspace_scene_state` reported
`{structureCount: 2, ready: true}` after reopen. mmCIF export also worked. But the
second Save produced no download and the immediate toast was
`ScienceSessionError: Could not read the scene source. Try opening it again.`
This reproduced twice before fixing it; a later diagnostic captured the toast
before its dismissal rather than treating the 45-second download timeout alone
as proof of a save error.

The prebuilt shell's `STRUCTURE_EXTENSIONS` omitted `molx`. Consequently its
`/__burette/read-file` endpoint rejected archive-byte reads even though the viewer
could display the MOLX through another route. `useScienceSessionRestore` retained
the rejected restore promise; `captureWorkspaceSceneSnapshot` correctly waited
for it before writing another archive. Added `molx` to the server's existing
format allowlist and regenerated the packaged script using `build:agent-shell`.
No restore guard, root restriction, symlink check or size bound was bypassed.

Validation on Gauss:

- A real server regression in `tests/test-agent-shell-security.mjs` failed with
  HTTP `400 !== 200` against the previous server. With the fix it passes exact
  archive-byte equality and rejection of direct and symlinked out-of-root MOLX
  paths, alongside the existing token, cookie, Host/Origin and parent-swap checks.
- `vp run build:agent-shell` and `test-packaged-plugin-mirror.mjs` passed (42
  runtime files, 18 scripts). Source and packaged server scripts match.
- Fresh Chromium/prebuilt-static session, 1400×900: the existing four-CA rotation
  fixture uses moving coordinates `(-y+20, x-12, z+7)`. Typed combined open and
  alignment were followed by the actual tab context menu `Save scene…`, browser
  download, typed `manage_tabs/open_file`, a second menu save/download and a
  second reopen. Both source PDB paths were temporarily absent during both
  reopens; the test restored them in `finally`. Both save/open cycles completed.
- Independent Python inspection of exported CIF loops found two blocks and eight
  atoms after alignment and after each reopen, with 0 Å maximum coordinate error
  at exported precision. Inspection of each downloaded ZIP found `state.json`,
  exact original embedded PDB text and labels, and the expected inverse rotation
  and translation matrix (maximum element error `3.55e-15`). Both final scene
  state actions report two ready structures. The archived original-source hashes
  match between rounds; archive hashes differ, as expected for session snapshots.

Summary: [`aligned-molx-roundtrip-oracle.json`](aligned-molx-roundtrip-oracle.json).
Reproduction scripts, logs, action output, PNG and the two downloaded archives
remain under `/tmp/burette-molx-*` and
`/tmp/burette-cif-types-20261104/samples/molx-round{1,2}.molx` on Gauss. The owned
browser was closed and server process/listener stopped. This proves a combined,
state-only PDB scene, not scientific attachments, full bond/stereo retention,
all formats, native saving, or a full UI/theme/keyboard acceptance matrix.

A parallel static audit identifies a separate open ANISOU issue: pinned Mol*'s
`formats/structure/property/anisotropic.ts` exports the original
`atom_site_anisotrop` table, while `model/structure/export/categories/atom_site.ts`
exports coordinates through current unit conformations. Rotated displacement
tensors therefore need their own live fixture and correction; this save fix
makes no ANISOU claim. Stage 4 remains partial.

## Current-frame anisotropic mmCIF export (2026-11-04)

The ANISOU concern above was reproduced in a fresh Chromium prebuilt-static
session on Gauss. Two independent four-CA PDB sources used reference coordinates
`(0,0,0), (3.8,0,0), (5,3.6,0), (3,5,2.8)` Å and moving coordinates
`(-y+20, x-12, z+7)`. Each reference atom had
`U = (.10,.20,.30,.01,.02,.03)` Å² in order U11,U22,U33,U12,U13,U23;
the moving source had the corresponding rotated tensor
`(.20,.10,.30,-.01,-.03,.02)`. Serial, chain and residue IDs overlap between
sources. Typed combined open, `align_scene_files`, `export_scene_structure`
(mmCIF), open and reexport completed, but moving tensors retained source values:
maximum tensor-component error 0.1 Å², despite zero coordinate error.
See [`anisotropic-mmcif-before-fix.json`](anisotropic-mmcif-before-fix.json).

The source-build patch `scripts/molstar-anisotrop-export.mjs` registers a standard
anisotropic category and suppresses the old source-table custom exporter. Its
focused category module iterates current elements in atom-site export order,
counts atoms without tensors for foreign keys, maps model elements to source
rows, and applies `U' = R U Rᵀ` using each unit's current operator. Chain suffixes
and atom IDs follow the coordinate category, including subsets and unit copies.
Translation leaves U unchanged. Generated Mol* and the packaged plugin mirror
were rebuilt through their repository scripts; their lock and mirror checks pass.

Validation:

- `vp run test:mmcif-anisotropic-export` passes real PDB/mmCIF parsing, identity,
  translation, 90° and 0.37-radian rotations, missing tensor rows, nonconsecutive
  IDs, selected subsets, duplicated unit operators, retained IDs and reopen.
  Numerical expectations are independent constants; the general-angle tolerance
  reflects the writer's six decimal places. The test is registered once in
  `test:ui`; the entire UI sweep was not run.
- `vp run test:mmcif-scene-roundtrip` still passes. An independent source review
  found no required corrections; that review did not itself execute tests.
- Fresh Chromium acceptance on the rebuilt prebuilt-static shell repeated the
  combined open/alignment/export, then **two** export/open/reexport cycles.
  Independent Python parsing checked two CIF blocks, eight atoms, eight tensors,
  valid atom foreign keys, and every coordinate/tensor component. All errors
  were zero at exported precision after alignment and after both reopens.
  See [`anisotropic-mmcif-after-fix.json`](anisotropic-mmcif-after-fix.json).

`U_esd` describes marginal standard uncertainties, not a covariance tensor.
Identity, translation and signed axis permutations preserve these uncertainties;
general rotations with U_esd explicitly reject export because the component
covariances are unavailable. This limitation is covered by the focused test,
not by a browser error-dialog scenario. Complete-tensor fixtures do not prove
arbitrary partial/malformed tensors, every crystallographic category, transformed
PDB export, ellipsoid UI rendering, native surfaces, or all format/producer pairs.
The final typed scene state reports two ready structures. All three owned shell
processes from this check exited; the final listener was verified closed.
The stage remains partial. Browser actions, fixtures, independent audit script
and logs remain under `/tmp/burette-anisou-*` and the validation tree on Gauss.


## Partial anisotropic mmCIF components (2026-11-04)

The preceding current-frame exporter used a tensor-wide CIF value kind. A live
prebuilt-browser fixture with two four-CA mmCIF structures and independently
missing (`.`) / unknown (`?`) U and U_esd components exposed **17 incorrect
components out of 96** during ordinary export, retained after two reopens. This
was data corruption even without alignment: missing values became zeros or
known components acquired another component's missing marker.

The exporter now reads individual mmCIF source fields and emits scalar writer
fields with independent value kinds. The six-component linear form of R U R^T
computes known outputs and propagates missing dependencies only to affected
outputs; `?` takes precedence over `.`. Numeric U contributions are not truncated.
Signed permutations preserve each U_esd marker and permute numeric standard
uncertainties without signs. General mixing still refuses numerical U_esd when
component covariances are unavailable, including a partially populated row.

Validation:

- Real Mol* parser/export tests cover both markers, translation, signed 90-degree
  rotation, partial-U general rotation with independently known components,
  reopen, and refusal to mix partial numeric uncertainties.
- A fresh prebuilt Chromium session opened both sources, exported twice without
  alignment, reopened/reexported twice, and reached two ready structures. An
  independent Python CIF parser compared all 96 components at each stage:
  **zero mismatches**, eight atoms/eight tensor rows/two blocks, valid atom IDs,
  and zero coordinate error. [Before](partial-anisotropic-mmcif-before-fix.json)
  and [after](partial-anisotropic-mmcif-after-fix.json) record the oracle.
- Production vendor and agent-shell builds, vendor-lock and packaged-mirror
  checks passed. Independent source review found no required corrections. All
  fixture shell processes exited and the final port closed.

Separate finding: align_scene_files on integer-coordinate mmCIF inputs produced
an off-axis rotation error of 1.08437e-7. Export with numeric U_esd then explicitly
refused the non-permutation. The [captured MOLX matrix](partial-anisotropic-alignment-limit.json)
records the baseline alignment-precision failure. The following Float64 repair
now verifies aligned partial-U_esd export. CoreCIF aliases are handled by provider scalar columns but
were not exercised in this browser fixture. Native/external readers, arbitrary
malformed tensor input, ellipsoid rendering and the complete UI matrix remain
unverified.


## Double-precision mmCIF alignment (2026-11-04)

The partial-tensor fixture revealed an independent precision defect in the
mmCIF alignment path: Mol* MinimizeRmsd creates an EVD cache whose 4x4 matrix
uses Matrix.create's default Float32 storage. Both covariance accumulation and
eigenvectors were rounded there despite Float64 input positions. The captured
90-degree alignment had off-axis terms up to 1.08437e-7, so the anisotropic
exporter's signed-permutation check correctly rejected numeric uncertainties.

`scripts/molstar-rmsd-precision.mjs` changes only that RMSD state's EVD matrix
to Float64 through the production build plugin. It does not change global
Matrix/EVD defaults or weaken the uncertainty guard. A unique source anchor
requires review if the pinned implementation changes.

The real MinimizeRmsd regression failed without the plugin with
`inverse matrix 0: 3.422853700474349e-8 != 0`. The production-plugin preload
passed exact 90-degree and general 0.37-radian rotations, translation, coordinate
recovery, orthogonality and state reuse at 1e-12 tolerance. The test is included
in `test:ui`; the full test:ui sweep was not rerun.

A fresh prebuilt-browser scenario opened two integer-coordinate four-CA mmCIF
structures, aligned them, saved an actual MOLX download to inspect the applied
matrix, exported mmCIF, and reopened/reexported twice. The independent Python
oracle found two blocks, eight atoms and eight tensors, zero coordinate error
at export precision, and **all 96 U/U_esd values and markers preserved** at every
stage. The downloaded matrix's largest error against the exact inverse was
**2.1316282072803006e-14**. A separate live 0.37-radian alignment still explicitly
rejected numerical U_esd without covariances; reopening the successful export
returned two ready structures. [Oracle](rmsd-anisotropic-mmcif-after-fix.json)
and [baseline matrix](partial-anisotropic-alignment-limit.json) preserve both
sides of the result.

Production vendor and browser-shell builds, packaged-mirror and vendor-lock
checks passed. Independent source review found no required corrections. The
owned shell exited and its port closed. This establishes the partial-tensor
signed-permutation browser scenario, not full alignment/scientific-format
parity: general-rotation uncertainty propagation still requires covariances;
large/rank-deficient/external-reader/native and complete UI matrices remain
unverified.

### Repeated scientific MOLX saves in fresh browser contexts (2026-11-04)

At `406aedb6b`, the prebuilt-static browser shell imported the real minimized
Gaussian 16 Water Raman fixture from `tests/fixtures/quantum/gaussian16-water-raman.fchk`.
The remote snapshot matched all 1,528 checked runtime source files in the local
checkout. This is acceptance of existing behavior; no product code changed.

Three actual tab-menu **Save scene…** downloads, with two intervening reopens,
retained the scientific attachments. Each reopen used a new shell session and
a fresh Chromium process/context. The copied original FCHK was temporarily
absent during both reopens and saves; the first MOLX was also absent during the
second reopen/save. Both hidden files were restored afterward. This extends the
earlier state-only aligned-PDB roundtrip to a scene carrying scientific data.

The [independent Python oracle](repeated-scientific-molx-oracle.json) checks all
three archives against the FCHK bytes and each other:

- Exact 4,546-byte Original, 249-byte XYZ, scientific JSON and 81-value Float64
  Hessian attachments, including their manifest digests.
- Stable document UUID, three atom IDs, reference frame 0 and one-frame binding.
- Source coordinates, atomic masses, three frequencies, 21 named Vib-E2 scalar
  values, 27 displacement components and the symmetric Hessian. Uninterpreted
  Vib-E2 fields are retained in Original; this does not claim semantic support
  for all 14 source blocks.
- The reopened **Compute → Show vibrations → Export → Spectrum as CSV** download
  retains the FCHK provenance and matches the source scalar values.

The restored Vibrations panel was inspected at 900 × 800 in dark mode and
1,400 × 900 in light mode. Animate became available after binding completed;
two canvas samples during animation differed by 3,187 pixels, and stopping
returned the canvas exactly to its baseline (zero differing pixels). This is
visual movement/rollback evidence, not an independent numerical audit of animated
displacements. Screenshots and raw actions remain on Gauss under
`/tmp/burette-repeat-science-*`; session JSON files are private. All three owned
shell ports closed after the check.

Stage 4 remains partial. This single-frame FCHK scenario does not close
multi-frame reference selection, edit/save/reopen, fault/retry, MCD producer pairs,
large/malformed inputs, all scientific readers, keyboard-only/accessibility,
Codex UI Atlas comparison, native or hosted acceptance.


### Scientific trajectory frame persistence and missing controls (2026-11-04)

A real Gaussian16 optimization, `tests/fixtures/quantum/gaussian/cclib-dvb_gopt.out`,
opened as a six-frame, 20-atom scientific trajectory in the prebuilt browser shell.
Source HEAD was `6d1987fc1`; fresh SHA-256 comparisons of 1,528 tracked runtime
source files against the Gauss snapshot found no differences. The existing
prebuilt distribution was reused, not claimed as a newly built immutable release.

Actual UI sequence: Next frame twice → frame 3/6 → tab menu Save scene; open that
MOLX in a fresh browser context with the original output temporarily absent;
observe 3/6, Next frame twice → 5/6 → Save scene; open the second MOLX in another
fresh context with both the output and first archive absent; observe 5/6 → Save
scene again. Three saves and two intervening reopens passed. The third archive
was inspected, not reopened. Original files were restored and the three dedicated
servers were stopped, with their ports verified closed.

The [independent oracle](multiframe-scientific-molx-oracle.json) parses Gaussian
Standard orientation, SCF, Mulliken and dipole tables without importing the
application parser, and cross-checks the stored cclib reference. All three saved
XYZ/science/Original attachments are byte-identical. UUID, atom IDs and trajectory
identity survive. Every one of the 360 coordinates in each XYZ and structured
science payload matches the producer; so do five SCF energies, 40 Mulliken charges
and six dipole components. The sixth geometry is a final reprint without a new
SCF energy; no energy is invented. Missing per-frame properties remain absent.

Saved scene binding indices are 2, 4 and 4, while scientific referenceFrameIndex
remains 0. These represent different things: the visible frame and the scientific
reference geometry. Four active-geometry mmCIF exports agree with the selected
frames within 0.000478 Å, bounded by the writer's three-decimal coordinates;
this is not a full-precision live-coordinate comparison. Steps layout still omits
document-level eigenvalue-only orbitals from structured science; Original retains
the complete producer output.

**Open control regression:** the initial trajectory exposes visible Align and
All buttons; both are absent after MOLX reopen (DOM counts 1 → 0 and screenshots).
Frame stepping remains available: focused Next + Enter advances 5/6 → 6/6,
and focused Previous + Space returns to 5/6. The session preparation branch in
`PreviewExtension/Web/viewer.js` restores native frame controls but does not restore
XYZ overlay capability; alignment also depends on raw XYZ input. This is a
reproduced limitation, not a fix. Preserve saved scene identity and validation
when restoring these capabilities; do not replace a session with a new XYZ scene.

Screenshots at 1400×900 light and 900×800 dark show the restored molecule and
frame stepper without visible clipping. Scratch artifacts use
`/tmp/burette-multiframe-*`; script hashes and cleanup evidence are in the oracle.
The control probe's first attempt failed on an ambiguous All text locator; the
retry used the actual accessible name and passed. This does not establish full
keyboard/assistive-technology, Atlas, native or hosted acceptance. Nonzero
scientific referenceFrameIndex, edit/save/reopen and fault/retry matrices remain
open. All stages remain partial.

### Restore scientific trajectory after disabling alignment (2026-11-04)

The Gaussian six-frame, 20-atom optimization exposed a prerequisite to restoring
MOLX controls: on the original XYZ trajectory, Align followed by disabling Align
left a one-frame overlay. The pager could reset from 2/6 to 1/6, or still show
2/6 while the real graph contained only one frame. Save scene then correctly
rejected the scientific binding with `The scene does not show the current source
yet. Wait for it to update, then save again.` No archive was downloaded.

The viewer now ignores native pager notifications whose frame count differs
from the source pager, restores the full native trajectory when disabling Align
in single-frame viewing mode, and retires the old overlay cache before installing
that trajectory's controls. Without the cache change, restoring the selected
frame immediately rebuilt another single-frame overlay. Scientific binding
validation remains unchanged.

Browser acceptance used the real `cclib-dvb_gopt.out` fixture. Frame 2/6 survived
two Align/disable cycles: light at 1400×900 and dark at 900×800. Save scene succeeded;
a fresh browser/server reopened the archive with the original file temporarily
absent, retained 2/6, and saved a second archive. Reviewed screenshots show the
molecule and frame controls without visible clipping in these viewports.

[Independent oracle](unalign-scientific-molx-oracle.json) parses Gaussian directly
and cross-checks the stored cclib reference, without application parser imports.
Both archives retain all six frames, 360 exact XYZ and 360 exact scientific
coordinate values, five energies, 40 charges, six dipole components, and the
original producer bytes. All scientific attachment bytes, UUID, atom identities
and trajectory binding are stable across reopen. The restored live coordinates
match source frame 2 within 1.071e-7 Å; exported and reopened mmCIF geometry matches
within 0.000498 Å, consistent with its three-decimal writer.

The served changed viewer SHA-256 was verified, as were 1,528 runtime source files.
The web shell build, scene-recovery test and indexed-trajectory test passed.
The broader UI-shell text contract **does not pass**: line 6536 still expects the
old single-call `toMmCif(label, structures, ...)` spelling. The same failure was
reproduced with the unchanged HEAD viewer; it is not evidence against this change
and remains an outstanding contract-maintenance item. Five owned servers were
terminated, their ports checked closed, and the original fixture restored.

This closes the tested original-trajectory Align/disable/save failure, not the
missing Align/All controls after MOLX reopen. All-mode alignment, error/cancel
recovery, native, manual IAB, full Atlas and accessibility acceptance remain open.
