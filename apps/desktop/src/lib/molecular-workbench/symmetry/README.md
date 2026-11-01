# Cell reduction

`niggli.ts` uses the pinned standalone spglib 2.8.0 Niggli engine described in
[the build contract](../../../../../../compute/symmetry-wasm/README.md).
It accepts a `UnitCell` whose rows are lattice vectors in angstrom. The C ABI
stores the Cartesian components of column basis vectors in row-major order.
The `eps` tolerance compares metric entries (angstrom squared), not positions.

For column lattices A and B, reduction returns B = A T with integer unimodular
T and its exact integer inverse. Fractional coordinates follow T⁻¹ f. Atom
order, species and Cartesian sites are retained; wrapped sites include explicit
integer lattice translations. Wrapping does not snap sites near a face. Only
a boundary rounded to exactly 1 by floating-point subtraction is normalized.

This is a passive lattice basis change. It does not determine space groups,
find primitive cells, refine geometry or merge symmetry-equivalent atoms.
Moyo analysis, primitive/conventional standardization, output formats, workers
and UI activation are separate stages.

Run `vp run test:niggli-cell` and `vp run typecheck:niggli-cell`. The focused
suite retains the original Niggli engine assertions, eight Python spglib 2.8.0
reference cases, and an exact near-face Cartesian reconstruction regression.
The WASM asset/build provenance and loader checks remain separate.
