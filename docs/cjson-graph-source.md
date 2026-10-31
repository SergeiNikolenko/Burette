# Chemical JSON graph source prerequisite

`readCjsonGraph(name, text)` reads an explicit CJSON graph separately from the
XYZ-only scientific document route. Its typed result contains a source-ordered
MOL graph, all accepted Cartesian coordinate sets, the active set index and
file-scoped source spectra. It never infers bonds from coordinates.

The format reference is the pinned [Avogadro CJSON reader](https://github.com/OpenChemistry/avogadrolibs/blob/d250eb3c62a61470b1e0cdf205dcfe26b06f991f/avogadro/io/cjsonformat.cpp).
`chemicalJson` / `chemical json` versions 0 and 1 are accepted. Explicit
connections use zero-based source atom indices; an omitted bond-order array
means single bonds. Missing bonds stay absent. Coordinates are physical Å.
`3dSetsActive` selects the corresponding set; absent selection defaults to the
first set, even when a separate `3d` block contains another geometry.

The bounded prerequisite accepts 1–256 real atoms, at most 2,000 coordinate
sets and a 16 MiB JSON input. Charge and isotope arrays must match source atom
count. Formal charges retain the native signed-byte range; isotope masses are
zero (unspecified) or a mass number from the atomic number through 300.
Coordinates are finite and within ±1,000,000 Å. Invalid references, duplicate
bonds and partial metadata arrays fail before materialization.

MOL V3000 is emitted directly in source order with its explicit bond orders,
physical 3D coordinates, CHG and MASS values. This avoids OCL atom reordering and
its indexed stereo collections. The existing OCL graph reader then consumes the
result; independent RDKit and MolStar checks cover the materialized graph. The
native CJSON reference has no separate stereo field: absolute 3D configuration
comes from the graph and coordinates. The real L/D-alanine fixtures retain S/R
configuration through MOL export/reopen, including their leading explicit H.

CJSON orders 4–6 are not MDL aromatic/query orders and are explicitly refused.
Periodic cells and fractional coordinates are also refused until a cell-bearing
graph representation is wired. No such file is silently flattened into XYZ.
The three-dimensional graph extracts in `tests/fixtures/cjson` come from pinned,
BSD-licensed producer files; hashes, extraction scope and license are adjacent.
The existing reduced NMR fixture is a numerical/structural extract, not a claim
that all quantities of the original producer file are interpreted.

Ordinary browser Open/drop and the scientific file picker recognize `.cjson`,
including supported compression suffixes. Generic `.json` keeps its existing
QCSchema recognition. The reader worker materializes a MOL graph and the open
path adds a unique import token in its comment line. Two imports of the same
geometry therefore retain separate scientific ownership. The immutable Original
keeps every uploaded byte, including compression, BOM and line endings.

The MOL source has one native frame. The Spectra consumer follows the explicit
`graph.activeFrameIndex` into the retained CJSON sets; it does not infer the last
frame from a single-model viewer. File-scoped NMR/electronic data remains
file-scoped. Export → Scene and restore preserve the exact graph, selected set,
all retained sets, spectra and Original through the version 4 MOLX contract.
JSON scalar coordinates use ordinary JSON number semantics (signed zero becomes
zero); the Original preserves its literal source spelling.

Energy, vibrational, orbital, periodic and display metadata outside this result
remain in the input source and require their own consumers. Coordinate-set
switching is not activated. Native content-type registration and Finder Quick
Look routing are separate; no registration metadata changes in this stage.

`test:cjson-graph` uses real OCL, RDKit and native MolStar data/model parsers.
`check:cjson-graph` checks the module and tests with the app's actual Vite types.
These do not prove browser, packaged desktop, Quick Look or iPhone acceptance.

`test:cjson-import` exercises the real reader/compression workers, normal browser
materialization, NMR panel, native MolStar save/open and host restore/re-export.
The same producer files also run without reducing their input in the recorded
external evidence; that replay is not a browser or packaged-app acceptance claim.
