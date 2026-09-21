"""Numpy-only stand-in for the DeepTICA worker, used by test_learned.py.

Reads the same input.npz / output.npz contract as ``src/_deeptica_worker.py`` but
computes PC1 (plus tiny per-seed noise) instead of training a network, so the
orchestration (subprocess + consensus) can be tested without PyTorch.
"""
import sys

import numpy as np


def main(inp, out):
    d = np.load(inp)
    x = np.asarray(d["features"], dtype=float)
    n_seeds = int(d["n_seeds"])
    xc = x - x.mean(axis=0)
    _, _, vt = np.linalg.svd(xc, full_matrices=False)
    pc1 = xc @ vt[0]
    series = []
    for seed in range(n_seeds):
        r = np.random.default_rng(seed)
        series.append((pc1 + 1e-3 * r.standard_normal(pc1.size)).reshape(-1, 1))
    np.savez(out, series=np.stack(series, axis=0))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
