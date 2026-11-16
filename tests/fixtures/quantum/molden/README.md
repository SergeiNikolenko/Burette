# ORCA Molden fixtures

ORCA `orca_2mkl` Molden files from
[shabab-kabir/Density_Functional_Theory_Research](https://github.com/shabab-kabir/Density_Functional_Theory_Research)
@ `0607a6d`, `ORCA/ORCA_INP/`, MIT (`shabab-kabir-LICENSE.txt`).

| File | Source | Covers |
| --- | --- | --- |
| `orca-si2h4.molden.input` | `Si2H4.molden.input`, byte-identical | TPSSh, pure d and f shells, all 124 orbitals |
| `orca-si3h4-trimmed.molden.input` | `orca3.molden.input`, first 40 orbitals | cc-pVQZ with pure g shells |

The trimmed file keeps everything before the 41st `Sym=` line:

    awk '/^ *Sym=/{n++} n<=40{print}' orca3.molden.input > orca-si3h4-trimmed.molden.input

Original `orca3.molden.input` SHA-256: `f064c8bc0e8b279490ce6fcccfdb7a711705ef1b41155fab22fa20fb3aa3f213`.

Oracle: `molden-reference.json` (`python molden-reference.py orca-*.molden.input`, PySCF 2.14.0).
Read as the Molden format describes, the orbitals are far from orthonormal (errors 95 and 0.96);
after dividing each coefficient by its primitive's normalization, renormalizing the contraction
and negating the m = ±3 (f, g) and ±4 (g) components, they are orthonormal to 1.1e-9 and 7.4e-11.
The JSON keeps orbital values at fixed points for the first, HOMO, LUMO and last orbitals.

SHA-256:

    1de7be35da3ddaebb9ad43942e7487b7bdd85db281ab284c25520e00ab7f1a60  orca-si2h4.molden.input
    06715ac92f207f67635f2f5257f94dd6fd5eae589fc2a0bd84252df62ab20645  orca-si3h4-trimmed.molden.input
