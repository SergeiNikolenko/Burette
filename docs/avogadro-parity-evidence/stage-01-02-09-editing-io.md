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
  successful source write. A live scene measurement through reorder,
  Undo and Redo still needs browser acceptance.

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
