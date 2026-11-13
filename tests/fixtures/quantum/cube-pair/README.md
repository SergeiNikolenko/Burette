# Density and electrostatic potential Cube pair

Water at B3LYP/6-31G* (SCF energy −76.4068083 Eh), written by PySCF 2.8.0 `cubegen.density` and
`cubegen.mep` on one 24 × 24 × 24 grid reaching 6 bohr beyond the atoms, so the 0.0004 e/bohr³ surface closes inside it: the Gaussian Cube format and the same two quantities as
Gaussian's `cubegen density=scf` and `cubegen potential=scf`. `generate.py` reproduces them with
`uv run --with pyscf==2.8.0 python generate.py`; the date in each file's second line differs per run.

| File | Field | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `water-density.cube` | electron density, e/bohr³ | 182441 | `630b0f2a11918c0737d96918daa31b095e0cfc38ded0a5b90a071725c74f9401` |
| `water-potential.cube` | electrostatic potential, hartree/e | 182447 | `9ef8d5efbb23e3cc9b7a31c5f9c57cb9b5cca97d050f03fb16024fe73beb49f3` |
