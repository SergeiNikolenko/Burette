# Biological assembly materialization

`biological-assembly.ts` reads explicit deposited biological assemblies from
text PDB or mmCIF and writes a new materialized mmCIF. It does not infer an
assembly from crystal symmetry. `assembly-connections.ts` owns connection
endpoint resolution and remapping. Both use the existing Mol* parser/writer.

`listBiologicalAssemblies(text, format)` returns assembly choices and source
models. `materializeBiologicalAssembly(text, format, assemblyId, modelNumber?)`
requires a model when the source has several. The result contains CIF text,
atom/chain counts, assembly/model identifiers and export warnings.

Generators select label chains; Cartesian operator products act rightmost
first. A source atom row is retained once per distinct composed transform,
including alternate locations and zero occupancy. Atom IDs and copied label
chains become unique; author chains include the copy suffix. The source model,
chemical attributes and entity relationships remain in the exported rows.
These generated IDs are not a persistent source-row/operator selection map.

Connection endpoints resolve against atoms of the selected model, including
entity, residue and alternate-location identity, then map into each shared
operator copy. Unsupported third partners, crystal-symmetry connections and
absent/ambiguous endpoints are omitted with warnings. Anisotropic displacement
tensors are not exported. This is a materialized structure, not a lossless copy
of every deposited annotation or a crystal-symmetry export.

Input is limited to 20 MB UTF-8, 250,000 atoms, 64 assembly definitions and
1,024 operators/generators/copies. Operator products have at most four groups.
Expanded atom count is at most 250,000; predicted and encoded output must fit
64 MB. Connection matching is limited to 1,000,000 comparisons and 250,000
output rows. Allocation preflights include repeated arbitrary attributes.

Run the focused real-parser tests and strict typecheck:

```sh
vp run test:biological-assembly
vp run typecheck:biological-assembly
```

The fixtures in these tests are authored PDB/mmCIF examples. They verify the
pure scientific export contract; they do not certify a production structure,
worker, ordinary file chooser, native viewer, or browser workflow. UI activation
and underscore-containing copied-chain query support require their own paired
host/viewer validation. No panels or general science worker are activated here.


## Worker and source publication owner

`assembly-task.ts` sends only assembly listing/materialization requests to its
private worker through the existing worker runner. Abort and timeout terminate
that worker; the general science worker and unrelated builders are not loaded.

`assembly-source.ts` reads the exact open document or current draft through the
shared source reader, with a 20 MB limit. Its capture belongs to the same document
object, logical source lifetime and draft revision until released. A document
replacement remains retired even if the old object is restored before React
commits. The source editor's existing monotonic revision distinguishes a draft
edit followed by restoring identical text. This stricter assembly publication
contract supplements the existing document-lifetime `captureOperation` contract;
it does not change that operation's semantics. UI requests must additionally
retain their own request identity and pass the capture through `shouldApply`
until generated-document preparation finishes.

```sh
vp run test:assembly-worker
vp run test:assembly-source
vp run typecheck:assembly-workflow
```

Worker tests execute bundled browser JavaScript using a real worker. Source tests
compile the hook and exercise the real source-editing controller; read transport
and native IPC are held at their existing boundaries. These checks do not certify
an ordinary browser chooser or rendered assembly controls.


## Assembly dialog

The dedicated assembly host owns an exact dialog request. Listing, file picking,
building and generated-document preparation cannot publish after that request,
the source lifetime or its draft revision changes. Several source models or
assemblies require an explicit choice. Cancel keeps the original document and
can be followed by another Build. Each intentional Build opens an independent
new document, even when its bytes match an earlier build. A chosen file replaces
the source only after the chooser accepts it; a cancelled chooser preserves the
current source. Copied chain labels remain the materialized mmCIF labels.

`vp run test:assembly-dialog` checks compiled controls with the real worker,
registered browser imports, actual generated-document preparation and native
mmCIF rereading. Its held preparation checks cover cancellation, request/source
close, document replacement and draft ABA. Host mounting and menu/palette routes
are a separate activation step. Browser interaction acceptance is still separate.


The retained assembly transport regressions run with
`vp run test:assembly-dialog-transport`. Existing source/prepare/cancel assertions
remain; intentional changes are an independent path for repeated generated
output and an actionable file-read error without exposing transport details.


Compute offers Build biological assembly for an individual PDB/mmCIF source.
The command palette also opens the file chooser without a supported source.
Both routes use the dedicated host; other workbench hosts leave assembly
requests to it. `vp run test:assembly-activation` exercises these routes.
Actual browser interaction remains separate from compiled component acceptance.
