# xtb output fixtures

Burette fixtures generated with xtb 6.7.1 (`edcfbbe`, conda-forge, LGPL-3.0 program; the
outputs are Burette test data) from `water.xyz` (or the Turbomole `coord` file), GFN2-xTB
unless stated, two OpenMP threads:

| File | Command | Covers |
| --- | --- | --- |
| `water-opt.out`, `water-opt-xtbopt.log` | `xtb water.xyz --opt` | final structure, energy, orbital table, charges, dipole; the optimizer trajectory |
| `water-ohess.out`, `water-ohess-g98.out`, `water-ohess-vibspectrum` | `xtb water.xyz --ohess` | Gaussian-format frequency output and xtb's own vibspectrum of the same run |
| `water-unconverged.out`, `water-unconverged-xtbopt.log` | `xtb water.xyz --opt --cycles 2` | `FAILED TO CONVERGE GEOMETRY OPTIMIZATION` |
| `water-coord-opt.out` | `xtb coord --opt` | `$coord` final structure in bohr |
| `water-sp.out` | `xtb water.xyz` | a single point prints no geometry: refused with a pointer to the coordinate files |
| `water-gfnff-opt.out` | `xtb water.xyz --gfnff --opt` | GFN-FF energies |

`cclib-dvb-opt.out`, `cclib-dvb-ir-g98.out` and `cclib-dvb-ir-vibspectrum` are
`data/XTB/basicXTB6.6.1/dvb_opt/dvb_opt.out`, `dvb_ir/g98.out` and `dvb_ir/vibspectrum` from
[cclib](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/XTB/basicXTB6.6.1)
(xtb 6.6.1), BSD-3-Clause (`../cclib-LICENSE.txt`), byte-identical. `dvb_opt.out` prints a
windowed orbital table.

SHA-256:

    915f5c5bc8313c4a2439c50508cfa644f03a45a54fd700d612c7a8c77ca540de  cclib-dvb-ir-g98.out
    b7fd95b630c5ae3d67ecf53a19d5e3fdf3730121347f8e34a6d70e4f13620ecc  cclib-dvb-ir-vibspectrum
    90e269309213f4172cef8271f0a7b428a20820e96f43637633ba4ad75d15100d  cclib-dvb-opt.out
    1751efca128d5096f63b99324cd8fd861f2155adb677330ae1858d71c9adef99  water-coord-opt.out
    d9a8e9018b8b45d2c28737525db153b0aabc14c94615e140fce478d9a23b31c5  water-gfnff-opt.out
    dbeb21ffeed1e69873ce68da9f83c8a16dfca1faf026be895bb019f271126628  water-ohess-g98.out
    c0d635bcb8c3c60f8da3361f212af0bb3def6e1501f7a091c0401cf6ab3af2f2  water-ohess-vibspectrum
    58f4c1d6a4c5d97559e2e5540aac09171b078102d75a2ff3848f8e05768c2e43  water-ohess.out
    bf9b0a0f13c4bb3fc06beb65142d210bf07937d71e4be0f2198d30c262a24f63  water-opt-xtbopt.log
    8a6718e6e6d34d604c7e511347f4300ad9f4a955972d5f5fb314d044e92c2e19  water-opt.out
    d368c413794234185e2ffafa4c02986a39bc8f147c8c4f7af540a9320d16a3ee  water-sp.out
    a22a165c76764653307fce9b72e36eda3f7891f6c6b84d70cceb288807327b17  water-unconverged-xtbopt.log
    a625b9a63c799359b0a8a96685bbf18c0579621d8036977d83abd7cb88946ee4  water-unconverged.out

Oracles: `cclib-reference.json` (`python ../cclib-reference.py *.out`, cclib
`1.8.1.post1298+0c6e08e0`) for structures, energies, cycle energies and charges. cclib's
xtb parser stores the printed eV orbital column as if it were Hartree, so after its own
conversion the reference holds that eV column; the test compares Burette's Hartree values
converted to eV. cclib does not read `g98.out`; xtb's `vibspectrum` file of the same run is
the frequency/intensity reference. `xtbopt.log` energies are checked against the cycle
energies cclib reads from the standard output.

xtb's `hessian` (Turbomole `$hessian`) and `vibspectrum` files carry no geometry and no
displacement vectors, so neither opens on its own; `g98.out` carries both.
