# Table shaping fixtures (Stage 26)

Small collections for Pivot, Unpivot, Merge File by Key, the category filter,
row lists and the record view. Used by `tests/test-table-shaping.test.ts` and
by the browser walkthrough.

## Source

Written for these tests; nothing is downloaded. The structures are 2D
depictions of well-known drugs generated from SMILES, and the ChEMBL IDs are
the real identifiers of those compounds. Every activity value, assay name and
comment is made up and is not measured data.

- `chembl-compounds.sdf`: 11 records with `ChEMBL ID`, `Class`, `MW` and
  `Source`. One record has no ChEMBL ID, one has no class, and CHEMBL25 occurs
  twice.
- `chembl-compounds.csv`: the data fields of that SD file as a table.
- `chembl-assays-long.sdf`: 9 records in long format (`ChEMBL ID`, `Assay`,
  `pChEMBL`): a missing combination, a repeated one, a record without a value
  and a record without a key.
- `chembl-activities.csv`: the file merged into the compounds by ChEMBL ID. It
  repeats CHEMBL25, has CHEMBL118 that the collection lacks, a row without a
  key, an empty cell, a quoted cell with a comma and a `Source` column that
  the collection already has.

Regenerate the three generated files with:

```sh
cd tests/fixtures/table-shaping
uv run --with rdkit python make-fixtures.py
```

(RDKit 2026.09.2, Python 3.13.5.)

## pandas reference

`merge-expected-first.csv`, `merge-expected-expand.csv` and
`merge-expected-report.json` are what pandas gives for the same merge:

```sh
cd tests/fixtures/table-shaping
uv run --with pandas python merge-reference.py
```

(pandas 3.1.1, Python 3.13.5.) The script is `merge-reference.py`. It reads
both CSV files as text, drops the rows of the other file that have no key,
and runs `left.merge(other, how="left", left_on="ChEMBL ID",
right_on="molecule_chembl_id", suffixes=("", "_2"))`:

- `merge-expected-first.csv`: after `drop_duplicates("molecule_chembl_id",
  keep="first")`, which is Burette's default for a repeated key;
- `merge-expected-expand.csv`: the plain left join, one row per match;
- `merge-expected-report.json`: matched rows, unmatched rows on both sides,
  rows without a key and repeated keys.

The test asserts equality with these files cell by cell.

## SHA-256

```
574cad823389f131e17eac641a3b745657f52f15083998fc8b0012a921192e22  chembl-compounds.sdf
899c5f2738a2f0df7199b41eecfd6ee469f06ce74aa93e0aa74844b1699a516d  chembl-compounds.csv
e59f14fa5f462692a82cd0e94ded29ff357d8ec2ec6b9641d0afa97a9deaf85d  chembl-assays-long.sdf
a8d0260ff5f485d07d0e52f1a5e66f586ffc6b73e32cc99a28bf810f891e7459  chembl-activities.csv
4359a8ad158807d422d3fb2ddaf392626c53efac031230c414be4de6f54d6cb9  merge-expected-first.csv
4c985fc4ab4cbbc2bc8646de95969c8528cda3a07612f9eefd3d244c30c9f60e  merge-expected-expand.csv
520d0142805a389f456daa5f4ba15dcb10a3582cd9a86a936e88e34a018fc6f4  merge-expected-report.json
```
