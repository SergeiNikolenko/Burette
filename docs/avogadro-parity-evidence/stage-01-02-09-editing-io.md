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
- Remaining browser scenarios include reopening a downloaded edited copy through
  the real picker and browser reload of an IndexedDB import. Packaged and
  native acceptance are separate.

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
