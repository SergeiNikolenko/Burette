# Molpro output fixtures

Byte-identical Molpro 2012 outputs from
[cclib](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/Molpro/basicMolpro2012),
BSD-3-Clause (`../cclib-LICENSE.txt`). `cclib-2018-*.out` are Molpro 2018.2 outputs from
[`data/Molpro/basicMolpro2018`](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/Molpro/basicMolpro2018)
with the `cclib-2018-` prefix added.

| File | Calculation | Covers |
| --- | --- | --- |
| `cclib-dvb_sphf.out` | RHF/STO-3G with `orbprint` | orbital table across symmetry blocks, Mulliken charges, dipole |
| `cclib-dvb_sphf_un.out` | UHF cation | positive/negative spin tables, `+`/`-` occupations |
| `cclib-dvb_gopt.out` | KS optimization | input and optimized geometry only (steps are not printed in the output) |
| `cclib-dvb_ir.out` | KS frequencies | force constants, atomic masses, normal modes with symmetry, IR, compact orbital list over four symmetries |
| `cclib-h2o_mp2.out`, `cclib-h2o_ccsd.out` | MP2, CCSD | correlated total energy supersedes SCF, compact `Orbital energies:` list |
| `cclib-2018-dvb_sphf_un.out` | Molpro 2018 UHF cation | alpha/beta spin tables with numeric occupations |
| `cclib-2018-Trp_polar.out` | Molpro 2018 RHF polarizability | compact `Orbital energies:` list with `Final occupancy` |

`cclib-reference.json`: `python ../cclib-reference.py cclib-*.out` with cclib
`1.8.1.post1298+0c6e08e0`; it does not cover `cclib-2018-*.out`, whose tests compare against the
printed values. cclib reads no compact `Orbital energies:` list. cclib reads a single geometry from the optimization; the test checks
the optimized frame against the optimized Z-matrix variables Molpro printed.

SHA-256:

    f0570c157fc6ec83b9e76a39e132c1f8e1b52a5253d4f299448832ac6958e9c9  cclib-2018-Trp_polar.out
    860240bbcca9d31775a03d419977e7169b3a860220229bb000cc39654d500942  cclib-2018-dvb_sphf_un.out
    d751fdf0af4b8f6b714b83a3aac1b48b5a97db0a650016db75bc4504646258ad  cclib-dvb_gopt.out
    8f9c37ebfa76a46166a4786e92086cdcc4f7acf6890b7e8cb66b5140cc51bfeb  cclib-dvb_ir.out
    8e43d8e168246102c55a139129cea7cc67f0e13da4398901a624cc21797188d7  cclib-dvb_sphf.out
    95e59e60a1f6233fde3c088dfce2bd03d42f6da87c2153323a493028baa09167  cclib-dvb_sphf_un.out
    5d028ddc48963da1fd985bdc624bd743d137b74064e907fecc684dcf5735e233  cclib-h2o_ccsd.out
    d253630a6de90172e025dd560dba51103d46f648f68ce5bde563f70567c495a0  cclib-h2o_mp2.out
