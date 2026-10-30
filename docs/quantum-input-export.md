# Quantum input templates

`apps/desktop/src/lib/molecular-workbench/input-export.ts` generates ORCA,
Gaussian, Psi4 and CP2K input files. It returns the file extension and text; engine
execution is a separate operation. The input atom order is retained. Coordinates
are in angstroms, and charge and multiplicity are checked against the electron
count before a template is generated.

Energy, optimization and frequency tasks have an explicit route for each engine.
Constraints apply to optimization only. Internal constraint indices are zero-based;
ORCA retains them, while Gaussian, Psi4 and CP2K exports use one-based references.
ORCA, Gaussian and Psi4 support frozen atoms, distances, angles and dihedrals here.
CP2K supports frozen atoms and the PBE/BLYP functionals with GTH pseudopotentials.
Unsupported CP2K constraints or functionals fail explicitly.

An explicit CP2K cell retains its three lattice vectors and Cartesian positions.
An isolated molecule is centered in a box with six angstroms of padding on each
side; both the cell and electrostatics are nonperiodic, using the Wavelet solver.
Padding, basis and SCF settings are input defaults, not convergence results.
Method and basis keywords are forwarded to the selected engine; the generator
does not determine every engine's method/basis or analytical Hessian availability.
For example, ORCA's `Freq` route requires a supported analytical Hessian method.

## Sources

- [ORCA constraints](https://www.faccts.de/docs/orca/6.1/manual/contents/structurereactivity/optimizations.html)
  and [frequency methods](https://www.faccts.de/docs/orca/6.1/manual/contents/structurereactivity/frequencies.html).
- [Gaussian ModRedundant](https://gaussian.com/opt/) and
  [coordinate units](https://gaussian.com/units/).
- [Psi4 Optking constraints](https://psicode.org/psi4manual/master/optking.html)
  and [molecule specification](https://psicode.org/psi4manual/master/psithonmol.html).
- [CP2K cell vectors](https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/SUBSYS/CELL.html),
  [fixed atoms](https://manual.cp2k.org/trunk/CP2K_INPUT/MOTION/CONSTRAINT/FIXED_ATOMS.html)
  and [Poisson solver](https://manual.cp2k.org/trunk/CP2K_INPUT/FORCE_EVAL/DFT/POISSON.html).

## Validation

```sh
vp run test:quantum-input-export
```

The tests cover all twelve engine/task routes, nonsequential atom indices for each
constraint arity, coordinate order, periodic cells and deliberate rejection paths.
They validate generated input, without executing a quantum-chemistry engine.
The export dialog's source readiness, clipboard lifecycle and file saving have
separate integration tests.
