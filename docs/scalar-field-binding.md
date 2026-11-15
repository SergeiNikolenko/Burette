# Scalar field source ownership

The internal browser viewer route binds a calculation to both its scientific
source and the displayed native source before a quantum worker starts. It is
separate from the public molecular MCP tool contract.

1. Capture the exact editable iframe and retain that target.
2. Send `scalar_field_binding` with a `ScalarSourceIdentity`. The viewer captures
   the source cell, its ancestors, native data objects and transform versions
   before loading the helper or hashing source data.
3. For atomic sources, compare source-order element symbols and coordinates at
   Mol* Float32 precision. Repeated assembly atoms, subsets and reordered atoms
   cannot satisfy the source-order identity. Every atomic source also requires its exact decoded source SHA-256. Normal
   FCHK/Molden imports supply the generated XYZ source from the scientific
   source owner; the immutable Original file is not used as that identity.
   A direct source must match the native raw source itself. Geometry-only
   correspondence cannot authorize a different calculation with the same atoms.
4. A Cube source requires its exact decoded source SHA-256, dimensions, physical
   grid matrix and SHA-256 of its dense little-endian Float32 values. The source
   digest includes the atom header. A typed-array subview hashes only its values.
5. The response contains a fresh opaque `lease`. `scalar_field_validate` checks
   the same lease; `show_scalar_field` requires it for both display and clear.
   The field's existing conditional native commit also checks this owner.
6. Native source changes revoke the receipt permanently, including edit/Undo
   back to the same bytes. Concurrent binding requests cannot let an earlier
   asynchronous digest overwrite a later owner. One receipt/subscription per
   plugin is retained; replacement or native disposal releases it. Cancelled
   binding, validation and display requests use the existing bounded ACK status
   tracker, so a retired reply cannot become a new global error. Current,
   unknown and wrong-window errors remain visible.

The Orbitals owner keeps the receipt through calculation, serialization,
presentation, isovalue changes, clear and export eligibility. Changing a field
on the same source validates and reuses the receipt, so cancelling replacement
work can still clear the previous visible surface. A ready grid never obtains
fresh permission from a different scene.

Changing the displayed spin channel selects its HOMO, or its first orbital
when no occupied orbital is present. A wanted orbital surface follows that
selection; an old field cannot be exported while the replacement is computing.
Total and spin-density fields remain independent of the displayed orbital
channel. A beta-only file starts in beta and cannot select an absent alpha
channel. Worker requests and field ownership use array positions, while displayed
orbital numbers retain source IDs. Those IDs may be sparse or repeat across
channels; colliding export names include the spin channel.

Export is a snapshot at native acceptance: if the source changes after the
retained receipt was validated but before its ACK or save dialog finishes, the
already accepted Cube keeps its original captured bytes and filename. It never
becomes a field of the new source. An export requested after the native source
has changed fails its receipt check.

Cube matrix comparison permits the 8.3e-11 relative difference between the
pinned Mol* and scientific-reader bohr conversion constants; the tolerance is
1e-9 relative, with a 1e-9 angstrom absolute floor. Source bytes and field values
remain digest-exact. Negative-count angstrom Cube files are currently refused
by this binding when the pinned native parser incorrectly scales their grid;
fixing that native parser is a separate outstanding format-support requirement.

Focused validation uses real scientific readers, Mol* state transforms and
quantum/Cube workers. It covers FCHK/Molden generated XYZ, the tracked base-pair
Cube, source changes before/during a worker, native Undo, out-of-order binding,
clear while replacing a surface and export after a native source edit. These
CPU and component checks do not establish actual browser/WebGL, packaged macOS,
Quick Look or iPhone acceptance.

The right Orbitals dock, Compute menu and command palette now expose the
source-owned panel for files with orbital energies or a scalar grid. The menu
uses its own document, and opening it retargets a closed dock that showed
another file. Palette completion focuses the selected tab only while the
requested document and workspace still own the pane. These source/component
checks still require actual browser workflow acceptance.
