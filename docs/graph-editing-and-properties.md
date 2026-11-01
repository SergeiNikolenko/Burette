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
and finite results. The optimization controls offer MMFF94, MMFF94s and UFF,
with BFGS (the MMFF toolkit minimizer, unconstrained only), L-BFGS, FIRE,
ABC-FIRE and FIRE followed by L-BFGS. A method or force field that cannot run on
the structure (UFF or numerical methods above 64 atoms, BFGS with constraints,
UFF or coupled Z-matrix variables) is shown disabled with its reason, and the
checked method is the one that runs. Methods other than BFGS can open their
steps as XYZ with per-step energies. Geometry lists each distance, angle and
dihedral constraint with its value and signed residual, and refuses constraints
that are undefined on the current geometry before optimizing.

A flat SDF/MOL drawing (every z at zero) offers Generate 3D in Properties and in
the Edit menu: hydrogens are added after the source atoms, the structure is
embedded with its stereochemistry checked against the drawing, relaxed with
MMFF94 BFGS and published as one undoable edit. Conformer search in Properties
relaxes the requested number of samples and opens the distinct minima, lowest
energy first, as a new SDF.

Adding H preserves existing coordinates, graph/stereo annotations and IDs.
It does not optimize the heavy-atom geometry. Invalid new-H geometry is refused
before publishing a draft. In particular, the collinear `single.sdf` sample can
receive H without moving C–C–O; its four-atom MMFF torsions remain undefined.
The actual MMFF evaluator returns a nonfinite energy for that geometry, so the
operation is rejected without changing the document. Automatic preparation of
a different 3D starting geometry is a separate, still-unaccepted workflow.
[Hydrogens and pH protonation](hydrogen-protonation.md) describes the H
placement rules, Remove Hydrogens and the pH protonation model.

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
constraints re-register. The dependency fix subsequently passed the fixed-build
[resizable panel browser acceptance](react-resizable-panels-patch.md#browser-acceptance),
including hidden Settings transitions, collapse/reopen, keyboard resizing and
pointer drag. Initial numeric-field screenshots also caught incomplete painting,
but settled repeats displayed all digits correctly; no renderer workaround was
accepted on those transient images. Full Avogadro parity and packaged macOS,
Quick Look and iPhone acceptance remain open; browser results cover their own
runtime only.

## Fragment insertion

Edit → More actions → **Insert fragment…** opens a modeless dialog, so atoms can
still be picked in the 3D view. Library lists the 166 functional groups of
OpenChemistry/fragments `7d842f435aec4729a308b23ad7f9501bdd44aa02` (BSD-3-Clause,
see `THIRD_PARTY_NOTICES.md`), extracted by `scripts/generate-fragment-library.mjs`
with per-file hashes in `config/fragment-library-sources.json`. SMILES accepts one
string; a single `*` marks its attachment point, otherwise the first atom attaches
through one of its hydrogens (the upstream `groups.smi` convention).

With exactly one selected atom the fragment attaches there; otherwise it becomes a
separate molecule placed 3 Å beyond the structure's +x extent with its dummy
capped by hydrogen. A selected hydrogen is replaced; a selected heavy atom
replaces whichever of its explicit hydrogens gives the least steric repulsion, or,
without explicit hydrogens, uses the positions Add Hydrogens would give its free
valences. The fragment is rigid: its atom bonded to the attachment point bonds to
the anchor along the replaced hydrogen's direction at the summed single-bond
covalent radii (Cordero 2008, hybridization-specific for carbon), rotated about
that bond in 5° steps to minimize an r⁻¹² repulsion over Bondi radii. No existing
atom moves. Any new nonbonded contact closer than half the summed Bondi radii,
two attachment points, an unreadable SMILES or a missing hydrogen is refused
with a named error and leaves the draft unchanged.

The merge is the `add-fragment` graph edit: new atoms, formal charges and Kekulé
bonds plus the deleted hydrogen in one validated OpenChemLib edit within the
256-atom budget, so it is one Undo step with exact provenance (`-1` for new
atoms) for SDF data items and MOL atom identities. The inserted atoms become the
selection; the dialog stays open for the next insertion.

`test:fragment-insertion` checks all 166 library groups against the upstream
SMILES including the attachment atom (RDKit constitution with a francium marker),
insertion products against independent RDKit SMILES (ethylbenzene, 2-propanol,
biphenyl, benzoate, anilinium, lysyl and tert-butyl chloride), Allen et al. (1987)
bond lengths, unchanged source coordinates and angles, rigid fragment distances,
refusals, the real-worker Undo/Redo/SDF data path and the dialog controls.
