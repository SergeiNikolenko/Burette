# Property-model fixtures

Reference data for `tests/test-property-models.test.ts`: the ESOL aqueous
solubility set and the scikit-learn results the TypeScript models are compared
with.

## Files

| File | Content | SHA-256 |
| --- | --- | --- |
| `esol.csv` | 1128 molecules: SMILES and measured log solubility (mol/L) | `329cba2f67de162d7f16ed67ff981e0383325d6de42bb89958811e04f2aa1cd2` |
| `sklearn-reference.json` | scikit-learn scores and PLS predictions on Burette's descriptor matrix | `e1728d1b3cde5bcb11c5c9184683098d5f10237adf48dd56878a374db36f5fa3` |
| `solubility-60.sdf` | the first 60 ESOL molecules as an SDF collection with six values missing | `97ec2391a5e6186c53598f9832fec5886e8d73a5b864ba4e113486a539e0b8bd` |
| `esol.ts` | loads the set the way the tests and the export see it | |
| `export-esol-matrix.ts` | writes the descriptor matrix handed to scikit-learn | |
| `sklearn_reference.py` | computes `sklearn-reference.json` from that matrix | |

## Source

ESOL: J. S. Delaney, "ESOL: Estimating Aqueous Solubility Directly from
Molecular Structure", *J. Chem. Inf. Comput. Sci.* 2004, 44, 1000-1005, as
distributed by MoleculeNet/DeepChem:

    https://deepchemdata.s3-us-west-1.amazonaws.com/datasets/delaney-processed.csv
    SHA-256 8c06a76f0c6487d29ab0f903e6a7a7139f189ab3c1178f159c8be8964602f189

`esol.csv` keeps two of its columns, in the original row order: `smiles`
(whitespace trimmed) and `measured log solubility in mols per litre` as `logS`.

## How the reference was produced

Both sides see the same features and the same folds. The matrix is exported
from Burette's own descriptor code (`MODEL_PROPERTY_IDS` in
`apps/desktop/src/lib/property-models/model-input.ts`, 18 structure properties)
together with the fold of every row (`assignFolds(1128, 5, 24)`) and a
three-way class (`low` below -4, `medium` below -2, otherwise `high`).

    bun tests/fixtures/property-models/export-esol-matrix.ts /tmp/esol-matrix.csv
    uv run --with scikit-learn --with numpy python \
      tests/fixtures/property-models/sklearn_reference.py /tmp/esol-matrix.csv \
      > tests/fixtures/property-models/sklearn-reference.json

Run on 2026-11-14 with Python 3.13.5, scikit-learn 1.9.1 and numpy 2.5.4. The
exported matrix had SHA-256
`5b68e1ba8e335afc3f9ff728d0c2545d2b28152adbeeba13140c024976ec4c65`.

scikit-learn models, all scored on the pooled out-of-fold predictions of a
`PredefinedSplit` over the exported folds:

- nearest neighbours: `StandardScaler` + `KNeighborsRegressor(n_neighbors=5)`
  (`KNeighborsClassifier` for the classes);
- random forest: `RandomForestRegressor(n_estimators=100, max_features=6)`
  (a third of the 18 features) and
  `RandomForestClassifier(n_estimators=100, max_features="sqrt")`, each averaged
  over `random_state` 0-4;
- partial least squares: `PLSRegression(n_components=5, scale=True)`; for the
  classes the same on a one-hot matrix, taking the largest response.

## Numbers

Cross-validated on 1128 molecules, 5 folds. "Burette" is
`buildPropertyModel` with seed 24.

| Model | scikit-learn R² | Burette R² | scikit-learn RMSE | Burette RMSE |
| --- | --- | --- | --- | --- |
| Nearest neighbours, k = 5 | 0.8793 | 0.8787 | 0.728 | 0.730 |
| Random forest, 100 trees | 0.9194 (0.9187-0.9204 over five seeds) | 0.9206 | 0.595 | 0.591 |
| Partial least squares, 5 components | 0.825621 | 0.825621 | 0.8751 | 0.8751 |

| Model | scikit-learn accuracy | Burette accuracy |
| --- | --- | --- |
| Nearest neighbours, k = 5 | 0.7934 | 0.7952 |
| Random forest, 100 trees | 0.8498 (0.8440-0.8555 over five seeds) | 0.8502 |
| Partial least squares, 5 components | 0.6720 | 0.6720 |

The PLS model fitted on all rows gives scikit-learn's predictions to within
5e-11 (the reference stores them rounded to 1e-10). The nearest-neighbour
difference comes from repeated molecules: rows at exactly the same distance are
picked in a different order. The forests use different random number
generators, so they agree within the spread between seeds.

One of the 18 properties, `cLogS`, is itself a solubility estimate, which is
why these models score higher than ESOL results quoted for plain descriptors.

## Walkthrough collection

`solubility-60.sdf` is for trying Build model by hand: the first 60 rows of the
source file, each with its compound name as the title, 2D coordinates from
RDKit (`set_new_coords`), `logS` and a `Solubility` class (`low` below -4,
`medium` below -2, otherwise `high`). Six records carry neither field, so the
model has something to predict:

| Row | Molecule | Measured logS | Class |
| --- | --- | --- | --- |
| 5 | Thiophene | -1.33 | high |
| 12 | 2-Chloronapthalene | -4.14 | low |
| 21 | 2,2',3,4,6-PCB | -7.43 | low |
| 34 | 1,1-Dichloroethylene | -1.64 | high |
| 48 | brompyrazone | -3.127 | medium |
| 59 | 6-Methylchrysene | -6.57 | low |
