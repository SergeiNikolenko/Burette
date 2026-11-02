# Internal coordinate editing

## Model ownership

`apps/desktop/src/lib/geometry-editing.ts` converts one plain XYZ geometry into
bond, angle and signed dihedral rows. Distances use angstroms; angles use degrees.
Reconstruction preserves the source reference frame and the text of unchanged
atom lines. It retains small transverse components near linear geometries instead
of rounding them into a singular configuration. Multiple frames and extended XYZ
atom columns require their own readers and are rejected by this editing model.

`apps/desktop/src/lib/workbench/zmatrix-draft.ts` owns definition edits and their
scientific revisions. Named variables, signed bindings and reference points remain
part of the definition. Reference points help place atoms but are excluded from
the exported real-atom list. Conversion to internal coordinates accepts one
geometry and preserves the real-atom order.

A definition-only edit that leaves every real atom at exactly the same position
and in the same order retains its computed scientific data. Changed positions or
atoms produce a new scientific geometry: old orbitals, modes, grids and frame
results are not carried into it. Revisions retain the previous data for Undo;
the scientific source store separately preserves the imported Original bytes.
Row insertion, removal or reordering also changes topology identity when the
real-atom mapping changes. Bond orders are not inferred by these helpers.

Optimization results must agree with the real atoms and the definition that
produced them. A reduced-coordinate result keeps its validated definition rather
than rebuilding shared variables from independently rounded Cartesian values.

## Controls and application boundary

The `constraint-toggle`, `zmatrix-definition-controls` and `zmatrix-row-controls`
components live under `apps/desktop/src/components/workbench`. They use the shared
buttons, menus and popovers. Their tests cover keyboard rename focus, rejected
input, signed bindings, reference selection, row actions and disabled state.

These model and control modules are prerequisites for the complete Geometry
panel. Source-session application, acknowledged viewer mutation, live-preview
cancellation, complete panel workflows and browser acceptance require separate
integration checks.

## Cartesian coordinate editor

`apps/desktop/src/lib/molecular-workbench/coordinate-block.ts` adapts Avogadro's
coordinate block generator and Cartesian coordinate editor (see
`THIRD_PARTY_NOTICES.md`). A specification lists the fields of each line: `#`
index, `Z` atomic number, `G` GAMESS atomic number (`6.0`), `S` symbol, `N`
element name, `L` label (`C2`), `x y z` Cartesian and `a b c` lattice
coordinates, `0`/`1` literal flags, `_` a space and `,` a comma; Z-matrix modes
add `I J K` reference rows and `R A T` distance, angle and dihedral. Widths,
six-decimal precision, separators and the ragged or zero-padded Z-matrix rows
follow Avogadro. Presets are Avogadro's editor list plus the coordinate blocks
of its Gaussian, MOPAC, ORCA, Psi4, Molpro and GAMESS-UK input generators.
Distances can be in ångström or bohr (CODATA 2022, 0.529177210544 Å); lattice
fields are fractional and need a cell, so their presets appear only with one.

Reading accepts the same specification, or detects one from the first line
when the format is empty, as Avogadro does. Blank lines are skipped and extra
trailing fields ignored. Every invalid line reports its line number and reason,
and nothing is applied while any remains. Input is limited to 1 MiB and 512
atoms, with finite coordinates within ±1e6 Å. A field still showing its
generated text keeps the exact source value, so an edit changes only the
values the user typed. Z-matrix rows are Burette's own atom-ordered rows from
`internal-coordinates.mjs`; read rows are rebuilt by the same code, may use
`X` reference rows, and are placed in the source orientation. Dihedrals outside
±180° are wrapped. Unlike Avogadro, `_` and `,` never consume a field, `Z` and `G`
must name a real element, and element fields on one line must agree.

The editor is the **Cartesian** view of an existing panel: Geometry for plain
XYZ and Edit for MOL/SDF graphs. Apply takes positions of the same atoms in
the same order. XYZ positions go through Geometry's acknowledged edit as one
Undo step that keeps unmoved atom lines verbatim; graph positions go through
the shared graph draft as one Undo step that keeps bonds, stereo flags, SDF
metadata and atom IDs. A changed atom count or element is refused, as is an
XYZ source with an internal-coordinate marker; the Z-matrix panel does not
offer the view. An edit whose structure changed meanwhile is never applied;
Revert shows the current atoms. Changing the preset or unit keeps an edited
draft and reads it in the new format.

## Focused validation

```sh
vp run test:zmatrix-definition-editing
vp run test:zmatrix-draft
vp run test:geometry-model-control
vp run test:zmatrix-controls
vp run test:coordinate-block
vp run test:coordinate-editor
```

`test:coordinate-block` reads committed Open Babel 3.2.1 outputs of the RDKit
test conformers and compares Burette's reading with the source atoms; Open
Babel also reads Burette's blocks back, and gemmi fractionalizes one conformer
in a triclinic cell. Regenerate them with
`uv run --with gemmi python tests/support/regenerate-coordinate-block-oracles.py`.

The numeric suites cover coupled variables, frozen atoms, signed torsions,
reference-frame preservation and invalidation of results from an older geometry.
Component tests exercise the actual controls through the React Compiler. They do
not establish browser layout or native runtime behavior.
