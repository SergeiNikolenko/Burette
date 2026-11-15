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

Unmarked ZMAT bodies may also use the Gaussian conventions that Gaussian and
Open Babel write: a `Variables:` label, `name value` assignments after the rows
and dihedrals within ±360°. A dihedral outside ±180°, literal or bound to a
variable used only as dihedrals, is stored as its exactly equivalent signed angle;
values within ±180° are kept as written. A `Constants:` section is refused because
reading frozen values as ordinary variables would drop their meaning. Element
labels such as `C1`, label references and comma-separated fields remain
unsupported. A coordinate written as `-0` reads back as `0`.

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

The ordinary scientific-file boundary recognizes reserved-marker XYZ, including
invalid reserved versions that strict admission must reject before opening a
viewer. Unmarked XYZ keeps its ordinary route, including extended and multiple
frames. A verified marked XYZ passes its already-read source to materialization;
only its comment gains the new import token. Plain XYZ decoding preserves BOM
and rejects malformed UTF-8. Compressed inputs retain the existing decoder's
text policy and their exact outer Original bytes.

Run `vp run test:scientific-open-entrypoints` and
`vp run check:coordinate-xyz-admission`. Source edits after import still need
the separate explicit-gesture revision admission; the ordinary opener alone
does not close that owner boundary.

A current Geometry gesture can admit a parsed coordinate source that has no
registered scientific revision. The existing imported-source store retains it
as a separate scoped root, so a Text Undo can still reach older owned Geometry
histories and the same Original. Reads do not register sources. Document
identity, logical source operation, current session/revision, native binding
and scientific revision are checked before publication. Failure or cancellation
rolls back an unchanged admission; a later legitimate record is left alone.

All coordinate roots of one document share the existing 100-revision budget.
The current Undo pair is retained; eviction never changes another document's
shared data. Run `vp run test:coordinate-source-admission` and
`vp run check:coordinate-source-admission`. These are owner/host checks; the
transport uses the existing viewer action boundary and does not add a native API.

The existing Geometry **Copy Z-matrix** action writes the current Cartesian
positions with the measured definition through the shared interchange codec.
The internal-coordinate **Export Z-matrix** action writes the current source
positions with its owned symbolic definition, including signed/shared bindings,
unused variables and reference points. Both retain the human comment and import
token in the single transport marker format. Validation finishes before the
clipboard write or download starts; neither action changes the source or its
original file. Reopening the result through the ordinary scientific reader
preserves absolute pose and the complete definition.

## Independent oracle

`vp run test:zmatrix-reference` runs the real CLI on ten RDKit conformers in
`tests/fixtures/zmatrix-reference/`: chiral centres, a ring, an E alkene, an
allene, a disconnected dimer, near-linear and exactly linear molecules. XYZ →
ZMAT → XYZ must be exact and its ZMAT must open in the compiled browser reader as
the same atoms. Open Babel's own Gaussian and MOPAC internal coordinates for the
same inputs must rebuild every pairwise distance (within Open Babel's printed
precision) and every RDKit stereocentre and E/Z bond; mirrored dihedrals must
invert each centre. Open Babel's Z-matrices that leave a placement undefined,
such as torsions about its exactly linear N≡C–C or rounded C=C=C chains, are
refused rather than rebuilt.

`uv run --with rdkit python tests/support/regenerate-zmatrix-oracles.py` rewrites
these fixtures with Open Babel and RDKit; `--check` additionally measures every
emitted bond, angle and dihedral with RDKit, rebuilds every emitted Z-matrix with
Open Babel and re-perceives CIP/E-Z labels. Open Babel is only an external test
tool and is not distributed with Burette.
