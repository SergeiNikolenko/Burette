# Internal-coordinate interchange

`scripts/coordinate-interchange.mjs` carries the existing absolute atoms and
internal-coordinate definition through one plain XYZ frame or headerless ZMAT.
It is a pure codec, shared by future CLI and scientific-reader consumers; it does
not activate either route or change unmarked trajectory readers.

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
