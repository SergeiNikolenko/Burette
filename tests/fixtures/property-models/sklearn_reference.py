"""scikit-learn reference for the property-model tests.

Reads the table written by export-esol-matrix.ts (Burette's descriptors, logS,
class index, fold) and prints the cross-validated scores and the PLS
predictions as JSON. Every model sees the same features and the same folds as
the TypeScript implementation. Usage:

    uv run --with scikit-learn --with numpy python sklearn_reference.py matrix.csv
"""

import json
import sys

import numpy as np
import sklearn
from sklearn.cross_decomposition import PLSRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import accuracy_score, r2_score
from sklearn.model_selection import PredefinedSplit, cross_val_predict
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FOREST_SEEDS = range(5)

table = np.loadtxt(sys.argv[1], delimiter=",", skiprows=1)
x, y, labels, fold = table[:, :-3], table[:, -3], table[:, -2].astype(int), table[:, -1].astype(int)
split = PredefinedSplit(fold)
features = x.shape[1]


def pooled(model, target):
    return cross_val_predict(model, x, target, cv=split)


def rmse(predicted):
    return float(np.sqrt(np.mean((y - predicted) ** 2)))


knn = pooled(make_pipeline(StandardScaler(), KNeighborsRegressor(n_neighbors=5)), y)
forests = [
    pooled(RandomForestRegressor(n_estimators=100, max_features=max(1, features // 3), random_state=seed), y)
    for seed in FOREST_SEEDS
]
pls_model = PLSRegression(n_components=5, scale=True)
pls = pooled(pls_model, y).ravel()
pls_fit = pls_model.fit(x, y).predict(x).ravel()

one_hot = np.eye(labels.max() + 1)[labels]
knn_classes = pooled(make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=5)), labels)
forest_classes = [
    pooled(RandomForestClassifier(n_estimators=100, max_features="sqrt", random_state=seed), labels)
    for seed in FOREST_SEEDS
]
pls_classes = pooled(PLSRegression(n_components=5, scale=True), one_hot).argmax(axis=1)

json.dump(
    {
        "versions": {"scikit-learn": sklearn.__version__, "numpy": np.__version__},
        "rows": int(x.shape[0]),
        "features": int(features),
        "regression": {
            "knn": {"r2": r2_score(y, knn), "rmse": rmse(knn)},
            "forest": {
                "r2": float(np.mean([r2_score(y, predicted) for predicted in forests])),
                "r2BySeed": [r2_score(y, predicted) for predicted in forests],
                "rmse": float(np.mean([rmse(predicted) for predicted in forests])),
            },
            "pls": {"r2": r2_score(y, pls), "rmse": rmse(pls), "fitted": [round(float(value), 10) for value in pls_fit]},
        },
        "classification": {
            "knn": {"accuracy": accuracy_score(labels, knn_classes)},
            "forest": {
                "accuracy": float(np.mean([accuracy_score(labels, predicted) for predicted in forest_classes])),
                "accuracyBySeed": [accuracy_score(labels, predicted) for predicted in forest_classes],
            },
            "pls": {"accuracy": accuracy_score(labels, pls_classes)},
        },
    },
    sys.stdout,
    indent=1,
)
print()
