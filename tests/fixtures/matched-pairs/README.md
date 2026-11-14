# Matched-pair fixtures

Two congeneric series from ChEMBL 37 (CC BY-SA 3.0) with their matched-pair
tables from mmpdb. `tests/test-matched-pairs.test.ts` fragments and indexes the
SDF files with the app's module on RDKit WASM and compares every row.

| File | Source | SHA-256 |
| --- | --- | --- |
| `chembl-fxa-benzamides.sdf` | assay `CHEMBL662838`, human coagulation factor X Ki, 58 molecules (document `CHEMBL1148260`, Bioorg. Med. Chem. Lett. 2004) | `101271f9535cbdafb586829fbd39282dd4ae7a3fb06824338a983a302e77fb39` |
| `chembl-fxa-benzamides.mmpdb.json` | mmpdb on the SDF above | `715b4b526db8a01d4143313f3420b7abf01344f0a93a0613743777b02a0eed74` |
| `chembl-d2-sulfonamides.sdf` | assay `CHEMBL894519`, human dopamine D2 receptor Ki, 54 molecules (document `CHEMBL1148021`, Bioorg. Med. Chem. Lett. 2007) | `b7837b14d06b2a88f00c1b527c55730e94a9b6bce259bb809c4986934a9fc8d5` |
| `chembl-d2-sulfonamides.mmpdb.json` | mmpdb on the SDF above | `7df38dfaf91145a2abcb46ee66d99c09b046a73aa561cd52941ab3c70eb431d2` |

Each SDF record has the ChEMBL ID as its title, `pKi` (the pChEMBL value of the
Ki; a molecule measured twice keeps its first reported value) and the
`RGroup_*` columns that Analyze > Decompose R-Groups stores for the collection
(all scaffolds), produced by the app's own runner.

## Rebuilding

```sh
cd tests/fixtures/matched-pairs
curl -A curl -o fxa.json 'https://www.ebi.ac.uk/chembl/api/data/activity.json?assay_chembl_id=CHEMBL662838&pchembl_value__isnull=false&limit=200'
curl -A curl -o d2.json 'https://www.ebi.ac.uk/chembl/api/data/activity.json?assay_chembl_id=CHEMBL894519&pchembl_value__isnull=false&limit=200'
run() { uv run --with mmpdb==3.1.6 --with rdkit==2026.3.6 python build_reference.py "$@"; }
run series chembl-fxa-benzamides fxa.json
run series chembl-d2-sulfonamides d2.json
run reference chembl-fxa-benzamides
run reference chembl-d2-sulfonamides
```

`reference` writes the canonical SMILES of every SDF record and its `pKi` to
a SMILES file and a property file, then runs

```sh
mmpdb fragment series.smi --num-cuts 1 --salt-remover '<none>' --num-jobs 1 -o series.fragdb
mmpdb index series.fragdb --properties props.tsv -o series.mmpdb
```

and exports three tables from the two SQLite files: the fragmentations of
every molecule, the pairs, and for every transformation the statistics of its
radius-0 rule environment (count, mean, standard deviation, minimum and
maximum of the change in `pKi`).

## What the series cover

- `chembl-fxa-benzamides`: 1182 fragmentations, 545 pairs, 317
  transformations (161 with more than one pair, 18 to or from hydrogen). One
  molecule has more than 10 rotatable bonds and is not fragmented.
- `chembl-d2-sulfonamides`: 1190 fragmentations, 582 pairs, 290
  transformations. Every molecule is a cis or trans 1,4-disubstituted
  cyclohexane, so every constant part carries ring stereo, and 204
  fragmentations carry a stereocentre that the cut created (mmpdb's `C` and
  `V` labels).

## Where the app differs from mmpdb

On these two series nothing differs. One difference is known and kept: for a
cut next to a stereo double bond mmpdb 3.1.6 can write the fragment with the
opposite geometry, depending on the atom order of its input (`F/C=C/c1ccccc1`
gives `*/C=C\c1ccccc1`, the same molecule written `c1ccccc1/C=C/F` gives
`*/C=C/c1ccccc1`). The app keeps the geometry of the molecule; the test
`a cut next to a double bond keeps the bond's geometry` rejoins the fragments
to prove it. Four further ChEMBL assays were compared while writing the
module: `CHEMBL661582` and `CHEMBL663405` match row for row, `CHEMBL897619`
(cinnamamides, 10 of 492 fragmentations) and `CHEMBL659609` (one N-methyl
amidine, 2 of 734) differ only in those inverted fragments. The first 1,487
readable molecules of `samples/collections/tables/moses-10k.csv` give the same
17,952 fragmentations.
