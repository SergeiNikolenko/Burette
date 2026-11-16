# Collection chart fixture

`moses-properties.sdf` holds 47 molecules with two kinds of columns: numbers
(`MolWt`, `SLogP`, `TPSA`, `Rings`) and one category (`Halogen`). It drives the
chart tests and the browser walkthrough of the Chart dock tab.

- Source: `samples/collections/tables/moses-properties.csv` (48 rows of the
  MOSES benchmark sample already in this repository). `build-fixture.py` writes
  one record per SMILES that RDKit parses (one row does not), with RDKit 2D
  coordinates, the CSV's `Molecular weight`, `SLogP` and `TPSA` values, RDKit's
  ring count as `Rings`, and the halogens present as `Halogen`.
- Built with RDKit 2026.09.1:
  `python3 tests/fixtures/collection-chart/build-fixture.py samples/collections/tables/moses-properties.csv tests/fixtures/collection-chart/moses-properties.sdf`
- SHA-256: `176f6b9873960d10610a42b44d13465bc2541793828aee15cb285c3d531ff3da`

`reference.json` holds the numbers the charts must reproduce: NumPy's histogram
counts on the bin edges Burette picks, matplotlib's `boxplot_stats` per group,
and NumPy means per category. `reference.py` produces it; the command is in its
header (NumPy 2.3.4, matplotlib 3.10.7).

- SHA-256 of `reference.json`: `661088f4ed5d23b8693c3379369b18e4c82abae7dadf44b95fe9a63e9daaee4d`
