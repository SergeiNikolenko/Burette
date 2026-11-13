# Psi4 output fixtures

`generate.py` ran once with Psi4 1.11 (conda-forge, LGPL-3.0 program; the outputs are
Burette test data). It printed `water-opt-freq.out` (RHF/6-31G* optimization, then
frequencies, Mulliken/Löwdin charges and dipole), `oh-uhf.out` (UHF/6-31G* doublet) and
`water-scf-fail.out` (SCF stopped by `maxiter 3` with `fail_on_maxiter`), and in the same
process stored the values Psi4 held in memory in `psi4-reference.json`: optimizer history
energies and coordinates (bohr), final wavefunction eigenvalues and electron counts,
frequencies, IR intensities, normal coordinates, the Hessian (Hartree/bohr²), masses,
charges and the SCF dipole (converted with `psi4.constants.dipmom_au2debye`). The reader
under test parses only the text; the JSON is the independent oracle.

`cclib-water-mp2.out` and `cclib-water-ccsd.out` are `data/Psi4/basicPsi4-1.7/water_mp2.out`
and `water_ccsd.out` from [cclib](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/Psi4/basicPsi4-1.7),
BSD-3-Clause (`../cclib-LICENSE.txt`), byte-identical; `cclib-reference.json` is cclib's
parse of them (`python ../cclib-reference.py cclib-water-*.out`). cclib cannot read the Psi4 1.11
outputs (its version check and thermochemistry block assumptions fail), so those use the
Psi4 reference instead.

| File | Calculation | Covers |
| --- | --- | --- |
| `cclib-dvb_ir_rhf-excerpt.out` | Psi4 1.7 RHF/STO-3G frequencies by finite differences of gradients (74 computations) | displaced geometries are not frames; modes, `Correction ZPE` thermochemistry and orbitals stay on the reference geometry |
| `psi4-sapt1.out` | Psi4 1.1 SAPT0/cc-pVDZ ethene–ethyne | SAD one-atom geometries and `C(Gh)` monomer geometries are not frames; the dimer opens |

`cclib-dvb_ir_rhf-excerpt.out` is a verbatim line excerpt of cclib's
[`data/Psi4/basicPsi4-1.7/dvb_ir_rhf.out`](https://raw.githubusercontent.com/cclib/cclib/0c6e08e0a0d04b308201666793030ef3b77b2973/data/Psi4/basicPsi4-1.7/dvb_ir_rhf.out)
(BSD-3-Clause, 1.6 MB, SHA-256 `b904d273ae8a1b54bb5728f0533e3e7ef8a57c1037cae380db989af7e675ad3a`):
lines 1–998 (input echo, the reference computation and the first displaced computation) and
32882–33564 (`FiniteDifference Results`, the vibrational analysis and thermochemistry), made with
`sed -n '1,998p;32882,$p' dvb_ir_rhf.out`.

`psi4-sapt1.out` is Psi4's regression output
[`tests/sapt1/output.ref`](https://github.com/psi4/psi4/blob/f16f4ea2ff2351cc2ab877d9b3887fcf81c2a670/tests/sapt1/output.ref)
at commit `f16f4ea2ff2351cc2ab877d9b3887fcf81c2a670` (tag v1.11; unchanged since v1.1),
LGPL-3.0 (`../psi4-LICENSE.txt`), byte-identical.

SHA-256:

    7de8508019643a0081821b088b972744aada0d79317236e1e1bd415575a850c6  cclib-dvb_ir_rhf-excerpt.out
    1a79ec98edfd279a8faee54214c2b460e5bfa99b914338aeb3bbcef308f3ee8b  cclib-water-ccsd.out
    a3cf1b5a465014632cf42effe5d11a947c72d1eb84911078acdf96a1124f03bb  cclib-water-mp2.out
    eb599ecc5843565582374a4936c420079ebec6b9c762dc10ca9861d4be83e8f7  oh-uhf.out
    abb1498d92d3aba4f63db090a6750d3b41ca1c962c2932f265a1dc3679046322  psi4-sapt1.out
    f7704bbe0b0742f552f6e89850fb6f0662fc1c3d7a029ca33b17cf2aa1142ff0  water-opt-freq.out
    9cb5a37242781b0d4f50af7027c0e52eb1b89cbf19c9d1372b3dd314dcacad7c  water-scf-fail.out

Psi4 prints normal-mode displacements to two decimals; the Hessian is printed to 14 and is
the precise source for derived modes.
