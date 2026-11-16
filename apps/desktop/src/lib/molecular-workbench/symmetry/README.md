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
find primitive cells, refine geometry or merge symmetry-equivalent atoms; those
belong to moyo in `../crystal-symmetry.ts`, and every crystal edit, Niggli
included, runs through `../crystal-edit.ts` in the crystal worker.

# Molecular point groups

`point-group.ts` drives the libmsym engine of the same build contract for
molecules of up to 256 atoms: detection with Avogadro's four tolerance presets
and symmetrization, both in `symmetry-worker.ts` behind `symmetry-client.ts`.
Isotopes are separate species, so D2O and HDO keep their own groups. The
Symmetry dock panel and the `point_group` agent job are its consumers; molecules
with a unit cell use the crystal tools instead.

Run `vp run test:niggli-cell` and `vp run typecheck:niggli-cell`; point groups
are covered by `bun run test:point-group` and, against pymatgen, by
`bun run test:crystal-analysis`. The focused
suite retains the original Niggli engine assertions, eight Python spglib 2.8.0
reference cases, and an exact near-face Cartesian reconstruction regression.
The WASM asset/build provenance and loader checks remain separate.
