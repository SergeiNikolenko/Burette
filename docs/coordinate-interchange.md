# Internal-coordinate interchange

`scripts/coordinate-interchange.mjs` carries the existing absolute atoms and
internal-coordinate definition through one plain XYZ frame or headerless ZMAT.
It is a pure codec shared by the coordinate CLI. The scientific reader admits
marked XYZ/ZMAT through the same codec and leaves unmarked trajectory readers unchanged.

`readCoordinateInterchange(text, format)` returns `{ atoms, internalCoordinates,
comment }`. Atoms use `{ element, x, y, z }`; definition rows/variables use the
existing ZmatrixDocument. `writeCoordinateInterchange(pair, format, comment)`
writes ordinary rows and one `BURETTE_INTERNAL_COORDINATES_V1=` marker. The marker
contains unpadded base64url UTF-8 JSON with exactly `atoms` and
`internalCoordinates`, not an entire ScientificDocument or SDF metadata record.

XYZ puts the marker at the end of its ordinary comment line. ZMAT puts the same
payload in a standalone `#` comment; a preceding ordinary comment carries the
human XYZ comment/import token. Readers expose the human comment separately.
Only the exact terminal legacy ` zdef-[0-9a-f]{8}` is replaced on writing; similar
human text is retained. The old discriminator alone cannot recover a definition.

XYZ body atoms must equal marker atoms in numerical values, element and order.
ZMAT body rows/variables must equal the marker's semantic definition, including
signed uses and unused variables. Mismatches, duplicate or misplaced markers,
unsupported versions, malformed encoding and unknown payload fields are errors;
they never fall back to bare geometry. Remove or regenerate the marker when
intentionally editing a marked file's authoritative body.

The existing geometry helpers validate the pair. A proper placement checks
shape consistency within 1e-5 Å; it is never returned as geometry. Exact absolute
Cartesian values remain authoritative, including one/two-atom and nearly
collinear inputs. Dummy X rows remain references and never become physical atoms.

Input and final output must each fit 1 MiB UTF-8. Existing limits remain 512 total
definition rows including dummies, 1536 variables, finite coordinates within
±1e6 Å, valid earlier references and separated atoms. Output size and validity
are checked before any caller mutates a file. This codec accepts one plain frame;
extended per-atom property columns and multi-frame input are separate formats.

Run `vp run test:coordinate-interchange` and
`vp run typecheck:coordinate-interchange`. Tests compare unaligned absolute
coordinates at 1e-12 Å, retain full symbolic definitions, test legacy migration
and malformed/bounded input, and check unchanged real rows after definition-only
changes. This does not establish CLI packaging or ordinary browser Copy/export/
reopen acceptance. Geometry's later marker update must preserve original atom-row
bytes and source identity; this stage deliberately exports no unused UI helper.

Marked `.xyz`, `.zmat` and `.zmatrix` inputs produce one scientific frame with
`referenceFrameIndex: 0`, exact Cartesian atoms and the complete definition.
The frame retains the human comment and its normal trajectory metadata. Any
reserved version marker selects strict interchange admission, including refusal
of malformed markers; it cannot silently fall back to ordinary geometry.
Run `vp run test:coordinate-interchange-reader` and
`vp run typecheck:coordinate-interchange-reader` for the browser-target compiled
reader worker. This reader foundation does not change generated XYZ source
materialization, Geometry edits, clipboard or export writers. Their marker and
original atom-row byte preservation require separate flow acceptance.

`writeCoordinateInterchangeXyzSource(text, pair, appendComment?)` replaces only
the XYZ comment. BOM, count spelling, every atom row, individual line endings
and final-newline presence remain unchanged. The current rows must exactly
match the new absolute atom pair. An old valid envelope may describe the
pre-edit geometry; malformed, duplicate or unknown envelopes cannot be erased
by this managed writer. The optional suffix is the generated import token,
added after terminal legacy marker migration. The whole final source is bounded
before publication.

Scientific materialization uses this writer for definitions, preserving the
human comment and frame energy. Z-matrix revisions retain unchanged atom row
bytes while updating the one full marker. No-op marked revisions are stable;
geometry-changing revisions update the pair without changing source ownership
or native publication guards. Run `vp run test:coordinate-source-writers` and
`vp run typecheck:coordinate-source-writers`.

Editable ordinary marked XYZ admission is a separate owner boundary: parsed
definitions need a document-scoped scientific revision before a Z-matrix
gesture can publish. Copy/export consumers and that admission are separate
from this source-writer foundation; it does not establish their Browser flow.
