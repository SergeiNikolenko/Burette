# Graph editing and molecular properties

## Entry points and ownership

Open a single MOL, SDF or SD document and add **Edit** to the right dock, or run
**Edit atoms and bonds** from the command palette. **Edit geometry** opens the
Geometry dock the same way for an XYZ document.
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
and finite results. The optimization controls offer **Automatic** (the
default), MMFF94, MMFF94s, UFF and Lennard-Jones, with BFGS, L-BFGS, FIRE,
ABC-FIRE and FIRE followed by L-BFGS, and a step limit of 100, 250 (the
default), 500 or 1000 accepted steps. Automatic takes the first of MMFF94 and
UFF with parameters for every element of a complete bond graph, and
Lennard-Jones for a structure without bonds; a bonded XYZ structure without a
complete graph is refused with that reason. It is resolved on the structure
that runs, and the result names the model used. A model without parameters for
an element is disabled and names the element; UFF can still refuse an atom
whose bonding its typer does not recognize (square-planar Pt, for example).
Lennard-Jones is Avogadro's model: every atom pair, bonded or not, has its
minimum of −100 kJ/mol at the sum of the Alvarez van der Waals radii, so it
suits clusters and noble gases, not covalent geometry.
Quasi-Newton runs that stop lowering the energy at its numerical noise floor
restart once from steepest descent and then end as stalled instead of spending
the step limit. Every method holds the
same constraints and records every step; the checked method is the one that
runs. Optimize is disabled with its reason when the structure is outside the
shared bounds (256 atoms, 64 constraints, 64 atoms for coupled Z-matrix
variables); a structure without an analytic MMFF gradient reports the 64-atom
numerical limit when it runs. While it runs, the status
shows the latest step and its energy. Every result line names the force field
and method, and **Open steps** opens the steps as XYZ with per-step energies.

Avogadro's commands run in the panel that edits the active structure (Edit for
SDF/MOL, Geometry for XYZ) from the Structure menu, the command palette and
⌥⌘O: **Optimize Geometry** optimizes with the saved settings, **Calculate
Energy** reports the single-point energy of the model Automatic or the chosen
field gives, **Freeze/Unfreeze Selected Atoms** change the frozen atoms of the
3D selection, and **Configure Optimization…** (also the last item of the
Optimize menu) sets the force field, minimizer, any step limit from 1 to 1000
and the convergence as powers of ten: the energy change per step averaged over
ten steps (default 10⁻⁵ kcal/mol, as Avogadro's energy window) and the largest
gradient component (default 10⁻³ kcal/(mol·Å)). In Geometry the 3D view follows
each reported step; Cancel restores the start, and the finished run is one
Undo step. The xTB job in the Compute menu is **Optimize with xTB**.

**Auto Optimize** (Structure menu, palette, Optimize menu) relaxes the
structure continuously, as Avogadro's tool: a worker keeps one minimizer
(Hybrid FIRE, then L-BFGS) and runs it in chunks sized to about 33 ms of work,
the 3D view follows every chunk and the toolbar shows the model and ΔE. Atoms
dragged in the 3D view hold the positions they are given while the rest
follows; each move restarts the minimizer from the new geometry. The same
command or **Stop** ends the session and keeps the relaxed geometry as one Undo
step; any other edit ends it without a change.

On the desktop the same Optimize menu and Configure dialog also list external
energy models: **GFN2-xTB**, **GFN1-xTB** and **GFN-FF** through the xTB program
Burette finds for its xTB jobs, and each model an installed Avogadro package
declares under `[[tool.avogadro.energy-models]]` (named by the package). They
run Cartesian optimizations with the same methods, constraints, convergence,
live steps, Cancel and Undo, and Calculate Energy reports their energy. A model
is disabled with its reason when its package is not set up, it provides no
gradients, it reads an input format Burette does not write, it lacks an element,
or the structure has a charge or unpaired electrons it does not accept. Their
energies are absolute (an xTB water molecule is about −3182 kcal/mol), so only
differences compare with the force fields. External models never run Auto
Optimize, which stays in the browser worker, nor coupled Z-matrix variables,
and the browser shell lists none.

In the Edit panel of an SDF/MOL structure, **Freeze** keeps the selected atoms
in place and **Hold distance/angle/dihedral** restrains two, three or four
selected atoms to a target, which starts at the current value and can be
typed. Constraints follow their atoms through edits and optimizations; Undo,
Redo and operations that renumber atoms start without them. Geometry and Edit
list each held distance, angle and dihedral with its value and signed residual
after Optimize, and refuse constraints that are undefined on the current
geometry before optimizing.

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

Builders insert the same way. When the active document is an editable MOL/SDF,
the peptide builder (and the other builders that return a graph) shows
**Insert** beside Preview: it builds or reuses the preview and adds it to that
document as a separate molecule through `insert-fragment` with a `graph` source,
one Undo step in the document's Edit history. The built geometry is kept and
translated beside the structure like any separate molecule, stereo collections
are remapped with the atom order, and the 256-atom budget counts the result. Opening from the
command palette passes the active document; without one the button is absent.
`test:insert-built-structure` inserts the real Ala-Gly worker output into an
ethanol SDF and has RDKit read the draft (ethanol plus L-Ala-Gly zwitterion),
then checks Undo and a builder failure.

`test:fragment-insertion` checks all 166 library groups against the upstream
SMILES including the attachment atom (RDKit constitution with a francium marker),
insertion products against independent RDKit SMILES (ethylbenzene, 2-propanol,
biphenyl, benzoate, anilinium, lysyl and tert-butyl chloride), Allen et al. (1987)
bond lengths, unchanged source coordinates and angles, rigid fragment distances,
refusals, the real-worker Undo/Redo/SDF data path and the dialog controls.
