# Third-party notices

## Mol*

The preview engine vendors `molstar/build/viewer/molstar.js` and `molstar/build/viewer/molstar.css` from the `molstar` package at build time. Mol* is MIT-licensed by its contributors. See the `molstar` package and repository for the authoritative license text.

## QuickLookProtein

This project follows the same broad product idea as QuickLookProtein: a host macOS app that packages a Quick Look extension and renders protein/3D structure files in a WebKit view. No QuickLookProtein source files are vendored here.

## xyzrender

Burrete can call a user-installed `xyzrender` executable from the standalone app and Quick Look previews. The `xyzrender` Python package is MIT-licensed by Alister S. Goodfellow and contributors. `xyzrender` itself is not bundled with Burrete.

## RDKit

Burrete uses the official `@rdkit/rdkit` MinimalLib distribution and stages a
dedicated conformer-parameter extractor built from official RDKit tag
`Release_2025_03_4`, commit
`276b5a662302c6a548ac4f1363c066f3258e3a20`. The extractor uses RDKit distance
geometry, CrystalFF torsion, bounds-smoothing, and stereochemistry code. RDKit
is BSD-3-Clause licensed by Rational Discovery LLC, Greg Landrum, Julie
Penzotti, and other contributors. The authoritative license text copied from
that revision is stored at `compute/rdkit-conformer/RDKIT_LICENSE.txt` and must
ship with the extractor binary.

## mlxmolkit and native GPU Compute Layer provenance

