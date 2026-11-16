# FCHK reader reference

`gaussian16-water-raman.fchk` preserves the existing minimized fixture byte for byte.
Its complete retained fields match [MolOP's Gaussian 16 RHF/STO-3G output](https://github.com/gentle1999/MolOP/blob/ac61263fd586/tests/test_files/g16fchk/water_raman_hf_sto3g.fchk), MIT; see `MolOP-LICENSE.txt`.
Full upstream SHA-256: `0fe14a504077f1faf75031481f8fe967c83c5c1fc6c66aabb2be1547505c53b3`.
Minimized fixture SHA-256: `e1efe5671e883277418def683e4e0b56461485f7da31abd805212098ca1c9d7a`.

Retained fields: atom count/numbers/coordinates, atomic weights, energy, Cartesian
force constants, dipole/polarizability derivatives and all normal-mode/Vib fields.
No numerical values, line endings or title lines were changed in this stage.
The frequency/property table also agrees with [the same run's printed log](https://github.com/gentle1999/MolOP/blob/ac61263fd586/tests/test_files/g16log/water_raman_hf_sto3g.log)
(SHA-256 `4164e2f3700d419442d39dde26ca2352258a1dd53d78b60ee86f7b0a511ea1c0`).
It identifies cm^-1, amu, mDyne/angstrom, km/mol and angstrom^4/amu explicitly.

The direct parser tests retain source atom/mode order and use existing shared
Hessian/basis helpers. This prerequisite does not activate the scientific
format dispatcher, Properties UI, orbital evaluation or any platform surface.

Computed all-zero spectra require complete finite real derivative tensors (9/18
values per atom for dipole/polarizability). Malformed records refuse the file;
normal-mode count, `Vib-NDim` and `Vib-LE2Fix` each require one scalar value.
