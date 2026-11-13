# Q-Chem output fixtures

Byte-identical Q-Chem 5.4 outputs from
[cclib](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/QChem/basicQChem5.4),
BSD-3-Clause (`../cclib-LICENSE.txt`); `water_ccsd(t).out` is renamed `cclib-water_ccsd_t.out`.
`cclib-water_hf_solvent_smd.out` is Q-Chem 6.0 output from
[`data/QChem/basicQChem6.0`](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/QChem/basicQChem6.0).

| File | Calculation | Covers |
| --- | --- | --- |
| `cclib-dvb_sp.out` | RB3LYP/STO-3G | orbital energies with symmetry, Mulliken/ChElPG/Hirshfeld/CM5/Merz-Kollman charges, dipole |
| `cclib-dvb_sp_un.out` | UB3LYP cation | alpha/beta orbital tables, charge tables with spin columns |
| `cclib-dvb_gopt.out` | optimization | five cycles, `OPTIMIZATION CONVERGED` |
| `cclib-dvb_ir.out`, `cclib-dvb_raman.out` | analytic IR, numerical Raman | modes, IR, Raman activity, depolarization, imaginary modes, displaced SCFs |
| `cclib-water_mp2.out`, `cclib-water_ccsd_t.out` | MP2, CCSD(T) | correlated total energy supersedes SCF |
| `cclib-Trp_polar.out` | RHF polarizability, `symmetry = false` | bare `Alpha MOs` header, four-decimal energies, no symmetry labels |
| `cclib-water_hf_solvent_smd.out` | Q-Chem 6.0 HF in SMD water | symmetry turned off by the solvent model, same orbital format |

`cclib-reference.json`: `python ../cclib-reference.py cclib-*.out` with cclib
`1.8.1.post1298+0c6e08e0`; it does not cover `cclib-Trp_polar.out` or
`cclib-water_hf_solvent_smd.out`, whose tests compare against the printed values. In `cclib-dvb_sp.out` Q-Chem prints a second table under the
`Ground-State ChElPG Net Atomic Charges` heading with values beyond ±20 e; cclib keeps it,
Burette keeps the first (fitted) table.

SHA-256:

    b4f7fd1e82098429d25df93dd2be21d4e7f5f634fba97027e333d5345884dccb  cclib-dvb_gopt.out
    f2fcd932f305256583aaca8b552143bd9265db10d51647f1fe32250c75f3d532  cclib-dvb_ir.out
    cf73cd9afb246ab617d18b0fb4d5badfdc6ff78f59bf9fe5426fcacfe5269a70  cclib-dvb_raman.out
    a30d77ffa105d57a2ee1c3678a0aa6443d18af519aadfb64348de501e4d46658  cclib-dvb_sp.out
    f11e4eebfa9500c967e8a7274c8f160122c6ac0c46e40c14e7d95376d66b4479  cclib-Trp_polar.out
    43b11894467268d09a7970dba3f0eb272c5b0cac173680a514a77419e18c6e22  cclib-dvb_sp_un.out
    54ad37d3b3bb86d339505e031cf5c7644d406dc5b5e83768e62725893ff9b65f  cclib-water_ccsd_t.out
    41e967358e08e7bffbb5f11e9b1c1f347acd37decbf130b5f444499d8aef71de  cclib-water_hf_solvent_smd.out
    17225d562b1219da234ff4567b9e8d41707b135ea6f076360048260707c111d6  cclib-water_mp2.out
