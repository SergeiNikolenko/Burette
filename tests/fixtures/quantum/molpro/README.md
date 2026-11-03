# Molpro output fixtures

Byte-identical Molpro 2012 outputs from
[cclib](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/Molpro/basicMolpro2012),
BSD-3-Clause (`../cclib-LICENSE.txt`).

| File | Calculation | Covers |
| --- | --- | --- |
| `cclib-dvb_sphf.out` | RHF/STO-3G with `orbprint` | orbital table across symmetry blocks, Mulliken charges, dipole |
| `cclib-dvb_sphf_un.out` | UHF cation | positive/negative spin tables, `+`/`-` occupations |
| `cclib-dvb_gopt.out` | KS optimization | input and optimized geometry only (steps are not printed in the output) |
| `cclib-dvb_ir.out` | KS frequencies | force constants, atomic masses, normal modes with symmetry, IR |
| `cclib-h2o_mp2.out`, `cclib-h2o_ccsd.out` | MP2, CCSD | correlated total energy supersedes SCF |

`cclib-reference.json`: `python ../cclib-reference.py cclib-*.out` with cclib
`1.8.1.post1298+0c6e08e0`. cclib reads a single geometry from the optimization; the test checks
the optimized frame against the optimized Z-matrix variables Molpro printed.

SHA-256:

    d751fdf0af4b8f6b714b83a3aac1b48b5a97db0a650016db75bc4504646258ad  cclib-dvb_gopt.out
    8f9c37ebfa76a46166a4786e92086cdcc4f7acf6890b7e8cb66b5140cc51bfeb  cclib-dvb_ir.out
    8e43d8e168246102c55a139129cea7cc67f0e13da4398901a624cc21797188d7  cclib-dvb_sphf.out
    95e59e60a1f6233fde3c088dfce2bd03d42f6da87c2153323a493028baa09167  cclib-dvb_sphf_un.out
    5d028ddc48963da1fd985bdc624bd743d137b74064e907fecc684dcf5735e233  cclib-h2o_ccsd.out
    d253630a6de90172e025dd560dba51103d46f648f68ce5bde563f70567c495a0  cclib-h2o_mp2.out
