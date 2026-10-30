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

## Focused validation

```sh
vp run test:zmatrix-definition-editing
vp run test:zmatrix-draft
vp run test:geometry-model-control
vp run test:zmatrix-controls
```

The numeric suites cover coupled variables, frozen atoms, signed torsions,
reference-frame preservation and invalidation of results from an older geometry.
Component tests exercise the actual controls through the React Compiler. They do
not establish browser layout or native runtime behavior.