The Burrete project owner records that Guillaume, author of
[`guillaume-osmo/mlxmolkit`](https://github.com/guillaume-osmo/mlxmolkit),
granted permission to copy and adapt useful code and algorithmic logic for the
Burrete native GPU Compute Layer. The pinned audit source is commit
`9e7337f6f93c40a39ad0187991151944a4f1e274`.

The pinned repository contains no top-level `LICENSE` file, although its
package metadata declares MIT. No `mlxmolkit` source is currently shipped in
the Compute Layer. Before an adapted file is added, Burrete must preserve the
permission evidence and add a file-level provenance record mapping the Burrete
path to the upstream path and commit.

Burrete's independently written distance-geometry and ETK CPU oracles, Metal
evaluation kernels, bounded L-BFGS CPU oracle, and fused Metal optimizers use
mathematical equations and optimizer behavior checked against the pinned
`mlxmolkit` reference. No upstream source text is included. The exact
formula-only mappings and remaining nvMolKit/Shivam Patel secondary-source
release gates are recorded in `docs/third-party/mlxmolkit-provenance.md`.

The bounded closed-shell SCF, symmetric diagonalization, DIIS, adaptive
damping, molecule packing, and population-charge driver is independently
written. The native evaluator adapts numeric parameter data and selected NDDO
equations under the notices below. RM1 is implemented for its ten-element
upstream domain; parity-gated CHNO slices of AM1, PM3, PM6_SP, and AM1* are
also available. PM6, PM6_D, broader element domains, and d-orbital support are
not yet production capabilities.

Upstream identifies material derived from or compared with nvMolKit
(Apache-2.0), Shivam Patel's `mlxmolkit` (MIT), PYSEQM (BSD-3-Clause), and
OpenMOPAC (Apache-2.0). Permission from the primary author does not replace
notices or license obligations for those secondary sources. Their applicable
copyright and license texts must be included when such material is adapted.

## OpenMOPAC semiempirical parameters

The native semiempirical layer adapts the RM1 numeric parameter table from
OpenMOPAC commit `052691223d19935a89f0fe18cd12301bd83e4201`, file
`src/models/parameters_for_RM1_C.F90`. That file is copyright 2021 Virginia
Polytechnic Institute and State University and licensed under Apache-2.0. The
authoritative license is included at
`compute/semiempirical/licenses/OPENMOPAC-APACHE-2.0.txt`.

The RM1 core-core and Gaussian-correction equations were adapted against
PYSEQM commit `6ced9ea66160428e06d37df18e9f565b8123f84a`, file
`seqm/seqm_functions/energy.py`. PYSEQM is copyright 2020 Triad National
Security, LLC and distributed under BSD-3-Clause; its authoritative license is
included at `compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt`. The SCF,
diagonalization, DIIS, molecule packing, and charge code remains independently
written.

The RM1 sp-basis multipole separation and additive-term equations are adapted
from the same PYSEQM revision, file `seqm/seqm_functions/cal_par.py`, under the
same BSD-3-Clause notice. The complete H-H, heavy-H, and heavy-heavy 22-term
sp-basis local-frame two-center integral equations are adapted from
`seqm/seqm_functions/two_elec_two_center_int_local_frame.py` at that revision.
The quaternion molecular-frame rotation and sp pair-tensor contraction are
adapted from `seqm/seqm_functions/two_elec_two_center_int.py` at that revision.
The first- and second-row sp overlap equations are adapted from
`seqm/seqm_functions/diat_overlap_PM6_SP.py` at that revision.
Third-row equations use the same source. Fourth- and fifth-row overlaps use an
independently structured bounded Gauss-Legendre implementation of the standard
prolate-spheroidal STO integral, checked against
`mlxmolkit/rm1/slater_overlap_ref.py`; no SciPy or Python code is included.
The RM1 NDDO core-Hamiltonian, one-/two-center Fock contractions, and electronic
energy equation are adapted from `seqm/seqm_functions/fock.py` and `energy.py`
at that revision. Burrete's bounded SCF/DIIS driver and eigensolver remain
independently written.

The CHNO AM1, PM3, PM6_SP, and AM1* parameter slices are adapted against the
pinned `mlxmolkit` method tables and the corresponding OpenMOPAC parameter
modules. The complete 40-element parameterized PM6 CSV domain is retained as
a byte-identical build-time reference and compiled into a typed Rust table,
including the 18 elements with d-orbital fields. The byte-identical upstream
PM6 PWCCT pair table is SHA-gated and compiled into native sparse records.
PM6 core-core PWCCT equations and the full variable-basis SCF assembly are
adapted against pinned `mlxmolkit` and PYSEQM references. Production exposure
remains gated on native Metal parity and the documented validation suite.

The PM6 243-term one-center W lookup maps are retained from the pinned
`mlxmolkit/rm1/w_integrals.py` implementation, whose comments identify the
PYSEQM `build_two_elec_one_center_int_D.py` map source. The Slater-Condon and
52-intermediate equations are implemented in native Rust and checked against
the pinned upstream oracle for main-group and transition-metal d elements.
mlxmolkit MIT and PYSEQM BSD-3-Clause attribution apply.

The PM6 45-output one-center d Fock contraction map is retained from the
pinned `mlxmolkit/rm1/fock_d.py` representation of PYSEQM behavior. Burrete's
production implementation performs the packed-density weighting, contraction,
and symmetric 9x9 unpacking in native Rust. mlxmolkit MIT and PYSEQM
BSD-3-Clause attribution apply.

The PM6 real-harmonic Wigner d rotation and d-d/d-p/d-s overlap transforms are
adapted from the pinned `mlxmolkit/rm1/wigner_d.py` formulas, which cite Ivanic
and Ruedenberg, J. Phys. Chem. 100, 6342 (1996). mlxmolkit MIT attribution
applies.

PM6 radial d-s, d-p, and d-d Slater overlap uses Burrete's independently
structured bounded Gauss-Legendre prolate-spheroidal implementation for
principal quantum numbers one through five. The mathematical behavior is
checked against `mlxmolkit/rm1/slater_overlap_ref.py` and the d-channel layout
in `mlxmolkit/rm1/overlap_d.py`; no Python or SciPy runtime is included.

PM6 d-basis charge separations and the `rho3` through `rho6` additive terms
adapt the AIJL, Slater-Condon, and POIJ derivation from PYSEQM
`two_elec_two_center_int.py` and `cal_par.py`, including its distinct
transition-metal and main-group branches. PYSEQM BSD-3-Clause attribution
applies.

The PM6 d-basis atom--hydrogen two-center integral matrix adapts the YH
Klopman-Ohno-Dewar multipole equations and nine-orbital rotation convention
from PYSEQM `two_elec_two_center_int_local_frame_d_orbitals.py` and
`RotationMatrixD.py`. PYSEQM BSD-3-Clause attribution applies.

The byte-identical pinned NumPy representation of PYSEQM's d-orbital
two-center equations is retained under `compute/semiempirical/reference/` as
a development-time generation and parity source. The native YX local tensor is
mechanically generated from its AST and does not execute Python in production.
PYSEQM BSD-3-Clause attribution applies.

The PM6-D3H4 H4 hydrogen-bond equations, covalent-radius table, short-range
H-H polynomial, and CHNO D3 C6/CN/r0 reference records are adapted from
OpenMOPAC correction behavior through the pinned
`mlxmolkit/rm1/pm6_d3h4.py` reference and its bundled tables. OpenMOPAC's
Apache-2.0 and mlxmolkit's MIT attribution apply. The current D3 table is
explicitly limited to the parity-gated CHNO domain; full-element D3 and
production PM6-D3H4 SCF composition remain pending.
