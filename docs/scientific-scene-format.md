# Scientific scene format

This source-level MOLX attachment contract does not establish UI or packaged-platform readiness.

## Scope and archive layout

Version 1 accepts single- or multi-frame XYZ with unchanged elements/order, or one
SDF graph (one frame, ≤256 atoms, `science: null`). Version 2 additionally accepts
one bare MOL connection table under its real `source.extension: "mol"`; SDF data
items and record delimiters are forbidden in MOL. XYZ/SDF exports stay version 1
for compatibility; MOL exports require version 2 and fail closed in version 1 readers.
Both versions use the same exact-text/opaque-Original attachment representation.

Mol* stores file assets at `assets/<id>` and indexes them in `assets.json`, beside
`state.json`. Burette reserves every ID beginning `burette-science-`. The manifest
asset is `burette-science-manifest`, named `burette-science.json`; numbered payloads
use `burette-science-attachment-<number>`. Asset tags are not archive identifiers.
No reserved entries means a foreign scene and decoding returns `null`. Reserved
entries without their indexed manifest, or unused reserved assets, are rejected.

## Manifest and payloads

The manifest has `kind: "burette.science-session"` and `version: 1` or `2`. Its fields are:

- `document.uuid`: durable document identity.
- `source`: `extension`, UTF-8 attachment ID and exact-source `sha256`.
- `atoms`: real-atom count and unique ordered IDs, or `ids: null`.
- `binding`: structure/model/trajectory refs, zero-based frame index, frame and atom counts.
- `science` and `original`: attachment references or `null`; Original also records
  the file name and media type.
- `attachments`: unique `id`, `dtype`, `count`, `byteLength` and exact-byte lowercase SHA-256.

Payload types are `utf8`, `json`, `bytes`, `float32le` and `float64le`. Counts are
bytes for the first three and elements for floats; byte lengths must match.
Scientific JSON uses `{"$attachment":"<id>"}` for supported typed arrays.
Floats use explicit IEEE-754 little-endian encoding and retain their width.
Every array reference must resolve once; missing, duplicate or unused arrays fail.
Source decoding preserves a UTF-8 BOM. Original preserves opaque file bytes,
including compression, encoding and line endings; its name is limited to 512 JS
code units and the encoder truncates the media type to 128 code units.
Unsupported manifest versions fail with a named version error, without migration.

## Scientific validation

Hashes prove byte identity, not scientific validity. Encoding and decoding both
validate the scientific document against the source atoms and geometry. Values
must be finite; atom coordinates are bounded by ±1,000,000 Å. Scientific geometry
matches XYZ within 1e-5 Å per axis. Multi-frame histories match every source frame;
a single-frame source must occur in its retained scientific history.
Scientific atoms and frames require canonical symbols; source XYZ labels normalize separately.
Modes have unique indices in `[0, 3N)`, at most `3N` entries, finite frequencies
and optional per-atom displacement triples. Energy/vector fields, orbital/basis
and grid dimensions, and Z-matrix geometry are also validated.
Hessians are float64 row-major `3N × 3N`, in Hartree/bohr², with at most 400 atoms.
Their values remain unsymmetrized: every transposed pair may differ by at most
1% of the matrix's largest absolute element. Optional masses are finite, positive,
at most 1,000 amu and one per atom. Source readers use the same Hessian validator.

## Binding, revisions and asset ownership

The runtime binds exactly one atomic structure with each source atom occurring
once, ordered through Mol* `atomSourceIndex`. Refs, frame and coordinates must
remain current; the scene comparison allows 1e-3 Å per coordinate for float32.
SDF and MOL additionally hash the actual displayed parser-input text before and after
the asynchronous read; matching positions alone do not establish graph identity.
MOL has no embedded SDF metadata. Its baseline ordered IDs bind exact source
text and survive restore/resave; changed text has unknown IDs (`null`) until
explicit edit provenance exists. Durable IDs through graph edits and Undo need a
separate source-provenance stage. When SDF metadata supplies atom IDs, they must agree with the manifest's order.
Scientific registrations match exact revision text; repeated text selects the
latest revision. Restored registrations are document-scoped, shared imports are
claimed by their documents, and cleanup releases them after all owners close.
Original survives unrelated edits; scientific data applies only to registered text.

Serialization refuses any pre-existing reserved ID before mutation and checks
again after its first binding await. Imported assets remain until the host has
validated the archive and `adoptValidated` acknowledges the exact manifest SHA,
payload hashes, scene binding and ephemeral import token. Each opening, including
the same archive again, creates a new token before loading starts; an old or
interrupted acknowledgement cannot consume the new opening's assets. The token
is never persisted in the manifest. Temporary export assets exist only during
serialization; cleanup removes only the exact entries that export created, even
on failure. Other scene assets and raced-in replacement entries remain untouched.
Bindings are checked before and after snapshot serialization. A style-only change
after ZIP capture is allowed: the archive keeps its captured style and the live
scene keeps the new style. Scientific exports refuse overlap; `exclusive` work
waits for the active export's cleanup and runs without scientific attachments.

## Bounds and focused checks

`MiB` means 1,048,576 bytes. `SCIENCE_SESSION_LIMITS` sets: archive input 32 MiB;
ZIP entries 4,096; asset index 4 MiB; manifest 4 MiB; attachments 64 plus manifest.
Encoding permits 20 MiB of attachment payloads, excluding the manifest. Decoding
caps each reserved entry at 20 MiB and selected index + manifest + payloads at 24 MiB.
Source limit: 16 MiB; atoms: 10,000; frames: 2,000; grid values: 1,000,000.
XYZ, SDF and MOL readers enforce the source limit in UTF-8 bytes, including BOM.
Graph parsing also retains the chemistry parser’s 2,000,000-character limit.
The runtime separately caps injected assets at 65 and their bytes at 21 MiB.
Schema bounds also include 2,000 basis functions, 1,024 primitives per shell,
10,000 orbitals, 2,000,000 orbital coefficients and 2,000,000 mode displacement
values across frames (top-level repeated modes have a separate budget); JSON depth 12.

```sh
vp run test:scientific-helpers
vp run test:scientific-schema
vp run test:science-codec
vp run test:science-runtime
vp run test:scientific-revisions
```

Sources: [codec](../apps/desktop/src/lib/science-session/codec.ts), [limits](../apps/desktop/src/lib/science-session/contracts.ts),
[binding](../apps/desktop/src/lib/science-session/scene-binding.ts), [schema](../apps/desktop/src/lib/science-session/scientific-document.ts),
[runtime](../PreviewExtension/Web/scene-file-actions.js).
