# Stages 1, 2 and 9 evidence: coordinates, editing and I/O

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
