# Gaussian log fixtures

Gaussian 16 outputs from
[cclib](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/Gaussian/basicGaussian16),
BSD-3-Clause (`../cclib-LICENSE.txt`).

| File | Route | Covers |
| --- | --- | --- |
| `cclib-dvb_sp.out` | B3LYP/STO-3G `pop=full gfinput` | general basis with SP shells, MO coefficients with symmetry, Mulliken charges |
| `cclib-C_bigbasis-trimmed.out` | HF/aug-cc-pVQZ `pop=full gfinput` (5D, 7F) | pure d, f and g components |
| `cclib-dvb_un_sp.log` | UB3LYP `pop=full` without `gfinput` | alpha/beta eigenvalues, `Mulliken charges and spin densities` |
| `cclib-dvb_gopt.out` | B3LYP optimization | population analysis at the first and final geometry, dipole |
| `cclib-dvb_ir.out` | B3LYP/STO-3G `freq=hpmodes` | high-precision mode table before the standard one, thermochemistry |
| `cclib-water_mp2.log` | MP2 `Density Pop=(Full,NaturalOrbitals)` | MP2 total energy supersedes SCF; no SCF orbital table |

All files are byte-identical except `cclib-C_bigbasis-trimmed.out`, which removes the printed
density matrix and gross orbital populations to stay under the repository blob limit:

    a=$(grep -n "^     Density Matrix:" C_bigbasis.out | head -1 | cut -d: -f1)
    b=$(grep -n "Condensed to atoms (all electrons):" C_bigbasis.out | head -1 | cut -d: -f1)
    sed -e "${a},$((b-1))d" C_bigbasis.out > cclib-C_bigbasis-trimmed.out

Original `C_bigbasis.out` SHA-256: `ba93d0e92df09aabbb4f5f46a6209ba564cd78b65d80196c66ce6a174fc5115e`.

Oracles: `cclib-reference.json` (`python ../cclib-reference.py cclib-*`, cclib
`1.8.1.post1298+0c6e08e0`) and `orbital-reference.json` (`python orbital-reference.py
cclib-dvb_sp.out cclib-C_bigbasis-trimmed.out`, PySCF 2.14.0): coefficients are orthonormal in
PySCF's AO overlap to print precision (≤ 2.2e-5) and orbital values at fixed points.

No real Cartesian-d (6D) Gaussian log with `pop=full gfinput` was available; Cartesian shells
follow the FCHK convention (each Cartesian AO normalized, as in iodata's fchk conventions) without
a fixture of their own.

SHA-256:

    8027c9e74af3213af7500c0d60df570987d843fb31a41f96cf5bb0484e38130c  cclib-C_bigbasis-trimmed.out
    f4e280b32b0d9f25ac7a21cfe47e810fe5cecb8b669e8d9751329a0ffded260d  cclib-dvb_gopt.out
    682ccce14c07e99e8cdbab7e20e1d7038ca56b5d6d553223595314f3ebaa0ca7  cclib-dvb_sp.out
    01481bda7970cf007666aa150460c16939d78b6811658555d5572c7f13df20ce  cclib-dvb_un_sp.log
    bc1a21de15ada135d5188b11d44226389022d92488ddfa8163ba7d4d713e5061  cclib-dvb_ir.out
    9a93eac63dba161d4973494df296ff4e62bd1f3c97da6e519df97df172bade74  cclib-water_mp2.log
