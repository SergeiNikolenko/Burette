# Molecular source stereochemistry

Ordinary MOL/SDF parsing and physical MOL serialization retain explicit unknown
stereo constraints alongside known source configurations. This covers the
reviewed tetrahedral and allene cases, including incoming single bonds, terminal
explicit hydrogens and neighboring known/unknown centers. The existing chemistry
worker reuses this boundary; automatic 3D preparation and source-publication
ownership remain separate.

The parsed MOL boundary records unspecified atom/bond constraints before the
coordinate-frame conversion. The existing 256-atom chemistry limit is checked
before this processing; the source-length and single-SDF-record limits remain
unchanged. The common snapshot boundary still checks generated toolkit molecules.

The chemistry worker resolves known 2D diagram parity before physical XYZ
writeback and re-encodes its bonds in that drawing frame. Known 3D parity follows
the coordinates actually supplied; old known labels are not restored over a
changed or reflected body. Conformer search reapplies unknown source constraints
after its existing bounded relaxation without changing the returned coordinates
or computed energy. Force-field selection, optimization methods and request/result
shapes are unchanged.

The serializer retains physical angstrom coordinates and its existing numerical
rounding. Explicit unknown atom constraints use an outgoing wavy single bond,
at an allene terminus for axial stereo. If the constraint cannot be represented,
serialization fails rather than silently choosing a configuration. Known source
configurations, graph identity, charges and isotopes remain part of the focused
regression contract. This is not a cross-tool claim about absolute axial R/S names.

The toolkit can normalize ordinary explicit-H row order. `MolecularStructure.atomMap`
records the relationship between external atom order and serialized MOL order.
Graph-edit consumers must use their existing metadata/order normalization; raw
array indices from the previous source are not stable identifiers after reopen.
The unchanged raw interspersed-H fixture still has three strict row-order
mismatches. Mapped physical identity and the tested graph-metadata edit/remap
consumers are separate evidence, not a reason to erase those raw observations.

The core and axial scientific matrices still contain further-relaxation strain
reviews, sodium sampling failures, boron/MMFF94 parameter limits and linear
MMFF94 energy errors. Relaxed allene substituent planes still fail the original
orthogonality gates in part of the axial matrix. Finite energy is not acceptance
of geometry quality, converged preparation or successful Optimize publication.

Run `vp run test:molecule-source-stereo` for repeated known/unknown source
roundtrips, literal axial handedness, and refusal of an oversized real MOL before
stereo processing. Run `vp run test:chemistry-coordinate-boundary` for actual
isolated-worker source stereo, reflected 3D labels, energies and caller-frame
forces. Existing chemistry, metadata and native-residue tests cover their own
consumers. Browser/native viewer interactions, source Original
archives and complete automatic 3D preparation require separate acceptance.
