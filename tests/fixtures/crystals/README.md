# Crystal fixtures and independent references

Small periodic structures for the crystal tools (`tests/test-crystal-io.test.ts`,
`tests/test-crystal-edit.test.ts`, `tests/test-crystal-analysis.test.ts`). Every file
and every value in `reference.json` is produced by `generate-reference.py` with
pymatgen, spglib and ASE, never by Burette's code. Exact package versions, host and
date are recorded in `reference.json` (`generator`).

| File | Structure | Source of the parameters |
| --- | --- | --- |
| `urea.cif` | Urea, P-42₁m (113), asymmetric unit with symmetry operations; molecules cross cell faces when expanded | Swaminathan, Craven & McMullan, Acta Cryst. B40, 300 (1984) |
| `rutile.cif` | TiO₂, P4₂/mnm (136) | Baur & Khan, Acta Cryst. B27, 2133 (1971) |
| `quartz.cif` | α-quartz SiO₂, P3₂21 (154), ITA origin | Levien, Prewitt & Weidner, Am. Mineral. 65, 920 (1980) |
| `si.poscar` | Diamond-structure Si, conventional cell, VASP 5 Direct | a = 5.431 Å |
| `CONTCAR` | Rutile with selective dynamics, Cartesian positions and a negative (volume) scale | written by hand from `rutile` |
| `triclinic-molecule.xyz` | Extended XYZ, triclinic P1 cell with one water and one methanol, wrapped so the methanol is split across faces | constructed |
| `nacl-duplicates.cif` | Rock salt in P1 with boundary copies of its sites at fractional 1.0 | a = 5.6402 Å |
| `molecules/*.xyz` | Ten isolated molecules for point groups (pymatgen `PointGroupAnalyzer`, tolerance 0.3) | standard geometries |

`reference.json` holds, per periodic fixture: the full P1 cell as pymatgen reads it;
spglib datasets and `standardize_cell` results at four tolerances; spglib Niggli
reduction; 2×2×1 supercell size; the a-along-x standard orientation; a 1.2× volume
scaling; an edited cell keeping fractional or Cartesian coordinates; ASE
minimum-image bonds (d < rᵢ + rⱼ + 0.45 Å, Cordero radii) and fragments; exact
periodic pair counts and g(r) from ASE neighbour lists; pymatgen powder XRD (Cu Kα1).

The structures are factual data built from published parameters; the generated
files are dedicated to the public domain (CC0).

Regenerate on a Linux host from the repository root:

```sh
uv run --isolated --no-project --python 3.12 \
  --with pymatgen==2026.10.24 --with spglib==2.8.0 --with ase==3.26.0 \
  python tests/fixtures/crystals/generate-reference.py
```
