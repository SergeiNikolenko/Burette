# Graph editing and molecular properties

## Entry points and ownership

Open a single MOL, SDF or SD document and add **Edit** to the right dock.
**Info → Tools → Properties → Calculate** opens the same document's properties.
A browser-owned generated document must still own its original source when an
editing session begins. Existing Text sessions do not bypass this check.
Collections retain their collection workflow; they are not a single graph draft.

`useGraphDraft` shares the source controller's history between Properties and
Edit. Add/remove H, optimization and metadata each publish one completed edit.
Undo restores the previous source; Redo restores its stable atom identities.
The selected atoms belong to a particular graph snapshot. Incoming 3D picks
also require the owning visible iframe and an acknowledged source revision.
An old iframe cannot reuse its atom indices against a newer graph.

**Save copy** exports the edited source without replacing the original file.
`BURETTE_METADATA_V1` retains atom IDs, atom names, residue fields and the
conformer ID/label in SDF. Info omits only that exact internal property name;
ordinary user properties remain visible. Reopening a saved copy starts its own
history. See [Scientific scene format](scientific-scene-format.md) for MOLX.

## Scientific operations

Properties includes formula, masses, graph counts, charge, hydrogen-bond
counts, rotatable bonds, polar surface area and cLogP. Gasteiger charge CSV
preserves atom order. Energy and force export require a supported force field
and finite results. The current optimization controls offer MMFF94, MMFF94s
and UFF, with L-BFGS, FIRE, ABC-FIRE and FIRE followed by L-BFGS, subject to the
existing atom limits. Numerical optimization can open its steps as XYZ.

Adding H preserves existing coordinates, graph/stereo annotations and IDs.
It does not optimize the heavy-atom geometry. Invalid new-H geometry is refused
before publishing a draft. In particular, the collinear `single.sdf` sample can
receive H without moving C–C–O; its four-atom MMFF torsions remain undefined.
The actual MMFF evaluator returns a nonfinite energy for that geometry, so the
operation is rejected without changing the document. Automatic preparation of
a different 3D starting geometry is a separate, still-unaccepted workflow.

## Focused validation

```bash
vp run test:properties-consumer
vp run test:properties-info
vp run test:structure-edit-panel
vp run test:structure-edit-controls
vp run test:single-sdf-source-pipeline
vp run test:add-hydrogens-geometry
vp run test:zmatrix-definition-editing
```

Properties and Edit consumers run both directly and through React Compiler.
The source-selection fixture drives the real controller, preview slots and
receiver through queued, staged, promoted, late and in-place-acknowledged frames.
The Z-matrix command above accepts only the pure row/binding prerequisite;
Geometry/Z-matrix panels and their Export input consumer remain separate work.

Browser checks must use a fixed source revision and the transport described in
[Testing surfaces](tools/testing-surfaces.md#compiled-browser-shell). Revision
`68e78395482aeac693f7cf8cb8915d2048d0307c` was built and exercised as a static
browser shell: Properties → Add H → Edit, Undo/Redo, metadata, actual SDF download
and file-picker reopen, charge CSV download, UFF convergence, and MMFF on the
resulting nonlinear control. FIRE opened a 252-frame XYZ trajectory and advanced
from frame 1 to 2. Its 250-step run correctly reported **Not converged**.
Escape closed Properties and returned focus to Calculate.

Light/dark and 760/1280-pixel inspection exposed a pane-resize defect when
constraints re-register. Initial numeric-field screenshots also caught incomplete
painting, but matched settled repeats displayed all digits correctly; no renderer
workaround was accepted on those transient images. Visual acceptance remains partial. Full Avogadro parity and packaged macOS, Quick Look and iPhone
acceptance remain open; browser results cover their own runtime only.
