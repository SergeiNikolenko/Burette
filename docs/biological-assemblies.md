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
